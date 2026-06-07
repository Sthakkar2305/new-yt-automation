import dotenv from 'dotenv';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';

dotenv.config();

const config = {
  // Server
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000'),
  apiSecretKey: process.env.API_SECRET_KEY,

  // Supabase (FREE tier: 500MB storage, 50K rows)
  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },

  // AI - Gemini (FREE: 15 requests/min, 1M tokens/day)
  ai: {
    gemini: {
      apiKey: process.env.GEMINI_API_KEY,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.0-flash-lite',       // Free, extremely stable and fast
      modelPro: 'gemini-2.0-flash',   // For deeper analysis
    },
  },

  // Image Generation - NVIDIA FLUX (FREE credits) + fallback chain
  imageGen: {
    provider: process.env.IMAGE_PROVIDER || 'nvidia-flux',
    nvidiaApiKey: process.env.NVIDIA_API_KEY || '',
    stableDiffusionUrl: process.env.STABLE_DIFFUSION_API_URL || 'http://127.0.0.1:7860',
    stableDiffusionModel: process.env.STABLE_DIFFUSION_MODEL || '',
    stableDiffusionSampler: process.env.STABLE_DIFFUSION_SAMPLER || 'DPM++ 2M Karras',
    stableDiffusionSteps: parseInt(process.env.STABLE_DIFFUSION_STEPS || '8'),
    stableDiffusionCfgScale: parseFloat(process.env.STABLE_DIFFUSION_CFG_SCALE || '2.5'),
    stableDiffusionWidth: parseInt(process.env.STABLE_DIFFUSION_WIDTH || '768'),
    stableDiffusionHeight: parseInt(process.env.STABLE_DIFFUSION_HEIGHT || '1344'),
    stableDiffusionTimeoutMs: parseInt(process.env.STABLE_DIFFUSION_TIMEOUT_MS || '180000'),
    stableDiffusionUsername: process.env.STABLE_DIFFUSION_USERNAME || '',
    stableDiffusionPassword: process.env.STABLE_DIFFUSION_PASSWORD || '',
  },

  // Voice - Edge TTS (100% FREE, no API key)
  voice: {
    provider: 'edge-tts',
    defaultVoice: process.env.VOICE_NAME || 'en-US-GuyNeural', // Deep, authoritative male
    rate: process.env.VOICE_RATE || '+2%', // Speed rate (slower/more natural than default)
    pitch: process.env.VOICE_PITCH || '-3Hz', // Frequency pitch (deeper tone)
  },

  // YouTube (FREE: 10,000 API units/day)
  youtube: {
    clientId: process.env.YOUTUBE_CLIENT_ID,
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
    redirectUri: process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:3000/auth/youtube/callback',
    refreshToken: process.env.YOUTUBE_REFRESH_TOKEN,
    channelId: process.env.CHANNEL_ID,
  },

  // Scheduling
  schedule: {
    timezone: process.env.TIMEZONE || 'Asia/Kolkata',
    uploadTimes: [
      process.env.UPLOAD_SCHEDULE_1 || '11:00',
      process.env.UPLOAD_SCHEDULE_2 || '19:00',
    ],
    videosPerDay: parseInt(process.env.VIDEOS_PER_DAY || '2'),
  },

  // Processing
  processing: {
    ffmpegPath: ffmpegInstaller.path,
    ffprobePath: ffprobeInstaller.path,
    tempDir: process.env.TEMP_DIR || './temp',
    outputDir: process.env.OUTPUT_DIR || './output',
    cleanupTempAfterUpload: process.env.CLEANUP_TEMP_AFTER_UPLOAD === 'true',
  },

  // Channel
  channel: {
    id: process.env.CHANNEL_ID,
    name: process.env.CHANNEL_NAME || 'AI Facts & Future Tech',
    niche: process.env.NICHE || 'ai-future-tech',
  },

  // Video Output Specs
  videoSpecs: {
    width: 1080,
    height: 1920,
    fps: 30,
    format: 'mp4',
    codec: 'libx264',
    audioCodec: 'aac',
    audioBitrate: '192k',
    videoBitrate: '4000k',
    preset: 'ultrafast',
    duration: { min: 25, max: 40 },
  },

  // Content Rules
  content: {
    maxScriptWords: 90,
    minScenes: 4,
    maxScenes: 8,
    hookMaxWords: 12,
    subtitleMaxCharsPerLine: 35,
    subtitleMinWords: 2,
    subtitleMaxWords: 5,
  },

  // Cost tracking (everything is free but we track API usage)
  costs: {
    dailyBudgetUsd: 0, // FREE!
    enableTracking: true,
  },
};

// Validation
function validateConfig() {
  const missing = [];
  if (!config.ai.gemini.apiKey) missing.push('GEMINI_API_KEY');
  if (!config.supabase.url) missing.push('SUPABASE_URL');
  if (!config.supabase.serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');

  if (missing.length > 0) {
    console.warn(`\n⚠️  Missing required config: ${missing.join(', ')}`);
    console.warn('   Copy .env.example to .env and fill in the values\n');
  }
}

validateConfig();

export default config;
