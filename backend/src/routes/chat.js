import express from 'express';
import { processMessage } from '../controllers/chatController.js';

const router = express.Router();

router.post('/message', processMessage);

export default router;
