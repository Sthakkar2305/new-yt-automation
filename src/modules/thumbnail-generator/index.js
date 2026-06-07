import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { createModuleLogger } from '../../utils/logger.js';
import config from '../../config/index.js';
import { ensureDir } from '../../utils/helpers.js';

const execAsync = promisify(exec);
const logger = createModuleLogger('thumbnail-generator');

/**
 * Generate a thumbnail from the video's most visually striking frame.
 * Uses FFmpeg to extract a frame and apply cinematic enhancements.
 */
export async function generateThumbnail(videoPath, videoId) {
  const outputDir = path.join(config.processing.tempDir, videoId);
  await ensureDir(outputDir);

  const thumbnailPath = path.join(outputDir, 'thumbnail.jpg');

  const videoPathNormalized = videoPath.replace(/\\/g, '/');
  const thumbnailPathNormalized = thumbnailPath.replace(/\\/g, '/');

  // Extract frame at 2 seconds (typically the hook visual)
  // Apply heavy contrast boost, cinematic vignette, and sharpening
  const cmd = [
    `"${config.processing.ffmpegPath}" -y`,
    `-ss 2 -i "${videoPathNormalized}"`,
    `-vframes 1`,
    `-vf "eq=contrast=1.4:brightness=0.06:saturation=1.5,vignette=PI/4,unsharp=5:5:1.5:5:5:0.0"`,
    `-q:v 2`,
    `"${thumbnailPathNormalized}"`,
  ].join(' ');

  try {
    await execAsync(cmd, { timeout: 30000 });
    logger.info(`Thumbnail generated: ${thumbnailPathNormalized}`);
    return thumbnailPathNormalized;
  } catch (err) {
    logger.error('Thumbnail generation failed', { error: err.message });
    // Fallback: just extract a raw frame
    const fallbackCmd = `"${config.processing.ffmpegPath}" -y -ss 1 -i "${videoPathNormalized}" -vframes 1 "${thumbnailPathNormalized}"`;
    await execAsync(fallbackCmd, { timeout: 15000 });
    return thumbnailPathNormalized;
  }
}

export default { generateThumbnail };
