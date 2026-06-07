import { Router } from 'express';
import { runFullPipeline } from '../pipeline/orchestrator.js';
import config from '../config/index.js';
import { createModuleLogger } from '../utils/logger.js';

const router = Router();
const logger = createModuleLogger('webhooks');

// Make.com webhook endpoint
router.post('/make', async (req, res) => {
  try {
    // Verify webhook source (simple shared secret)
    const webhookSecret = req.headers['x-webhook-secret'];
    if (webhookSecret !== config.apiSecretKey) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }

    const { action, data } = req.body;
    logger.info(`Webhook received: ${action}`);

    switch (action) {
      case 'trigger_pipeline':
        runFullPipeline(data).catch(err => {
          logger.error('Webhook pipeline failed', { error: err.message });
        });
        res.json({ status: 'pipeline_started' });
        break;

      case 'ping':
        res.json({ status: 'pong', timestamp: new Date().toISOString() });
        break;

      default:
        res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    logger.error('Webhook error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

export default router;
