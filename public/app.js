/* Analytics dashboard — framework-free client-side application */
const state = {
    dataset: null,
    range: '7d',
    page: 0,
    pageSize: 8,
    query: '',
};

let trendChart = null;
let breakdownChart = null;
const PALETTE = ['#542474', '#8b55a5', '#e3a91c', '#c98b13', '#9c7aaa', '#6f3d86'];
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const isDark = () => document.documentElement.dataset.theme === 'dark';
const escapeHTML = (value) => String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
})[character]);

function createDemoData() {
    const categories = ['Direct', 'Organic search', 'Referral', 'Email'];
    const records = [];
    const trend = [];
    const now = Date.now();

    for (let index = 0; index < 96; index += 1) {
        const timestamp = new Date(now - (95 - index) * 3 * 60 * 60 * 1000).toISOString();
        const value = 58 + index * 0.29 + Math.sin(index / 5) * 9 + Math.cos(index / 11) * 4;
        trend.push({ timestamp, value: Number(value.toFixed(2)) });
    }

    for (let index = 0; index < 64; index += 1) {
        const point = trend[trend.length - 1 - (index % trend.length)];
        records.push({
            id: `EV-${String(2048 - index).padStart(4, '0')}`,
            timestamp: point.timestamp,
            category: categories[index % categories.length],
            value: Number((point.value + (index % 7) * 1.37).toFixed(2)),
        });
    }

    return {
        meta: { source: 'Demo workspace', totalRecords: records.length },
        kpis: { totalRecords: 12842, activeGrowth: 18.4, systemLoad: 64, errorRate: 0.38 },
        trend,
        breakdown: [
            { name: 'Direct', value: 38 },
            { name: 'Organic search', value: 29 },
            { name: 'Referral', value: 19 },
            { name: 'Email', value: 14 },
        ],
        records,
    };
}

function normalizeDataset(data) {
    if (!data || !Array.isArray(data.trend) || !Array.isArray(data.breakdown) || !Array.isArray(data.records)) {
        throw new Error('The source returned an unsupported dataset.');
    }
    return {
        ...data,
        meta: { source: 'Connected source', totalRecords: data.records.length, ...(data.meta || {}) },
        kpis: { totalRecords: data.records.length, activeGrowth: 0, systemLoad: 0, errorRate: 0, ...(data.kpis || {}) },
    };
}

async function connectSource(url, type) {
    const response = await fetch('/api/data/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, type }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Connection failed.');
    return normalizeDataset(data);
}

function formatTimestamp(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return String(iso);
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatTick(iso, range) {
    const date = new Date(iso);
    if (range === '24h') return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (range === '7d') return date.toLocaleDateString([], { weekday: 'short', hour: '2-digit' });
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function filterByRange(points, range) {
    const hours = { '24h': 24, '7d': 168, '30d': 720, all: Infinity }[range];
    if (!Number.isFinite(hours)) return points;
    const newest = Math.max(...points.map((point) => new Date(point.timestamp).getTime()).filter(Number.isFinite));
    const filtered = points.filter((point) => new Date(point.timestamp).getTime() >= newest - hours * 3_600_000);
    return filtered.length ? filtered : points;
}

function setStatus(next) {
    const dot = $('#status-dot');
    const text = $('#status-text');
    const toast = $('#status-toast');
    dot.className = `status-dot${next.state === 'loading' || next.state === 'error' ? ` ${next.state}` : ''}`;
    text.textContent = state.dataset?.meta?.source ? String(state.dataset.meta.source).replace(/^https?:\/\//, '').slice(0, 30) : 'No source';

    if (next.state === 'idle') {
        toast.classList.add('hidden');
        return;
    }
    toast.classList.remove('hidden');
    $('#toast-title').textContent = next.state === 'loading' ? 'Fetching source' : next.state === 'success' ? 'Connected' : 'Connection failed';
    $('#toast-message').textContent = next.message || '';
    const icon = $('#toast-icon');
    icon.setAttribute('data-lucide', next.state === 'success' ? 'check-circle-2' : next.state === 'error' ? 'circle-alert' : 'loader-circle');
    icon.classList.toggle('spin', next.state === 'loading');
    window.lucide?.createIcons();

    if (next.state !== 'loading') {
        window.clearTimeout(setStatus.timer);
        setStatus.timer = window.setTimeout(() => setStatus({ state: 'idle' }), 3200);
    }
}

function renderKPIs() {
    const kpis = state.dataset.kpis;
    const cards = [
        { key: 'totalRecords', label: 'Total records', icon: 'database', format: (value) => Number(value).toLocaleString(), accent: 'purple' },
        { key: 'activeGrowth', label: 'Active growth', icon: 'trending-up', format: (value) => `${value >= 0 ? '+' : ''}${Number(value).toFixed(1)}%`, accent: 'purple', signed: true },
        { key: 'systemLoad', label: 'System load', icon: 'gauge', format: (value) => `${Math.round(value)}%`, accent: 'sungold' },
        { key: 'errorRate', label: 'Error rate', icon: 'shield-check', format: (value) => `${Number(value).toFixed(2)}%`, accent: 'sungold' },
    ];

    $('#kpi-grid').innerHTML = cards.map((card) => {
        const value = Number(kpis[card.key]) || 0;
        const badge = card.signed
            ? `<span class="kpi-badge ${value >= 0 ? 'up' : 'down'}"><i data-lucide="${value >= 0 ? 'arrow-up-right' : 'arrow-down-right'}"></i>${value >= 0 ? 'Up' : 'Down'}</span>`
            : '';
        return `<article class="kpi-card">
            <div class="kpi-head"><div class="kpi-icon ${card.accent}"><i data-lucide="${card.icon}"></i></div>${badge}</div>
            <div class="kpi-label">${card.label}</div>
            <div class="kpi-value">${card.format(value)}</div>
        </article>`;
    }).join('');
    window.lucide?.createIcons();
}

function chartColors() {
    return isDark()
        ? { line: '#e0b8ef', grid: 'rgba(255,255,255,.08)', axis: '#a99cac', tooltip: '#2b1734', tooltipText: '#fffaf1' }
        : { line: '#542474', grid: 'rgba(56,19,79,.08)', axis: '#887d8c', tooltip: '#fffdf9', tooltipText: '#24152d' };
}

function renderTrendChart() {
    if (!window.Chart) return;
    const data = filterByRange(state.dataset.trend, state.range);
    const context = $('#trend-chart').getContext('2d');
    const colors = chartColors();
    const gradient = context.createLinearGradient(0, 0, 0, 290);
    gradient.addColorStop(0, isDark() ? 'rgba(182,128,209,.27)' : 'rgba(84,36,116,.20)');
    gradient.addColorStop(1, 'rgba(84,36,116,0)');
    trendChart?.destroy();
    trendChart = new window.Chart(context, {
        type: 'line',
        data: {
            labels: data.map((point) => point.timestamp),
            datasets: [{ data: data.map((point) => point.value), borderColor: colors.line, backgroundColor: gradient, borderWidth: 2, fill: true, tension: .38, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: '#e3a91c', pointHoverBorderWidth: 0 }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: { backgroundColor: colors.tooltip, titleColor: colors.axis, bodyColor: colors.tooltipText, borderColor: colors.grid, borderWidth: 1, padding: 11, displayColors: false, callbacks: { title: (items) => formatTick(items[0].label, state.range), label: (item) => `Value  ${Number(item.parsed.y).toFixed(1)}` } },
            },
            scales: {
                x: { ticks: { color: colors.axis, font: { size: 10, family: 'DM Sans' }, maxRotation: 0, maxTicksLimit: 7, callback(value) { return formatTick(this.getLabelForValue(value), state.range); } }, grid: { display: false }, border: { display: false } },
                y: { ticks: { color: colors.axis, font: { size: 10, family: 'DM Sans' }, maxTicksLimit: 5 }, grid: { color: colors.grid }, border: { display: false } },
            },
        },
    });
}

function renderBreakdownChart() {
    if (!window.Chart) return;
    const source = state.dataset.breakdown;
    const total = source.reduce((sum, item) => sum + Number(item.value || 0), 0) || 1;
    const primary = source.slice(0, 5);
    const remainder = source.slice(5).reduce((sum, item) => sum + Number(item.value || 0), 0);
    const data = remainder ? [...primary, { name: 'Other', value: remainder }] : primary;
    $('#donut-total').textContent = total.toLocaleString(undefined, { maximumFractionDigits: 0 });
    const context = $('#breakdown-chart').getContext('2d');
    const colors = chartColors();
    breakdownChart?.destroy();
    breakdownChart = new window.Chart(context, {
        type: 'doughnut',
        data: { labels: data.map((item) => item.name), datasets: [{ data: data.map((item) => item.value), backgroundColor: data.map((_, index) => PALETTE[index % PALETTE.length]), borderColor: isDark() ? '#281332' : '#fffdf9', borderWidth: 3, hoverOffset: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '72%', plugins: { legend: { display: false }, tooltip: { backgroundColor: colors.tooltip, titleColor: colors.axis, bodyColor: colors.tooltipText, borderColor: colors.grid, borderWidth: 1, padding: 11, callbacks: { label: (item) => `${item.label}  ${Number(item.parsed).toLocaleString()}` } } } },
    });
    $('#breakdown-legend').innerHTML = data.map((item, index) => `<li><span class="legend-dot" style="background:${PALETTE[index % PALETTE.length]}"></span><span class="legend-name">${escapeHTML(item.name)}</span><span class="legend-pct">${(Number(item.value) / total * 100).toFixed(1)}%</span></li>`).join('');
}

function getFilteredRecords() {
    const query = state.query.trim().toLowerCase();
    if (!query) return state.dataset.records;
    return state.dataset.records.filter((record) => [record.id, record.category, record.value].some((value) => String(value).toLowerCase().includes(query)));
}

function renderTable() {
    const filtered = getFilteredRecords();
    const pageCount = Math.max(1, Math.ceil(filtered.length / state.pageSize));
    state.page = Math.min(state.page, pageCount - 1);
    const visible = filtered.slice(state.page * state.pageSize, (state.page + 1) * state.pageSize);
    $('#table-sub').textContent = `${filtered.length.toLocaleString()} of ${state.dataset.records.length.toLocaleString()} rows`;
    $('#table-page-info').textContent = `Page ${state.page + 1} of ${pageCount}`;
    $('#prev-page').disabled = state.page === 0;
    $('#next-page').disabled = state.page >= pageCount - 1;
    $('#table-body').innerHTML = visible.length ? visible.map((record) => `<tr>
        <td class="mono">${escapeHTML(record.id)}</td>
        <td>${escapeHTML(formatTimestamp(record.timestamp))}</td>
        <td><span class="category-pill">${escapeHTML(record.category)}</span></td>
        <td class="text-right num">${Number(record.value).toFixed(2)}</td>
    </tr>`).join('') : '<tr><td colspan="4" class="table-empty">No records match your search.</td></tr>';
}

function renderAll() {
    $('#empty-state').classList.add('hidden');
    $('#dashboard').classList.remove('hidden');
    const meta = state.dataset.meta;
    $('#page-subtitle').innerHTML = `Ingested <strong>${Number(meta.totalRecords).toLocaleString()}</strong> records from <strong>${escapeHTML(String(meta.source).replace(/^https?:\/\//, ''))}</strong>`;
    renderKPIs();
    renderTrendChart();
    renderBreakdownChart();
    renderTable();
    requestAnimationFrame(() => $$('.reveal').forEach((element) => element.classList.add('in')));
}

function wireEvents() {
    $('#data-link-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const url = $('#data-url').value.trim();
        if (!url) return;
        const button = $('#connect-btn');
        button.disabled = true;
        button.querySelector('.btn-label').textContent = 'Connecting';
        setStatus({ state: 'loading', message: 'Connecting to your data source…' });
        try {
            state.dataset = await connectSource(url, $('#data-type').value);
            state.page = 0;
            state.query = '';
            $('#table-search').value = '';
            renderAll();
            setStatus({ state: 'success', message: `${state.dataset.meta.totalRecords.toLocaleString()} records are ready.` });
        } catch (error) {
            setStatus({ state: 'error', message: error instanceof Error ? error.message : 'Connection failed.' });
        } finally {
            button.disabled = false;
            button.querySelector('.btn-label').textContent = 'Connect';
        }
    });

    $$('.range-btn').forEach((button) => button.addEventListener('click', () => {
        $$('.range-btn').forEach((item) => { item.classList.remove('active'); item.setAttribute('aria-pressed', 'false'); });
        button.classList.add('active');
        button.setAttribute('aria-pressed', 'true');
        state.range = button.dataset.range;
        renderTrendChart();
    }));
    $$('.range-btn').forEach((button) => button.setAttribute('aria-pressed', String(button.classList.contains('active'))));

    $('#table-search').addEventListener('input', (event) => { state.query = event.target.value; state.page = 0; renderTable(); });
    $('#prev-page').addEventListener('click', () => { if (state.page > 0) { state.page -= 1; renderTable(); } });
    $('#next-page').addEventListener('click', () => { const pages = Math.ceil(getFilteredRecords().length / state.pageSize); if (state.page < pages - 1) { state.page += 1; renderTable(); } });
    $('#theme-toggle').addEventListener('click', () => {
        const nextTheme = isDark() ? 'light' : 'dark';
        document.documentElement.dataset.theme = nextTheme;
        localStorage.setItem('analytics-dashboard.theme', nextTheme);
        $('#theme-toggle').setAttribute('aria-label', `Switch to ${nextTheme === 'dark' ? 'light' : 'dark'} theme`);
        renderTrendChart();
        renderBreakdownChart();
    });
}

function boot() {
    const savedTheme = localStorage.getItem('analytics-dashboard.theme');
    if (savedTheme === 'dark' || savedTheme === 'light') document.documentElement.dataset.theme = savedTheme;
    $('#footer-year').textContent = new Date().getFullYear();
    state.dataset = createDemoData();
    window.lucide?.createIcons();
    wireEvents();
    setStatus({ state: 'idle' });
    renderAll();
}

document.addEventListener('DOMContentLoaded', boot);
