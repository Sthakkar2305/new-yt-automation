import { Router } from 'express';
import { getSupabase } from '../database/client.js';
import { getDailyCost } from '../database/client.js';
import config from '../config/index.js';

const router = Router();

router.get('/', async (req, res) => {
  const checks = {
    server: 'ok',
    database: 'unknown',
    budget: 'unknown',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  };

  // Check database
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from('videos').select('id').limit(1);
    checks.database = error ? 'error' : 'ok';
  } catch {
    checks.database = 'error';
  }

  // Check budget
  try {
    const today = new Date().toISOString().split('T')[0];
    const spent = await getDailyCost(today);
    checks.budget = {
      spent: `$${spent.toFixed(2)}`,
      remaining: `$${(config.costs.dailyBudgetUsd - spent).toFixed(2)}`,
      limit: `$${config.costs.dailyBudgetUsd}`,
    };
  } catch {
    checks.budget = 'error';
  }

  const allOk = checks.server === 'ok' && checks.database === 'ok';
  res.status(allOk ? 200 : 503).json(checks);
});

export default router;
