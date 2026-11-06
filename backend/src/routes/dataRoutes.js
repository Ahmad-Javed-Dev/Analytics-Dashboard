import { Router } from 'express';
import { connectSource, getMockData } from '../controllers/dataController.js';

const router = Router();
router.get('/mock', getMockData);
router.post('/connect', connectSource);
export default router;