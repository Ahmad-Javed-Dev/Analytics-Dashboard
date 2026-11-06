import { AppError } from '../middleware/errorHandler.js';
import { ingestFromSource, buildMockDataset } from '../services/dataService.js';

const VALID_TYPES = new Set(['json', 'csv', 'api', 'auto']);

export const connectSource = async (req, res, next) => {
    try {
        const { url, type = 'auto' } = req.body || {};
        if (!url || typeof url !== 'string') throw new AppError('A valid "url" is required', 400);
        if (!/^https?:\/\//i.test(url)) throw new AppError('URL must start with http:// or https://', 400);
        if (!VALID_TYPES.has(type)) throw new AppError(`Invalid type. Use one of: ${[...VALID_TYPES].join(', ')}`, 400);
        const payload = await ingestFromSource({ url, type });
        res.json({ success: true, ...payload });
    } catch (err) { next(err); }
};

export const getMockData = async (_req, res, next) => {
    try { res.json({ success: true, ...buildMockDataset() }); }
    catch (err) { next(err); }
};