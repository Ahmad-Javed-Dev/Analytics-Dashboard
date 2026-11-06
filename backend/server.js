import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { errorHandler } from './src/middleware/errorHandler.js';
import dataRoutes from './src/routes/dataRoutes.js';
import { initDb } from './src/db/jsonDb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;

// 1. SECURITY: Helmet sets secure HTTP headers
app.use(helmet({
    contentSecurityPolicy: false, // Disable CSP for now so Chart.js/CDNs work easily
}));

// 2. SECURITY: Rate Limiting (Max 100 requests per 15 mins per IP)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '5mb' })); // Strict size limit

app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
app.use('/api/data', dataRoutes);
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.use(errorHandler);

// Initialize In-Memory DB before starting server
initDb().then(() => {
    app.listen(PORT, () => console.log(`🚀 Dashboard running at http://localhost:${PORT}`));
}).catch(err => {
    console.error('Failed to init DB:', err);
    process.exit(1);
});