import { getAuthUrl, validateYouTubeAuth } from '../modules/youtube-uploader/index.js';

try {
  await validateYouTubeAuth();
  console.log('YouTube OAuth OK. You can run: npm run pipeline:upload');
} catch (err) {
  console.error('YouTube OAuth check failed.');
  console.error(err.message);
  console.error('');
  console.error('Fix it with: npm run youtube:reauth');
  console.error('Or open this auth URL while the local auth callback server is running:');
  console.error(getAuthUrl());
  process.exit(1);
}
