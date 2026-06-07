import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import config from '../config/index.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('database');

let supabase = null;

export function getSupabase() {
  if (!supabase) {
    // Add WebSocket support for Node < 22
    if (!global.WebSocket) {
      global.WebSocket = WebSocket;
    }
    
    supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    logger.info('Supabase client initialized');
  }
  return supabase;
}

// Simple retry wrapper for database calls
export async function dbRetry(fn) {
  let retries = 3;
  let delay = 2000;
  while (retries > 0) {
    try {
      return await fn();
    } catch (err) {
      const isTransient = 
        !err.status || // Network errors like "fetch failed" don't have HTTP status
        err.message?.includes('fetch failed') ||
        err.message?.includes('network') ||
        err.message?.includes('timeout') ||
        err.status === 502 ||
        err.status === 503 ||
        err.status === 504 ||
        err.status === 429; // Rate limit
      
      retries--;
      if (retries > 0 && isTransient) {
        logger.warn(`Database connection transient failure (${err.message}). Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
      } else {
        throw err;
      }
    }
  }
}

// ============================================
// TOPICS
// ============================================
export async function insertTopic(topic) {
  return dbRetry(async () => {
    const { data, error } = await getSupabase()
      .from('topics')
      .insert(topic)
      .select()
      .single();
    if (error) throw error;
    return data;
  });
}

export async function getUnusedTopics(limit = 10) {
  return dbRetry(async () => {
    const { data, error } = await getSupabase()
      .from('topics')
      .select('*')
      .eq('used', false)
      .order('virality_score', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  });
}

export async function markTopicUsed(topicId) {
  return dbRetry(async () => {
    const { error } = await getSupabase()
      .from('topics')
      .update({ used: true, used_at: new Date().toISOString() })
      .eq('id', topicId);
    if (error) throw error;
  });
}

export async function topicExists(fingerprint) {
  return dbRetry(async () => {
    const { data } = await getSupabase()
      .from('topics')
      .select('id')
      .eq('fingerprint', fingerprint)
      .single();
    return !!data;
  });
}

// ============================================
// VIDEOS
// ============================================
export async function insertVideo(video) {
  return dbRetry(async () => {
    const { data, error } = await getSupabase()
      .from('videos')
      .insert(video)
      .select()
      .single();
    if (error) throw error;
    return data;
  });
}

export async function updateVideo(videoId, updates) {
  return dbRetry(async () => {
    const { data, error } = await getSupabase()
      .from('videos')
      .update(updates)
      .eq('id', videoId)
      .select()
      .single();
    if (error) throw error;
    return data;
  });
}

export async function getVideosByStatus(status, limit = 20) {
  return dbRetry(async () => {
    const { data, error } = await getSupabase()
      .from('videos')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  });
}

export async function getVideoById(videoId) {
  return dbRetry(async () => {
    const { data, error } = await getSupabase()
      .from('videos')
      .select('*')
      .eq('id', videoId)
      .single();
    if (error) throw error;
    return data;
  });
}

export async function getReadyToUploadVideos() {
  return dbRetry(async () => {
    const { data, error } = await getSupabase()
      .from('videos')
      .select('*')
      .eq('status', 'composed')
      .is('youtube_id', null)
      .order('created_at', { ascending: true })
      .limit(2);
    if (error) throw error;
    return data;
  });
}

// ============================================
// ANALYTICS
// ============================================
export async function upsertAnalytics(analyticsData) {
  return dbRetry(async () => {
    const { data, error } = await getSupabase()
      .from('video_analytics')
      .upsert(analyticsData, { onConflict: 'video_id' })
      .select()
      .single();
    if (error) throw error;
    return data;
  });
}

export async function getTopPerformingVideos(limit = 20) {
  return dbRetry(async () => {
    const { data, error } = await getSupabase()
      .from('video_analytics')
      .select('*, videos(*)')
      .order('views', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  });
}

export async function getAnalyticsForLearning() {
  return dbRetry(async () => {
    const { data, error } = await getSupabase()
      .from('video_analytics')
      .select(`
        *,
        videos (
          id, title, hook, script, tags, 
          topic_category, scenes, seo_title
        )
      `)
      .gte('views', 100)
      .order('retention_rate', { ascending: false })
      .limit(50);
    if (error) throw error;
    return data;
  });
}

// ============================================
// COST TRACKING
// ============================================
export async function logApiCost(costEntry) {
  return dbRetry(async () => {
    const { error } = await getSupabase()
      .from('api_costs')
      .insert(costEntry);
    if (error) throw error;
  });
}

export async function getDailyCost(date) {
  return dbRetry(async () => {
    const startOfDay = `${date}T00:00:00Z`;
    const endOfDay = `${date}T23:59:59Z`;
    const { data, error } = await getSupabase()
      .from('api_costs')
      .select('cost_usd')
      .gte('created_at', startOfDay)
      .lte('created_at', endOfDay);
    if (error) throw error;
    return data.reduce((sum, row) => sum + row.cost_usd, 0);
  });
}

// ============================================
// VIRAL PATTERNS
// ============================================
export async function insertViralPattern(pattern) {
  return dbRetry(async () => {
    const { data, error } = await getSupabase()
      .from('viral_patterns')
      .insert(pattern)
      .select()
      .single();
    if (error) throw error;
    return data;
  });
}

export async function getViralPatterns(limit = 20) {
  return dbRetry(async () => {
    const { data, error } = await getSupabase()
      .from('viral_patterns')
      .select('*')
      .order('confidence_score', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  });
}

// ============================================
// UPLOAD SCHEDULE
// ============================================
export async function getScheduledUploads(date) {
  return dbRetry(async () => {
    const { data, error } = await getSupabase()
      .from('upload_schedule')
      .select('*, videos(*)')
      .eq('scheduled_date', date)
      .order('scheduled_time', { ascending: true });
    if (error) throw error;
    return data;
  });
}

export async function scheduleUpload(scheduleEntry) {
  return dbRetry(async () => {
    const { data, error } = await getSupabase()
      .from('upload_schedule')
      .insert(scheduleEntry)
      .select()
      .single();
    if (error) throw error;
    return data;
  });
}

export default {
  getSupabase,
  dbRetry,
  insertTopic, getUnusedTopics, markTopicUsed, topicExists,
  insertVideo, updateVideo, getVideosByStatus, getVideoById, getReadyToUploadVideos,
  upsertAnalytics, getTopPerformingVideos, getAnalyticsForLearning,
  logApiCost, getDailyCost,
  insertViralPattern, getViralPatterns,
  getScheduledUploads, scheduleUpload,
};
