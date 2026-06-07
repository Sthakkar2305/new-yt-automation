import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { createModuleLogger } from '../../utils/logger.js';
import config from '../../config/index.js';
import { ensureDir } from '../../utils/helpers.js';

const execAsync = promisify(exec);
const logger = createModuleLogger('video-composer');

// Helper to escape file paths for FFmpeg filtergraphs (like the ass filter) on Windows
export function escapeFFmpegPath(filePath) {
  const absolutePath = path.resolve(filePath);
  const normalized = absolutePath.replace(/\\/g, '/');
  // Escape colons to prevent FFmpeg from interpreting them as option delimiters on Windows
  const colonEscaped = normalized.replace(/:/g, '\\:');
  const escaped = colonEscaped.replace(/'/g, "\\'");
  return `'${escaped}'`;
}

// ============================================
// MUSIC TRACKS (royalty-free ambient/dark)
// ============================================
const MUSIC_URLS = {
  dark_ambient: 'https://cdn.pixabay.com/audio/2024/01/dark-ambient-atmosphere.mp3',
  cinematic_tension: 'https://cdn.pixabay.com/audio/2024/01/cinematic-tension.mp3',
  tech_pulse: 'https://cdn.pixabay.com/audio/2024/01/technology-pulse.mp3',
};

// ============================================
// STEP 1: Create video clips from images with motion
// ============================================
async function createImageClips(images, scenes, tempDir, voiceoverDuration) {
  const clipPaths = [];
  
  let totalSceneDuration = scenes.reduce((sum, s) => sum + (s.duration_seconds || 4), 0);
  if (totalSceneDuration === 0) totalSceneDuration = images.length * 4;
  
  const stretchRatio = voiceoverDuration ? (voiceoverDuration / totalSceneDuration) : 1.0;

  for (let i = 0; i < images.length; i++) {
    if (!images[i]) continue; // Skip failed images

    const scene = scenes[i] || { duration_seconds: 4, camera_direction: 'slow zoom in' };
    let duration = scene.duration_seconds || 4;
    
    // Stretch to match voiceover exactly
    if (voiceoverDuration) {
      duration = duration * stretchRatio;
    }
    
    // Safety check
    if (duration < 1) duration = 1;

    const clipPath = path.join(tempDir, `clip_${i}.mp4`);

    // Determine motion effect based on camera direction
    const motionFilter = getMotionFilter(scene.camera_direction, duration);

    const imagePathNormalized = images[i].replace(/\\/g, '/');
    const clipPathNormalized = clipPath.replace(/\\/g, '/');

    const cmd = [
      `"${config.processing.ffmpegPath}" -y`,
      `-loop 1 -i "${imagePathNormalized}"`,
      `-t ${duration}`,
      `-vf "${motionFilter},format=yuv420p"`,
      `-c:v ${config.videoSpecs.codec}`,
      `-preset ${config.videoSpecs.preset}`,
      `-b:v ${config.videoSpecs.videoBitrate}`,
      `-r ${config.videoSpecs.fps}`,
      `-pix_fmt yuv420p`,
      `"${clipPathNormalized}"`,
    ].join(' ');

    try {
      await execAsync(cmd, { timeout: 60000 });
      clipPaths.push(clipPathNormalized);
      logger.debug(`Created clip ${i + 1}: ${duration}s with ${scene.camera_direction}`);
    } catch (err) {
      logger.error(`Failed to create clip ${i + 1}`, { error: err.message });
    }
  }

  return clipPaths;
}

// ============================================
// MOTION FILTER GENERATOR
// ============================================
function getMotionFilter(direction, duration) {
  const w = config.videoSpecs.width;
  const h = config.videoSpecs.height;
  const fps = config.videoSpecs.fps;
  const totalFrames = duration * fps;

  // Scale image to be larger than output for zoom/pan room
  const scale = `scale=${w * 1.3}:${h * 1.3}`;

  switch (direction?.toLowerCase()) {
    case 'slow zoom in':
      return `${scale},zoompan=z='min(zoom+0.0015,1.3)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${w}x${h}:fps=${fps}`;

    case 'zoom out':
      return `${scale},zoompan=z='if(eq(on,1),1.3,max(zoom-0.0015,1))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${w}x${h}:fps=${fps}`;

    case 'pan left':
      return `${scale},zoompan=z='1.1':x='if(eq(on,1),0,min(x+2,iw-iw/zoom))':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${w}x${h}:fps=${fps}`;

    case 'pan right':
      return `${scale},zoompan=z='1.1':x='if(eq(on,1),iw-iw/zoom,max(x-2,0))':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${w}x${h}:fps=${fps}`;

    case 'pan up':
      return `${scale},zoompan=z='1.1':x='iw/2-(iw/zoom/2)':y='if(eq(on,1),ih-ih/zoom,max(y-1,0))':d=${totalFrames}:s=${w}x${h}:fps=${fps}`;

    case 'close-up':
      return `${scale},zoompan=z='min(zoom+0.003,1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${w}x${h}:fps=${fps}`;

    case 'wide shot':
      return `${scale},zoompan=z='if(eq(on,1),1.3,max(zoom-0.001,1.05))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${w}x${h}:fps=${fps}`;

    default: // Subtle zoom in (default)
      return `${scale},zoompan=z='min(zoom+0.001,1.2)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${w}x${h}:fps=${fps}`;
  }
}

// ============================================
// STEP 2: Concatenate clips with transitions
// ============================================
async function concatenateClips(clipPaths, tempDir) {
  const concatFile = path.join(tempDir, 'concat.txt');
  // Write relative filenames since FFmpeg will resolve them relative to concat.txt's directory.
  // The directory path passed to FFmpeg will have forward slashes, so FFmpeg will resolve it correctly.
  const concatContent = clipPaths.map((_, i) => `file 'clip_${i}.mp4'`).join('\n');
  await fs.writeFile(concatFile, concatContent);

  const outputPath = path.join(tempDir, 'raw_video.mp4');

  const concatFileNormalized = path.resolve(concatFile).replace(/\\/g, '/');
  const outputPathNormalized = path.resolve(outputPath).replace(/\\/g, '/');

  // Simple concatenation (transitions handled via scene cuts)
  const cmd = [
    `"${config.processing.ffmpegPath}" -y`,
    `-f concat -safe 0 -i "${concatFileNormalized}"`,
    `-c:v ${config.videoSpecs.codec}`,
    `-preset ${config.videoSpecs.preset}`,
    `-b:v ${config.videoSpecs.videoBitrate}`,
    `-r ${config.videoSpecs.fps}`,
    `-pix_fmt yuv420p`,
    `"${outputPathNormalized}"`,
  ].join(' ');

  await execAsync(cmd, { timeout: 120000 });
  logger.info('Clips concatenated into raw video');
  return outputPathNormalized;
}

// ============================================
// STEP 3: Add voiceover
// ============================================
async function addVoiceover(videoPath, voiceoverPath, tempDir) {
  const outputPath = path.join(tempDir, 'video_with_voice.mp4');

  const videoPathNormalized = path.resolve(videoPath).replace(/\\/g, '/');
  const voiceoverPathNormalized = path.resolve(voiceoverPath).replace(/\\/g, '/');
  const outputPathNormalized = path.resolve(outputPath).replace(/\\/g, '/');

  const cmd = [
    `"${config.processing.ffmpegPath}" -y`,
    `-i "${videoPathNormalized}"`,
    `-i "${voiceoverPathNormalized}"`,
    `-map 0:v -map 1:a`,
    `-c:v copy`,
    `-c:a ${config.videoSpecs.audioCodec}`,
    `-b:a ${config.videoSpecs.audioBitrate}`,
    `"${outputPathNormalized}"`,
  ].join(' ');

  await execAsync(cmd, { timeout: 60000 });
  logger.info('Voiceover added to video');
  return outputPathNormalized;
}

// ============================================
// STEP 4: Burn subtitles
// ============================================
async function burnSubtitles(videoPath, assPath, tempDir) {
  const outputPath = path.join(tempDir, 'video_with_subs.mp4');

  const assPathEscaped = escapeFFmpegPath(assPath);
  const videoPathNormalized = path.resolve(videoPath).replace(/\\/g, '/');
  const outputPathNormalized = path.resolve(outputPath).replace(/\\/g, '/');

  const cmd = [
    `"${config.processing.ffmpegPath}" -y`,
    `-i "${videoPathNormalized}"`,
    `-vf "ass=${assPathEscaped}"`,
    `-c:v ${config.videoSpecs.codec}`,
    `-preset ${config.videoSpecs.preset}`,
    `-b:v ${config.videoSpecs.videoBitrate}`,
    `-c:a copy`,
    `"${outputPathNormalized}"`,
  ].join(' ');

  await execAsync(cmd, { timeout: 120000 });
  logger.info('Subtitles burned into video');
  return outputPathNormalized;
}

// ============================================
// STEP 5: Add background music
// ============================================
async function addBackgroundMusic(videoPath, tempDir, mood) {
  const outputPath = path.join(tempDir, 'final_video.mp4');
  
  // Use a local music file or skip if not available
  const musicDir = path.join(config.processing.tempDir, 'music');
  await ensureDir(musicDir);

  const musicFile = path.join(musicDir, `${mood || 'dark_ambient'}.mp3`);
  
  const videoPathNormalized = path.resolve(videoPath).replace(/\\/g, '/');
  const outputPathNormalized = path.resolve(outputPath).replace(/\\/g, '/');

  // Check if music file exists
  try {
    await fs.access(musicFile);
  } catch {
    // No music file, just copy video as final
    await fs.copyFile(videoPathNormalized, outputPathNormalized);
    logger.info('No background music available, skipping');
    return outputPathNormalized;
  }

  const musicFileNormalized = path.resolve(musicFile).replace(/\\/g, '/');

  // Mix: voice at full volume, music at low volume
  const cmd = [
    `"${config.processing.ffmpegPath}" -y`,
    `-i "${videoPathNormalized}"`,
    `-i "${musicFileNormalized}"`,
    `-filter_complex "[0:a]volume=1.0[voice];[1:a]volume=0.08,afade=t=out:st=28:d=5[music];[voice][music]amix=inputs=2:duration=shortest[aout]"`,
    `-map 0:v -map "[aout]"`,
    `-c:v copy`,
    `-c:a ${config.videoSpecs.audioCodec}`,
    `-b:a ${config.videoSpecs.audioBitrate}`,
    `-shortest`,
    `"${outputPathNormalized}"`,
  ].join(' ');

  try {
    await execAsync(cmd, { timeout: 120000 });
    logger.info('Background music added');
  } catch (err) {
    logger.warn('Music mixing failed, using video without music', { error: err.message });
    await fs.copyFile(videoPathNormalized, outputPathNormalized);
  }

  return outputPathNormalized;
}

// ============================================
// MAIN COMPOSE FUNCTION
// ============================================
export async function composeVideo({ images, scenes, voiceoverPath, voiceoverDuration, subtitlePath, videoId, mood }) {
  const tempDir = path.resolve(config.processing.tempDir, videoId);
  const outputDir = path.resolve(config.processing.outputDir);
  await ensureDir(tempDir);
  await ensureDir(outputDir);

  logger.info(`Starting video composition for ${videoId}...`);

  const absoluteImages = images.map(img => path.resolve(img));
  const absoluteVoiceoverPath = path.resolve(voiceoverPath);
  const absoluteSubtitlePath = path.resolve(subtitlePath);

  // Step 1: Create motion clips from images
  logger.info(`Step 1/5: Creating motion clips (Target duration: ${voiceoverDuration}s)...`);
  const clipPaths = await createImageClips(absoluteImages, scenes, tempDir, voiceoverDuration);
  if (clipPaths.length < 3) throw new Error('Not enough clips to compose video');

  // Step 2: Concatenate clips
  logger.info('Step 2/5: Concatenating clips...');
  const rawVideo = await concatenateClips(clipPaths, tempDir);

  // Step 3: Add voiceover
  logger.info('Step 3/5: Adding voiceover...');
  const videoWithVoice = await addVoiceover(rawVideo, absoluteVoiceoverPath, tempDir);

  // Step 4: Burn subtitles
  logger.info('Step 4/5: Burning subtitles...');
  const videoWithSubs = await burnSubtitles(videoWithVoice, absoluteSubtitlePath, tempDir);

  // Step 5: Add background music
  logger.info('Step 5/5: Adding background music...');
  const finalVideo = await addBackgroundMusic(videoWithSubs, tempDir, mood);

  // Move to output directory
  const finalOutputPath = path.join(outputDir, `${videoId}.mp4`);
  const finalOutputPathNormalized = path.resolve(finalOutputPath).replace(/\\/g, '/');
  await fs.copyFile(finalVideo, finalOutputPathNormalized);

  // Get file info
  const stats = await fs.stat(finalOutputPathNormalized);
  const fileSizeMB = stats.size / (1024 * 1024);

  // Get duration
  let duration = 30;
  try {
    const { stdout } = await execAsync(
      `"${config.processing.ffprobePath}" -v quiet -show_entries format=duration -of csv=p=0 "${finalOutputPathNormalized}"`
    );
    duration = parseFloat(stdout.trim());
  } catch (e) {
    logger.warn('Could not determine video duration');
  }

  logger.info(`Video composition complete: ${finalOutputPathNormalized} (${fileSizeMB.toFixed(1)}MB, ${duration}s)`);

  return {
    filePath: finalOutputPathNormalized,
    duration,
    fileSizeMB: Math.round(fileSizeMB * 10) / 10,
  };
}

export default { composeVideo };
