import { connectDb, getDb } from './src/db/database.js';

async function seedMockData() {
  console.log('🌱 Connecting to MongoDB...');
  await connectDb();
  const db = getDb();

  const SOURCE_ID = 'mock://demo-dataset';

  // Clear old data if it exists
  await db.collection('sources').deleteOne({ id: SOURCE_ID });
  await db.collection('records').deleteMany({ source_id: SOURCE_ID });

  console.log('Generating 72 records...');

  const categories = ['Infrastructure', 'Services', 'Clients', 'Internal', 'Edge'];
  const now = Date.now();
  const points = 72;
  const docs = [];

  for (let i = points - 1; i >= 0; i--) {
    const ts = now - i * 3_600_000; // Hourly points
    const base = 60 + Math.sin(i / 6) * 15 + Math.cos(i / 12) * 10;
    const noise = (Math.random() - 0.5) * 18;
    const value = Math.max(0, Math.round((base + noise) * 10) / 10);

    docs.push({
      id: `rec-${points - i}`,
      source_id: SOURCE_ID,
      ts: ts,
      value: value,
      category: categories[i % categories.length],
      raw: {}
    });
  }

  await db.collection('sources').insertOne({
    id: SOURCE_ID,
    url: 'mock://demo-dataset',
    type: 'mock',
    created_at: new Date()
  });

  await db.collection('records').insertMany(docs);

  console.log(` Successfully seeded ${docs.length} records into MongoDB!`);
  console.log(' Refresh your dashboard now.');
  process.exit(0);
}

seedMockData().catch(err => {
  console.error(' Error seeding:', err);
  process.exit(1);
});