-- ============================================
-- YouTube Shorts Automation - Database Schema
-- Run this in Supabase SQL Editor
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 1. TOPICS TABLE
-- ============================================
CREATE TABLE topics (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  source TEXT NOT NULL, -- reddit, hackernews, google_trends, techcrunch, twitter
  source_url TEXT,
  fingerprint TEXT UNIQUE NOT NULL, -- dedup hash
  category TEXT NOT NULL, -- ai_breakthrough, robotics, space_tech, etc.
  
  -- Scoring
  virality_score FLOAT DEFAULT 0,
  emotional_score FLOAT DEFAULT 0,
  curiosity_score FLOAT DEFAULT 0,
  visual_score FLOAT DEFAULT 0,
  uniqueness_score FLOAT DEFAULT 0,
  composite_score FLOAT DEFAULT 0,
  
  -- Status
  used BOOLEAN DEFAULT FALSE,
  used_at TIMESTAMPTZ,
  
  -- Metadata
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_topics_unused ON topics (used, composite_score DESC);
CREATE INDEX idx_topics_fingerprint ON topics (fingerprint);
CREATE INDEX idx_topics_category ON topics (category);

-- ============================================
-- 2. VIDEOS TABLE
-- ============================================
CREATE TABLE videos (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  topic_id UUID REFERENCES topics(id),
  channel_id TEXT NOT NULL,
  
  -- Content
  hook TEXT NOT NULL,
  script TEXT NOT NULL,
  script_word_count INT,
  scenes JSONB NOT NULL, -- Array of scene objects
  visual_prompts JSONB, -- Array of visual prompt strings
  
  -- Generated Assets
  voiceover_url TEXT,
  voiceover_duration FLOAT,
  image_urls JSONB, -- Array of generated image URLs
  video_clip_urls JSONB, -- Array of generated video clip URLs
  subtitle_file_url TEXT,
  music_url TEXT,
  thumbnail_url TEXT,
  
  -- Final Output
  final_video_url TEXT,
  final_video_duration FLOAT,
  file_size_mb FLOAT,
  
  -- SEO
  seo_title TEXT,
  seo_description TEXT,
  seo_tags TEXT[],
  seo_hashtags TEXT[],
  
  -- YouTube
  youtube_id TEXT UNIQUE,
  youtube_url TEXT,
  youtube_status TEXT, -- uploaded, published, failed
  upload_error TEXT,
  published_at TIMESTAMPTZ,
  
  -- Pipeline Status
  status TEXT DEFAULT 'draft', 
  -- draft -> scripted -> visualized -> voiced -> composed -> uploaded -> published
  pipeline_step TEXT,
  pipeline_errors JSONB,
  retry_count INT DEFAULT 0,
  
  -- Categorization
  topic_category TEXT,
  mood TEXT,
  
  -- Cost
  total_cost_usd FLOAT DEFAULT 0,
  cost_breakdown JSONB,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_videos_status ON videos (status);
CREATE INDEX idx_videos_youtube_id ON videos (youtube_id);
CREATE INDEX idx_videos_channel ON videos (channel_id);
CREATE INDEX idx_videos_created ON videos (created_at DESC);

-- ============================================
-- 3. VIDEO ANALYTICS TABLE
-- ============================================
CREATE TABLE video_analytics (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  video_id UUID REFERENCES videos(id) UNIQUE,
  youtube_id TEXT,
  
  -- Metrics
  views BIGINT DEFAULT 0,
  likes BIGINT DEFAULT 0,
  dislikes BIGINT DEFAULT 0,
  comments BIGINT DEFAULT 0,
  shares BIGINT DEFAULT 0,
  
  -- Retention
  average_view_duration FLOAT DEFAULT 0,
  average_view_percentage FLOAT DEFAULT 0,
  retention_rate FLOAT DEFAULT 0, -- 0.0 to 1.0
  
  -- CTR
  impressions BIGINT DEFAULT 0,
  ctr FLOAT DEFAULT 0, -- click-through rate
  
  -- Subscribers
  subscribers_gained INT DEFAULT 0,
  subscribers_lost INT DEFAULT 0,
  
  -- Revenue
  estimated_revenue FLOAT DEFAULT 0,
  
  -- Performance Tags
  is_viral BOOLEAN DEFAULT FALSE,
  performance_tier TEXT, -- S, A, B, C, D
  
  -- Snapshots for trend analysis
  metrics_history JSONB DEFAULT '[]'::JSONB,
  
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_analytics_views ON video_analytics (views DESC);
CREATE INDEX idx_analytics_retention ON video_analytics (retention_rate DESC);
CREATE INDEX idx_analytics_viral ON video_analytics (is_viral);

-- ============================================
-- 4. API COSTS TABLE
-- ============================================
CREATE TABLE api_costs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  video_id UUID REFERENCES videos(id),
  service TEXT NOT NULL, -- openrouter, elevenlabs, replicate, cloudinary, etc.
  endpoint TEXT,
  model TEXT,
  cost_usd FLOAT NOT NULL,
  tokens_used INT,
  request_metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_costs_date ON api_costs (created_at);
CREATE INDEX idx_costs_service ON api_costs (service);
CREATE INDEX idx_costs_video ON api_costs (video_id);

-- ============================================
-- 5. VIRAL PATTERNS TABLE
-- ============================================
CREATE TABLE viral_patterns (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  pattern_type TEXT NOT NULL, -- hook_style, topic_type, pacing, visual_style
  pattern_value TEXT NOT NULL,
  description TEXT,
  
  -- Statistical backing
  sample_size INT DEFAULT 0,
  avg_views FLOAT DEFAULT 0,
  avg_retention FLOAT DEFAULT 0,
  avg_ctr FLOAT DEFAULT 0,
  confidence_score FLOAT DEFAULT 0,
  
  -- Usage
  times_used INT DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  
  -- Source videos
  source_video_ids UUID[],
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_patterns_type ON viral_patterns (pattern_type);
CREATE INDEX idx_patterns_confidence ON viral_patterns (confidence_score DESC);

-- ============================================
-- 6. UPLOAD SCHEDULE TABLE
-- ============================================
CREATE TABLE upload_schedule (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  video_id UUID REFERENCES videos(id),
  channel_id TEXT NOT NULL,
  
  scheduled_date DATE NOT NULL,
  scheduled_time TIME NOT NULL,
  timezone TEXT DEFAULT 'Asia/Kolkata',
  
  status TEXT DEFAULT 'pending', -- pending, uploading, completed, failed
  actual_upload_at TIMESTAMPTZ,
  error TEXT,
  retry_count INT DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_schedule_date ON upload_schedule (scheduled_date, scheduled_time);
CREATE INDEX idx_schedule_status ON upload_schedule (status);

-- ============================================
-- 7. CHANNEL CONFIG TABLE (multi-channel support)
-- ============================================
CREATE TABLE channels (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  youtube_channel_id TEXT UNIQUE NOT NULL,
  channel_name TEXT NOT NULL,
  niche TEXT NOT NULL,
  
  -- Auth
  refresh_token TEXT,
  access_token TEXT,
  token_expiry TIMESTAMPTZ,
  
  -- Config
  videos_per_day INT DEFAULT 2,
  upload_times TEXT[] DEFAULT ARRAY['11:00', '19:00'],
  timezone TEXT DEFAULT 'Asia/Kolkata',
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  total_videos_uploaded INT DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 8. PIPELINE RUNS TABLE (audit trail)
-- ============================================
CREATE TABLE pipeline_runs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  video_id UUID REFERENCES videos(id),
  channel_id TEXT,
  
  status TEXT DEFAULT 'running', -- running, completed, failed
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  
  steps_completed TEXT[],
  current_step TEXT,
  error TEXT,
  error_stack TEXT,
  
  duration_seconds FLOAT,
  total_cost_usd FLOAT DEFAULT 0,
  
  metadata JSONB
);

CREATE INDEX idx_pipeline_status ON pipeline_runs (status);
CREATE INDEX idx_pipeline_video ON pipeline_runs (video_id);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================
ALTER TABLE topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE viral_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE upload_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "Service role full access" ON topics FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON videos FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON video_analytics FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON api_costs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON viral_patterns FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON upload_schedule FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON channels FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON pipeline_runs FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER topics_updated_at BEFORE UPDATE ON topics FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER videos_updated_at BEFORE UPDATE ON videos FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER video_analytics_updated_at BEFORE UPDATE ON video_analytics FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER viral_patterns_updated_at BEFORE UPDATE ON viral_patterns FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER channels_updated_at BEFORE UPDATE ON channels FOR EACH ROW EXECUTE FUNCTION update_updated_at();
