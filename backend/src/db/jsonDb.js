import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', '..', 'data.json');

// IN-MEMORY CACHE (This makes it lightning fast)
let dbData = { sources: [], records: [] };
let isDirty = false;
let saveTimeout = null;

export async function initDb() {
  try {
    const fileContent = await fs.readFile(DB_PATH, 'utf-8');
    dbData = JSON.parse(fileContent);
    console.log(`✅ Loaded ${dbData.records.length} records into memory.`);
  } catch (err) {
    dbData = { sources: [], records: [] };
    await saveDb();
  }
}

export function getDb() {
  return dbData;
}

// Debounced async save (Only writes to disk if data changed, and waits 1 second)
export function saveDb() {
  isDirty = true;
  if (saveTimeout) clearTimeout(saveTimeout);

  saveTimeout = setTimeout(async () => {
    if (!isDirty) return;
    try {
      await fs.writeFile(DB_PATH, JSON.stringify(dbData, null, 2), 'utf-8');
      isDirty = false;
    } catch (err) {
      console.error('Failed to save DB to disk:', err);
    }
  }, 1000);
}