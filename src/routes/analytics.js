import { Router } from 'express';
import { syncAnalytics } from '../modules/analytics-tracker/index.js';
import { analyzeAndLearn } from '../modules/viral-learner/index.js';
import { getTopPerformingVideos, getViralPatterns, getDailyCost } from '../database/client.js';

const router = Router();

// Sync analytics
router.post('/sync', async (req, res) => {
  try {
    const result = await syncAnalytics();
    res.json({ status: 'synced', ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get top performing videos
router.get('/top', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const videos = await getTopPerformingVideos(parseInt(limit));
    res.json({ count: videos.length, videos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get viral patterns
router.get('/patterns', async (req, res) => {
  try {
    const patterns = await getViralPatterns(20);
    res.json({ count: patterns.length, patterns });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger viral learning
router.post('/learn', async (req, res) => {
  try {
    const result = await analyzeAndLearn();
    res.json({ status: 'learned', ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get daily costs
router.get('/costs', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const cost = await getDailyCost(date);
    res.json({ date, total_cost_usd: cost });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
