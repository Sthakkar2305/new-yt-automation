import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import config from './config/index.js';
import { createModuleLogger } from './utils/logger.js';
import { startScheduler } from './cron/scheduler.js';
import { ensureDir } from './utils/helpers.js';

// Route imports
import pipelineRoutes from './routes/pipeline.js';
import analyticsRoutes from './routes/analytics.js';
import webhookRoutes from './routes/webhooks.js';
import authRoutes from './routes/auth.js';
import healthRoutes from './routes/health.js';

const logger = createModuleLogger('server');
const app = express();

// ============================================
// MIDDLEWARE
// ============================================
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests' },
});
app.use('/api/', limiter);

// API key authentication middleware
function authenticateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  if (!apiKey || apiKey !== config.apiSecretKey) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
}

// ============================================
// ROUTES
// ============================================
app.use('/api/pipeline', authenticateApiKey, pipelineRoutes);
app.use('/api/analytics', authenticateApiKey, analyticsRoutes);
app.use('/api/webhooks', webhookRoutes); // Webhooks have their own auth
app.use('/auth', authRoutes);
app.use('/health', healthRoutes);

// Root
app.get('/', (req, res) => {
  res.json({
    name: 'YT Shorts Automation API',
    version: '1.0.0',
    niche: config.channel.niche,
    status: 'running',
    endpoints: {
      health: '/health',
      pipeline: '/api/pipeline',
      analytics: '/api/analytics',
      webhooks: '/api/webhooks',
      auth: '/auth/youtube',
    },
  });
});

// ============================================
// ERROR HANDLER
// ============================================
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ============================================
// START SERVER
// ============================================
async function start() {
  // Ensure directories exist
  await ensureDir(config.processing.tempDir);
  await ensureDir(config.processing.outputDir);
  await ensureDir('./logs');

  app.listen(config.port, () => {
    logger.info(`🚀 Server running on port ${config.port}`);
    logger.info(`📺 Channel: ${config.channel.name}`);
    logger.info(`🎯 Niche: ${config.channel.niche}`);
    logger.info(`📅 Schedule: ${config.schedule.videosPerDay} videos/day`);

    // Start cron scheduler
    startScheduler();
  });
}

start().catch((err) => {
  logger.error('Server failed to start', { error: err.message });
  process.exit(1);
});

export default app;
