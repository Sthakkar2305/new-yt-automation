import { Router } from 'express';
import {
  getAuthUrl,
  exchangeAuthCode,
  saveYouTubeRefreshToken,
} from '../modules/youtube-uploader/index.js';
import { createModuleLogger } from '../utils/logger.js';

const router = Router();
const logger = createModuleLogger('auth');

// Get YouTube OAuth URL
router.get('/youtube', (req, res) => {
  const url = getAuthUrl();
  res.json({ authUrl: url, instructions: 'Visit this URL to authorize YouTube access' });
});

// YouTube OAuth callback
router.get('/youtube/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) {
      return res.status(400).json({ error: 'No authorization code provided' });
    }

    const tokens = await exchangeAuthCode(code);
    logger.info('YouTube OAuth tokens received');

    if (tokens.refresh_token) {
      await saveYouTubeRefreshToken(tokens.refresh_token);
      logger.info('Programmatically updated YOUTUBE_REFRESH_TOKEN in .env');
    }

    res.json({
      message: 'YouTube authorization successful!',
      refreshTokenSaved: !!tokens.refresh_token,
      instructions: tokens.refresh_token 
        ? 'We have automatically saved this Refresh Token directly into your .env file! You can now close this tab, stop your local server (Ctrl+C), and run "npm run pipeline:upload".'
        : 'Warning: No refresh token returned by Google. Please make sure to revoke access in Google security settings if re-authorizing, or double-check your credentials.',
    });
  } catch (err) {
    logger.error('YouTube OAuth failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

export default router;
