import cron from 'node-cron';
import { createModuleLogger } from '../utils/logger.js';
import config from '../config/index.js';
import { runFullPipeline, runUploadPipeline } from '../pipeline/orchestrator.js';
import { getReadyToUploadVideos, getScheduledUploads, scheduleUpload } from '../database/client.js';
import { syncAnalytics } from '../modules/analytics-tracker/index.js';
import { analyzeAndLearn } from '../modules/viral-learner/index.js';
import { discoverTopics } from '../modules/trend-discovery/index.js';
import { scoreUnscoredTopics } from '../modules/topic-scoring/index.js';
import { getISTDate, getISTTime } from '../utils/helpers.js';

const logger = createModuleLogger('scheduler');

// ============================================
// CRON SCHEDULE DEFINITIONS
// ============================================

export function startScheduler() {
  logger.info('🕐 Starting cron scheduler...');

  // ─────────────────────────────────────────
  // 1. CONTENT PIPELINE - Run at 3 AM IST daily
  //    Creates 2 videos for the day
  // ─────────────────────────────────────────
  cron.schedule('30 21 * * *', async () => { // 21:30 UTC = 3:00 AM IST
    logger.info('⏰ [CRON] Daily content pipeline starting...');
    try {
      for (let i = 0; i < config.schedule.videosPerDay; i++) {
        logger.info(`Creating video ${i + 1}/${config.schedule.videosPerDay}...`);
        const result = await runFullPipeline();

        // Schedule upload for today
        const uploadTime = config.schedule.uploadTimes[i] || '12:00';
        await scheduleUpload({
          video_id: result.videoId,
          channel_id: config.channel.id,
          scheduled_date: getISTDate(),
          scheduled_time: uploadTime,
          timezone: config.schedule.timezone,
        });

        logger.info(`Video ${i + 1} scheduled for upload at ${uploadTime} IST`);
      }
    } catch (err) {
      logger.error('[CRON] Content pipeline failed', { error: err.message });
    }
  }, {
    timezone: config.schedule.timezone,
  });

  // ─────────────────────────────────────────
  // 2. UPLOAD #1 - 11:00 AM IST
  // ─────────────────────────────────────────
  cron.schedule('0 11 * * *', async () => {
    logger.info('⏰ [CRON] Upload slot #1 (11:00 AM IST)');
    await processScheduledUploads();
  }, {
    timezone: config.schedule.timezone,
  });

  // ─────────────────────────────────────────
  // 3. UPLOAD #2 - 7:00 PM IST
  // ─────────────────────────────────────────
  cron.schedule('0 19 * * *', async () => {
    logger.info('⏰ [CRON] Upload slot #2 (7:00 PM IST)');
    await processScheduledUploads();
  }, {
    timezone: config.schedule.timezone,
  });

  // ─────────────────────────────────────────
  // 4. TREND DISCOVERY - Every 6 hours
  // ─────────────────────────────────────────
  cron.schedule('0 */6 * * *', async () => {
    logger.info('⏰ [CRON] Trend discovery...');
    try {
      await discoverTopics();
      await scoreUnscoredTopics();
    } catch (err) {
      logger.error('[CRON] Trend discovery failed', { error: err.message });
    }
  }, {
    timezone: config.schedule.timezone,
  });

  // ─────────────────────────────────────────
  // 5. ANALYTICS SYNC - Every 4 hours
  // ─────────────────────────────────────────
  cron.schedule('0 */4 * * *', async () => {
    logger.info('⏰ [CRON] Analytics sync...');
    try {
      await syncAnalytics();
    } catch (err) {
      logger.error('[CRON] Analytics sync failed', { error: err.message });
    }
  }, {
    timezone: config.schedule.timezone,
  });

  // ─────────────────────────────────────────
  // 6. VIRAL LEARNING - Weekly on Sunday 2 AM IST
  // ─────────────────────────────────────────
  cron.schedule('0 2 * * 0', async () => {
    logger.info('⏰ [CRON] Weekly viral pattern learning...');
    try {
      await analyzeAndLearn();
    } catch (err) {
      logger.error('[CRON] Viral learning failed', { error: err.message });
    }
  }, {
    timezone: config.schedule.timezone,
  });

  logger.info('✅ All cron jobs scheduled:');
  logger.info('  • Content Pipeline: 3:00 AM IST daily');
  logger.info('  • Upload #1: 11:00 AM IST daily');
  logger.info('  • Upload #2: 7:00 PM IST daily');
  logger.info('  • Trend Discovery: Every 6 hours');
  logger.info('  • Analytics Sync: Every 4 hours');
  logger.info('  • Viral Learning: Sundays 2:00 AM IST');
}

// ============================================
// PROCESS SCHEDULED UPLOADS
// ============================================
async function processScheduledUploads() {
  try {
    const today = getISTDate();
    const currentTime = getISTTime();

    // Get videos ready to upload
    const readyVideos = await getReadyToUploadVideos();

    if (readyVideos.length === 0) {
      logger.info('No videos ready for upload');
      return;
    }

    // Upload the first available video
    const video = readyVideos[0];
    logger.info(`Uploading: "${video.seo_title || video.id}"`);

    await runUploadPipeline(video.id, null); // null = upload immediately
    logger.info('Upload complete!');
  } catch (err) {
    logger.error('Scheduled upload failed', { error: err.message });
  }
}

// CLI entry point
if (process.argv[1] && process.argv[1].includes('scheduler')) {
  startScheduler();
  logger.info('Scheduler running. Press Ctrl+C to stop.');
}

export default { startScheduler };
