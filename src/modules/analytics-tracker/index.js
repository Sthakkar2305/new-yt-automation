import { google } from 'googleapis';
import { createModuleLogger } from '../../utils/logger.js';
import config from '../../config/index.js';
import { upsertAnalytics, getSupabase } from '../../database/client.js';

const logger = createModuleLogger('analytics-tracker');

function getOAuth2Client() {
  const oauth2Client = new google.auth.OAuth2(
    config.youtube.clientId,
    config.youtube.clientSecret,
    config.youtube.redirectUri
  );
  oauth2Client.setCredentials({ refresh_token: config.youtube.refreshToken });
  return oauth2Client;
}

// ============================================
// SYNC ANALYTICS FOR ALL UPLOADED VIDEOS
// ============================================
export async function syncAnalytics() {
  logger.info('Starting analytics sync...');

  const supabase = getSupabase();
  const auth = getOAuth2Client();
  const youtube = google.youtube({ version: 'v3', auth });
  const youtubeAnalytics = google.youtubeAnalytics({ version: 'v2', auth });

  // Get all uploaded videos with YouTube IDs
  const { data: videos, error } = await supabase
    .from('videos')
    .select('id, youtube_id, title')
    .not('youtube_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw error;
  if (!videos || videos.length === 0) {
    logger.info('No uploaded videos to sync');
    return { synced: 0 };
  }

  let synced = 0;

  for (const video of videos) {
    try {
      // Fetch video statistics
      const statsResponse = await youtube.videos.list({
        part: 'statistics,contentDetails',
        id: video.youtube_id,
      });

      const stats = statsResponse.data.items?.[0]?.statistics;
      if (!stats) continue;

      // Try to get analytics data (requires YouTube Analytics API access)
      let avgViewDuration = 0;
      let avgViewPercentage = 0;
      let impressions = 0;
      let ctr = 0;

      try {
        const today = new Date().toISOString().split('T')[0];
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

        const analyticsResponse = await youtubeAnalytics.reports.query({
          ids: `channel==${config.youtube.channelId}`,
          startDate: thirtyDaysAgo,
          endDate: today,
          metrics: 'averageViewDuration,averageViewPercentage,impressions,impressionClickThroughRate',
          filters: `video==${video.youtube_id}`,
        });

        const row = analyticsResponse.data.rows?.[0];
        if (row) {
          avgViewDuration = row[0] || 0;
          avgViewPercentage = row[1] || 0;
          impressions = row[2] || 0;
          ctr = row[3] || 0;
        }
      } catch (analyticsErr) {
        // YouTube Analytics API may not be available
        logger.debug(`Analytics API not available for ${video.youtube_id}`);
      }

      // Calculate performance tier
      const views = parseInt(stats.viewCount || '0');
      const likes = parseInt(stats.likeCount || '0');
      const comments = parseInt(stats.commentCount || '0');

      const tier = calculatePerformanceTier(views, avgViewPercentage, ctr);
      const isViral = views > 10000 || (ctr > 0.10 && views > 1000);

      // Get existing analytics for history tracking
      const { data: existing } = await supabase
        .from('video_analytics')
        .select('metrics_history')
        .eq('video_id', video.id)
        .single();

      const history = existing?.metrics_history || [];
      history.push({
        timestamp: new Date().toISOString(),
        views,
        likes,
        comments,
        ctr,
        retention: avgViewPercentage,
      });

      // Keep only last 30 snapshots
      if (history.length > 30) history.splice(0, history.length - 30);

      await upsertAnalytics({
        video_id: video.id,
        youtube_id: video.youtube_id,
        views,
        likes,
        dislikes: 0,
        comments,
        shares: 0,
        average_view_duration: avgViewDuration,
        average_view_percentage: avgViewPercentage,
        retention_rate: avgViewPercentage / 100,
        impressions,
        ctr,
        performance_tier: tier,
        is_viral: isViral,
        metrics_history: history,
        last_synced_at: new Date().toISOString(),
      });

      synced++;
      logger.debug(`Synced analytics for "${video.title}": ${views} views, tier ${tier}`);
    } catch (err) {
      logger.warn(`Failed to sync analytics for ${video.youtube_id}`, { error: err.message });
    }
  }

  logger.info(`Analytics sync complete: ${synced}/${videos.length} videos synced`);
  return { synced, total: videos.length };
}

// ============================================
// PERFORMANCE TIER CALCULATOR
// ============================================
function calculatePerformanceTier(views, avgViewPercentage, ctr) {
  let score = 0;

  // Views scoring
  if (views > 100000) score += 5;
  else if (views > 50000) score += 4;
  else if (views > 10000) score += 3;
  else if (views > 1000) score += 2;
  else if (views > 100) score += 1;

  // Retention scoring
  if (avgViewPercentage > 80) score += 4;
  else if (avgViewPercentage > 60) score += 3;
  else if (avgViewPercentage > 40) score += 2;
  else if (avgViewPercentage > 20) score += 1;

  // CTR scoring
  if (ctr > 0.15) score += 3;
  else if (ctr > 0.10) score += 2;
  else if (ctr > 0.05) score += 1;

  if (score >= 10) return 'S';
  if (score >= 7) return 'A';
  if (score >= 5) return 'B';
  if (score >= 3) return 'C';
  return 'D';
}

export default { syncAnalytics };
