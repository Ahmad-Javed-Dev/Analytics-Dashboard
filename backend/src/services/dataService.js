import { getDb, saveDb } from '../db/jsonDb.js';
import { AppError } from '../middleware/errorHandler.js';
import crypto from 'crypto';
import { URL } from 'url';
import dns from 'dns';
import { promisify } from 'util';

const resolve4 = promisify(dns.resolve4);

// --- 1. SSRF FIREWALL (Blocks internal IPs) ---
async function isSafeUrl(urlString) {
    try {
        const { hostname } = new URL(urlString);
        // Block localhost and internal networks
        if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(hostname)) return false;

        const addresses = await resolve4(hostname);
        const privateRanges = [/^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^169\.254\./];
        return !addresses.some(ip => privateRanges.some(range => range.test(ip)));
    } catch {
        return false; // If DNS fails, block it
    }
}

// --- 2. REMOTE FETCH ---
async function fetchRemote(url, timeoutMs = 5000) {
    const isSafe = await isSafeUrl(url);
    if (!isSafe) throw new AppError('Access to internal/private networks is blocked', 403);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal, redirect: 'error' }); // Block redirects to internal IPs
        if (!response.ok) throw new AppError(`Remote responded with ${response.status}`, 424);
        const text = await response.text();
        if (text.length > 2_000_000) throw new AppError('Payload exceeds 2MB limit', 413);
        return text;
    } catch (err) {
        if (err.name === 'AbortError') throw new AppError('Request timed out', 504);
        throw new AppError(`Failed to fetch source: ${err.message}`, 422);
    } finally { clearTimeout(timer); }
}

// --- 3. CSV PARSER ---
function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) throw new AppError('CSV has no data rows', 422);
    const splitRow = (line) => {
        const cells = []; let cur = '', inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
                else inQuotes = !inQuotes;
            } else if (ch === ',' && !inQuotes) { cells.push(cur); cur = ''; }
            else cur += ch;
        }
        cells.push(cur);
        return cells;
    };
    const headers = splitRow(lines[0]).map((h) => h.trim());
    return lines.slice(1).map((line) => {
        const cells = splitRow(line);
        const row = {};
        headers.forEach((h, i) => {
            const v = (cells[i] ?? '').trim();
            const num = Number(v);
            row[h] = v === '' ? null : Number.isFinite(num) && v !== '' ? num : v;
        });
        return row;
    });
}

// --- 4. KEY DETECTION ---
function parseDate(value) {
    if (value == null) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number') {
        const d = new Date(value < 1e12 ? value * 1000 : value);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

function detectTimestampKey(records) {
    const candidates = ['timestamp', 'date', 'datetime', 'time', 'created_at', 'createdAt', 'Date'];
    const sample = records.slice(0, 20);
    for (const key of candidates) {
        if (sample.every((r) => parseDate(r[key]) !== null)) return key;
    }
    const keys = Object.keys(records[0] || {});
    for (const key of keys) {
        const hits = sample.filter((r) => parseDate(r[key]) !== null).length;
        if (hits === sample.length) return key;
    }
    return null;
}

function detectValueKey(records, ignoreKeys = []) {
    const keys = Object.keys(records[0] || {}).filter((k) => !ignoreKeys.includes(k));
    let best = null, bestScore = -1;
    for (const key of keys) {
        const nums = records.map((r) => r[key]).filter((v) => typeof v === 'number' && Number.isFinite(v));
        if (nums.length > bestScore) { bestScore = nums.length; best = key; }
    }
    return best;
}

function detectCategoryKey(records, ignoreKeys = []) {
    const keys = Object.keys(records[0] || {}).filter((k) => !ignoreKeys.includes(k));
    let best = null, bestScore = -1;
    for (const key of keys) {
        const values = records.map((r) => r[key]).filter((v) => typeof v === 'string');
        const unique = new Set(values).size;
        const score = values.length > 0 ? values.length / Math.max(unique, 1) : 0;
        if (unique >= 2 && unique <= 20 && score > bestScore) { bestScore = score; best = key; }
    }
    return best;
}

// --- 5. CHART DOWNSAMPLER (Prevents browser freezing) ---
function downsampleTrend(data, maxPoints = 300) {
    if (data.length <= maxPoints) return data;
    const step = Math.ceil(data.length / maxPoints);
    const result = [];
    for (let i = 0; i < data.length; i += step) {
        result.push(data[i]);
    }
    return result;
}

// --- 6. MAIN INGESTION ---
export async function ingestFromSource({ url, type }) {
    const raw = await fetchRemote(url);
    const db = getDb();

    let records;
    if (type === 'csv' || (type === 'auto' && raw.includes(',') && raw.split('\n')[0].includes(','))) {
        records = parseCSV(raw);
    } else {
        try {
            const parsed = JSON.parse(raw);
            records = Array.isArray(parsed) ? parsed : parsed.data ?? parsed.records ?? [parsed];
        } catch { records = parseCSV(raw); }
    }

    if (!Array.isArray(records) || records.length === 0) {
        throw new AppError('No records found in source', 422);
    }

    const tsKey = detectTimestampKey(records);
    const valueKey = detectValueKey(records, tsKey ? [tsKey] : []);
    const categoryKey = detectCategoryKey(records, [tsKey, valueKey].filter(Boolean));

    const sourceId = `src-${crypto.randomUUID()}`;

    db.sources.push({ id: sourceId, url, type, created_at: new Date().toISOString() });

    const newRecords = records.map((r, i) => {
        const ts = tsKey ? parseDate(r[tsKey]) : new Date(Date.now() - (records.length - i) * 60_000);
        return {
            id: String(r.id ?? r.ID ?? i),
            source_id: sourceId,
            ts: ts ? ts.getTime() : Date.now(),
            value: typeof r[valueKey] === 'number' ? r[valueKey] : 0,
            category: categoryKey ? String(r[categoryKey] ?? 'unknown') : 'default',
            raw: r
        };
    });

    db.records.push(...newRecords);
    saveDb(); // Async background save

    return buildAnalytics(sourceId, url, type);
}

// --- 7. ANALYTICS BUILDER ---
export async function buildAnalytics(sourceId, sourceUrl, sourceType) {
    const db = getDb();
    const sourceRecords = db.records.filter(r => r.source_id === sourceId);

    if (sourceRecords.length === 0) throw new AppError('Source has no records', 422);

    // Sort once
    sourceRecords.sort((a, b) => a.ts - b.ts);

    // Downsample for chart
    const trend = downsampleTrend(sourceRecords.map(r => ({ timestamp: new Date(r.ts).toISOString(), value: r.value })));

    // Single-pass breakdown
    const breakdownMap = new Map();
    for (const r of sourceRecords) {
        breakdownMap.set(r.category, (breakdownMap.get(r.category) || 0) + r.value);
    }
    const breakdown = Array.from(breakdownMap.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);

    // Single-pass KPIs
    let sum = 0, max = 0;
    const values = [];
    for (const r of sourceRecords) {
        const v = r.value;
        sum += v;
        if (v > max) max = v;
        values.push(v);
    }

    const total = sourceRecords.length;
    const mean = sum / total;
    const halfIdx = Math.floor(total / 2);
    const firstHalf = values.slice(0, halfIdx).reduce((a, b) => a + b, 0) / Math.max(halfIdx, 1);
    const secondHalf = values.slice(halfIdx).reduce((a, b) => a + b, 0) / Math.max(total - halfIdx, 1);
    const growth = firstHalf === 0 ? 0 : ((secondHalf - firstHalf) / Math.abs(firstHalf)) * 100;

    const systemLoad = max === 0 ? 0 : Math.min(100, Math.round((mean / max) * 100));
    const errorRate = Math.max(0, Math.min(100, 100 - Math.abs(growth) * 2));

    return {
        meta: { source: sourceUrl, type: sourceType, sourceId, totalRecords: total, ingestedAt: new Date().toISOString() },
        kpis: { totalRecords: total, activeGrowth: Number(growth.toFixed(2)), systemLoad, errorRate: Number(errorRate.toFixed(2)) },
        trend,
        breakdown,
        // Only send the last 100 records to the frontend table to keep payload small
        records: sourceRecords.slice(-100).map(r => ({ ...r, timestamp: new Date(r.ts).toISOString() }))
    };
}

// --- 8. MOCK DATA ---
export async function buildMockDataset() {
    const db = getDb();
    const SOURCE_ID = 'mock://demo-dataset';

    const existingSource = db.sources.find(s => s.id === SOURCE_ID);
    if (!existingSource) {
        await seedMockData();
    }
    return buildAnalytics(SOURCE_ID, 'mock://demo-dataset', 'mock');
}

async function seedMockData() {
    const db = getDb();
    const SOURCE_ID = 'mock://demo-dataset';
    const categories = ['Infrastructure', 'Services', 'Clients', 'Internal', 'Edge'];
    const now = Date.now();
    const points = 72;

    db.sources.push({ id: SOURCE_ID, url: 'mock', type: 'mock', created_at: new Date().toISOString() });

    for (let i = points - 1; i >= 0; i--) {
        const ts = now - i * 3_600_000;
        const base = 60 + Math.sin(i / 6) * 15 + Math.cos(i / 12) * 10;
        const noise = (Math.random() - 0.5) * 18;
        const value = Math.max(0, Math.round((base + noise) * 10) / 10);

        db.records.push({
            id: `rec-${points - i}`,
            source_id: SOURCE_ID,
            ts: ts,
            value: value,
            category: categories[i % categories.length],
            raw: {}
        });
    }
    saveDb();
}