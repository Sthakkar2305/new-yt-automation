import { Router } from 'express';
import { runFullPipeline, runUploadPipeline } from '../pipeline/orchestrator.js';
import { getVideoById, getVideosByStatus, getReadyToUploadVideos } from '../database/client.js';
import { createModuleLogger } from '../utils/logger.js';

const router = Router();
const logger = createModuleLogger('routes-pipeline');

// Trigger full pipeline
router.post('/run', async (req, res) => {
  try {
    logger.info('Pipeline triggered via API');
    // Run async - don't wait for completion
    runFullPipeline(req.body).catch(err => {
      logger.error('Background pipeline failed', { error: err.message });
    });
    res.json({ status: 'started', message: 'Pipeline running in background' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload a specific video
router.post('/upload/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const { scheduledTime } = req.body;
    const result = await runUploadPipeline(videoId, scheduledTime);
    res.json({ status: 'uploaded', ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get video by ID
router.get('/video/:videoId', async (req, res) => {
  try {
    const video = await getVideoById(req.params.videoId);
    res.json(video);
  } catch (err) {
    res.status(404).json({ error: 'Video not found' });
  }
});

// List videos by status
router.get('/videos', async (req, res) => {
  try {
    const { status = 'composed', limit = 20 } = req.query;
    const videos = await getVideosByStatus(status, parseInt(limit));
    res.json({ count: videos.length, videos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get videos ready to upload
router.get('/ready', async (req, res) => {
  try {
    const videos = await getReadyToUploadVideos();
    res.json({ count: videos.length, videos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
