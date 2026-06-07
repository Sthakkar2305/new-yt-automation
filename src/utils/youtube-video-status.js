import { getYouTubeVideoStatus } from '../modules/youtube-uploader/index.js';

const youtubeId = process.argv[2];

if (!youtubeId) {
  console.error('Usage: npm run youtube:status -- <youtube_video_id>');
  process.exit(1);
}

try {
  const status = await getYouTubeVideoStatus(youtubeId);

  console.log(`YouTube ID: ${status.youtubeId}`);
  console.log(`Shorts URL: ${status.youtubeUrl}`);
  console.log(`Watch URL: ${status.watchUrl}`);

  if (!status.found) {
    console.log('Status: not found by the authorized account.');
    console.log('Authorized channels:');
    for (const channel of status.authorizedChannels) {
      console.log(`- ${channel.title} (${channel.id})`);
    }
    process.exit(2);
  }

  console.log(`Channel: ${status.channelTitle} (${status.channelId})`);
  console.log(`Title: ${status.title}`);
  console.log(`Privacy: ${status.privacyStatus}`);
  console.log(`Upload status: ${status.uploadStatus}`);
  console.log(`Processing: ${status.processingStatus || 'unknown'}`);

  if (status.processingFailureReason) {
    console.log(`Processing failure: ${status.processingFailureReason}`);
  }
} catch (err) {
  console.error('YouTube status check failed.');
  console.error(err.message);
  process.exit(1);
}
