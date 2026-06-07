import { google } from 'googleapis';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { createModuleLogger } from '../../utils/logger.js';
import config from '../../config/index.js';
import { updateVideo } from '../../database/client.js';
import pRetry, { AbortError } from 'p-retry';

const logger = createModuleLogger('youtube-uploader');

// ============================================
// OAUTH2 CLIENT
// ============================================
function getOAuth2Client() {
  const oauth2Client = new google.auth.OAuth2(
    config.youtube.clientId,
    config.youtube.clientSecret,
    config.youtube.redirectUri
  );
  oauth2Client.setCredentials({
    refresh_token: config.youtube.refreshToken,
  });
  return oauth2Client;
}

function getYouTubeClient(auth = getOAuth2Client()) {
  return google.youtube({ version: 'v3', auth });
}

function getOAuthErrorInfo(err) {
  const data = err?.response?.data || {};
  return {
    error: data.error || err?.code || '',
    description: data.error_description || err?.message || '',
    status: err?.response?.status || err?.code || '',
  };
}

function isInvalidGrantError(err) {
  const info = getOAuthErrorInfo(err);
  return info.error === 'invalid_grant' || info.description.includes('invalid_grant');
}

function createYouTubeAuthError(err) {
  const info = getOAuthErrorInfo(err);
  const detail = info.description ? ` Google says: ${info.description}` : '';
  const authError = new Error(
    `YouTube OAuth refresh token is expired or revoked.${detail} ` +
    'Run "npm run youtube:reauth", finish Google sign-in, then run "npm run youtube:auth-check".'
  );
  authError.code = 'YOUTUBE_AUTH_INVALID_GRANT';
  authError.reauthorizationRequired = true;
  authError.originalError = err;
  return authError;
}

function assertYouTubeAuthConfig() {
  const missing = [];
  if (!config.youtube.clientId) missing.push('YOUTUBE_CLIENT_ID');
  if (!config.youtube.clientSecret) missing.push('YOUTUBE_CLIENT_SECRET');
  if (!config.youtube.redirectUri) missing.push('YOUTUBE_REDIRECT_URI');
  if (!config.youtube.refreshToken) missing.push('YOUTUBE_REFRESH_TOKEN');

  if (missing.length > 0) {
    const err = new Error(`Missing YouTube OAuth config: ${missing.join(', ')}`);
    err.code = 'YOUTUBE_AUTH_MISSING_CONFIG';
    throw err;
  }
}

export async function validateYouTubeAuth(oauth2Client = getOAuth2Client()) {
  assertYouTubeAuthConfig();

  try {
    const accessToken = await oauth2Client.getAccessToken();
    if (!accessToken?.token) {
      throw new Error('Google did not return an access token.');
    }
    return oauth2Client;
  } catch (err) {
    if (isInvalidGrantError(err)) {
      throw createYouTubeAuthError(err);
    }
    throw err;
  }
}

export async function getYouTubeVideoStatus(youtubeId) {
  if (!youtubeId) {
    throw new Error('A YouTube video ID is required.');
  }

  const auth = await validateYouTubeAuth();
  const youtube = getYouTubeClient(auth);

  const [channelsResponse, videosResponse] = await Promise.all([
    youtube.channels.list({
      part: 'snippet,id',
      mine: true,
    }),
    youtube.videos.list({
      part: 'snippet,status,processingDetails',
      id: youtubeId,
    }),
  ]);

  const authorizedChannels = (channelsResponse.data.items || []).map((channel) => ({
    id: channel.id,
    title: channel.snippet?.title,
  }));

  const video = videosResponse.data.items?.[0];
  if (!video) {
    return {
      youtubeId,
      found: false,
      authorizedChannels,
      youtubeUrl: `https://youtube.com/shorts/${youtubeId}`,
      watchUrl: `https://www.youtube.com/watch?v=${youtubeId}`,
    };
  }

  return {
    youtubeId,
    found: true,
    authorizedChannels,
    youtubeUrl: `https://youtube.com/shorts/${youtubeId}`,
    watchUrl: `https://www.youtube.com/watch?v=${youtubeId}`,
    channelId: video.snippet?.channelId,
    channelTitle: video.snippet?.channelTitle,
    title: video.snippet?.title,
    privacyStatus: video.status?.privacyStatus,
    uploadStatus: video.status?.uploadStatus,
    embeddable: video.status?.embeddable,
    madeForKids: video.status?.madeForKids,
    processingStatus: video.processingDetails?.processingStatus,
    processingFailureReason: video.processingDetails?.processingFailureReason,
  };
}

export async function saveYouTubeRefreshToken(refreshToken) {
  if (!refreshToken) {
    throw new Error('No YouTube refresh token was returned by Google.');
  }

  const envPath = path.resolve(process.cwd(), '.env');
  let envContent = '';

  try {
    envContent = await fsp.readFile(envPath, 'utf8');
  } catch {
    envContent = '';
  }

  const tokenLine = `YOUTUBE_REFRESH_TOKEN=${refreshToken}`;
  const tokenPattern = /^YOUTUBE_REFRESH_TOKEN=.*$/m;

  if (tokenPattern.test(envContent)) {
    envContent = envContent.replace(tokenPattern, tokenLine);
  } else {
    envContent = `${envContent.trimEnd()}\n${tokenLine}\n`;
  }

  await fsp.writeFile(envPath, envContent, 'utf8');
  config.youtube.refreshToken = refreshToken;
}

// ============================================
// UPLOAD VIDEO TO YOUTUBE
// ============================================
export async function uploadToYouTube(videoData) {
  const {
    videoId,        // Internal DB ID
    filePath,       // Local file path
    title,
    description,
    tags,
    thumbnailPath,
    scheduledTime,  // ISO string or null for immediate
  } = videoData;

  logger.info(`Uploading video: "${title}"...`);

  const auth = getOAuth2Client();
  try {
    await validateYouTubeAuth(auth);
  } catch (err) {
    await updateVideo(videoId, {
      youtube_status: 'auth_failed',
      upload_error: err.message,
    }).catch(() => {});
    throw err;
  }

  const youtube = getYouTubeClient(auth);

  const uploadFn = async () => {
    try {
      // Step 1: Upload video
      const videoResource = {
        snippet: {
          title,
          description,
          tags,
          categoryId: '28', // Science & Technology
          defaultLanguage: 'en',
          defaultAudioLanguage: 'en',
        },
        status: {
          privacyStatus: scheduledTime ? 'private' : 'public',
          selfDeclaredMadeForKids: false,
          embeddable: true,
          ...(scheduledTime ? {
            publishAt: scheduledTime,
            privacyStatus: 'private',
          } : {}),
        },
      };

      const response = await youtube.videos.insert({
        part: 'snippet,status',
        requestBody: videoResource,
        media: {
          body: fs.createReadStream(filePath),
        },
      });

      const youtubeId = response.data.id;
      const youtubeUrl = `https://youtube.com/shorts/${youtubeId}`;

      logger.info(`Video uploaded: ${youtubeUrl}`);

      // Step 2: Upload thumbnail
      if (thumbnailPath) {
        try {
          await youtube.thumbnails.set({
            videoId: youtubeId,
            media: {
              body: fs.createReadStream(thumbnailPath),
            },
          });
          logger.info('Thumbnail uploaded');
        } catch (thumbErr) {
          logger.warn('Thumbnail upload failed (channel may need verification)', {
            error: thumbErr.message,
          });
        }
      }

      // Step 3: If scheduled, set to publish at scheduled time
      if (scheduledTime) {
        try {
          await youtube.videos.update({
            part: 'status',
            requestBody: {
              id: youtubeId,
              status: {
                privacyStatus: 'private',
                publishAt: scheduledTime,
              },
            },
          });
          logger.info(`Video scheduled for: ${scheduledTime}`);
        } catch (schedErr) {
          logger.warn('Scheduling failed, video uploaded as public', {
            error: schedErr.message,
          });
          // Make it public immediately as fallback
          await youtube.videos.update({
            part: 'status',
            requestBody: {
              id: youtubeId,
              status: { privacyStatus: 'public' },
            },
          });
        }
      }

      const uploadStatus = await getYouTubeVideoStatus(youtubeId);
      logger.info('Verified YouTube upload status', {
        youtubeId,
        channelTitle: uploadStatus.channelTitle,
        channelId: uploadStatus.channelId,
        privacyStatus: uploadStatus.privacyStatus,
        uploadStatus: uploadStatus.uploadStatus,
        processingStatus: uploadStatus.processingStatus,
      });

      // Step 4: Update database
      await updateVideo(videoId, {
        youtube_id: youtubeId,
        youtube_url: youtubeUrl,
        youtube_status: 'uploaded',
        status: 'uploaded',
        published_at: scheduledTime || new Date().toISOString(),
      });

      return {
        youtubeId,
        youtubeUrl,
        status: 'uploaded',
      };
    } catch (err) {
      if (isInvalidGrantError(err)) {
        throw new AbortError(createYouTubeAuthError(err));
      }
      throw err;
    }
  };

  return pRetry(uploadFn, {
    retries: 3,
    minTimeout: 5000,
    factor: 2,
    onFailedAttempt: async (error) => {
      logger.warn(`Upload attempt ${error.attemptNumber} failed`, {
        error: error.message,
      });
      // Update retry count in DB
      await updateVideo(videoId, {
        retry_count: error.attemptNumber,
        upload_error: error.message,
      });
    },
  });
}

// ============================================
// GET UPLOAD AUTH URL (for initial setup)
// ============================================
export function getAuthUrl() {
  const oauth2Client = getOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // Forces Google to always return a refresh token on every sign-in
    scope: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube',
      'https://www.googleapis.com/auth/youtube.readonly',
    ],
  });
}

// ============================================
// EXCHANGE AUTH CODE FOR TOKENS
// ============================================
export async function exchangeAuthCode(code) {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  logger.info('YouTube tokens obtained', {
    hasRefreshToken: !!tokens.refresh_token,
  });
  return tokens;
}

export default {
  uploadToYouTube,
  getAuthUrl,
  exchangeAuthCode,
  saveYouTubeRefreshToken,
  validateYouTubeAuth,
  getYouTubeVideoStatus,
};
