import express from 'express';
import config from '../config/index.js';
import {
  exchangeAuthCode,
  getAuthUrl,
  saveYouTubeRefreshToken,
  validateYouTubeAuth,
} from '../modules/youtube-uploader/index.js';

const redirectUrl = new URL(config.youtube.redirectUri);
const app = express();
const host = redirectUrl.hostname;
const port = Number(redirectUrl.port || 80);
let server;

app.get(redirectUrl.pathname, async (req, res) => {
  try {
    const { code, error } = req.query;

    if (error) {
      throw new Error(`Google authorization failed: ${error}`);
    }

    if (!code) {
      res.status(400).send('No authorization code received from Google.');
      return;
    }

    const tokens = await exchangeAuthCode(code);
    if (!tokens.refresh_token) {
      throw new Error(
        'Google did not return a refresh token. Revoke this app in your Google Account access page, then run this command again.'
      );
    }

    await saveYouTubeRefreshToken(tokens.refresh_token);
    await validateYouTubeAuth();

    res.send('YouTube authorization saved. You can close this tab and run: npm run youtube:auth-check');
    console.log('YouTube refresh token saved and verified.');
    console.log('Next: npm run youtube:auth-check');

    setTimeout(() => {
      server.close(() => process.exit(0));
    }, 500);
  } catch (err) {
    console.error('YouTube re-authorization failed.');
    console.error(err.message);
    res.status(500).send(`YouTube re-authorization failed: ${err.message}`);
  }
});

server = app.listen(port, host, () => {
  console.log(`Listening for Google callback on ${config.youtube.redirectUri}`);
  console.log('');
  console.log('Open this URL in your browser and approve YouTube access:');
  console.log(getAuthUrl());
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use.`);
    console.error('Stop the server using that port, then run: npm run youtube:reauth');
  } else {
    console.error(err.message);
  }
  process.exit(1);
});
