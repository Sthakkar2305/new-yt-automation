import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createModuleLogger } from '../../utils/logger.js';
import config from '../../config/index.js';
import { ensureDir } from '../../utils/helpers.js';
import pRetry from 'p-retry';

const execAsync = promisify(exec);
const logger = createModuleLogger('voiceover-generator');

/**
 * ============================================
 * 100% FREE VOICE GENERATION
 * 
 * Provider: Microsoft Edge TTS
 * - Completely free, no API key
 * - High quality neural voices
 * - Multiple voice options
 * - Requires: pip install edge-tts
 * 
 * Best voices for this niche:
 * - en-US-GuyNeural (deep, authoritative - RECOMMENDED)
 * - en-US-DavisNeural (calm, documentary style)
 * - en-US-AndrewNeural (confident, news anchor)
 * - en-GB-RyanNeural (British, sophisticated)
 * ============================================
 */

// Available free voices (all neural, high quality)
const VOICES = {
  authoritative: 'en-US-GuyNeural',       // Deep, commanding
  documentary: 'en-US-DavisNeural',        // Calm, narrative
  confident: 'en-US-AndrewNeural',         // News anchor style
  british: 'en-GB-RyanNeural',             // Sophisticated British
  dramatic: 'en-US-ChristopherNeural',     // Dramatic, intense
};

// ============================================
// CLEAN SCRIPT FOR TTS ENGINE
// ============================================
export function cleanScriptForTTS(script) {
  if (!script) return '';

  let clean = script;

  // 1. Convert pause markers to natural TTS punctuation pauses
  clean = clean.replace(/\[pause-short\]/gi, ', ');
  clean = clean.replace(/\[pause-medium\]/gi, '. ');
  clean = clean.replace(/\[pause-long\]/gi, '... ');

  // 2. Remove all remaining bracketed markers
  clean = clean.replace(/\[[^\]]*\]/g, '');

  // 3. Remove symbols that could break TTS or be read awkwardly
  clean = clean.replace(/[*#_~`@$%^&()=+{}|\\]/g, '');

  // 4. Remove duplicate punctuation, keeping ellipses intact
  clean = clean.replace(/,\s*,/g, ',');
  clean = clean.replace(/\.{4,}/g, '...');
  clean = clean.replace(/(?<!\.)\.\.(?!\.)/g, '.');

  // 5. Clean up multiple spaces and trim
  clean = clean.replace(/\s+/g, ' ').trim();

  return clean;
}

// ============================================
// GENERATE VOICEOVER WITH EDGE TTS (FREE)
// ============================================
async function generateWithEdgeTTS(script, outputPath, voice, rate, pitch) {
  // Clean script to ensure zero spoken pauses, punctuation names, or weird characters
  const cleanedText = cleanScriptForTTS(script);

  // Prepare script for command line without introducing backslashes
  const escapedScript = cleanedText
    .replace(/"/g, "'") // Convert double quotes to single quotes to prevent breaking the CLI double-quoted wrapper
    .replace(/\n/g, ' ')
    .replace(/`/g, '')
    .replace(/\$/g, '')
    .replace(/\\/g, ''); // Ensure absolutely no backslashes exist in the final command string

  const selectedVoice = voice || config.voice.defaultVoice || 'en-US-SteffanNeural';
  const selectedRate = rate || config.voice.rate || '-5%';
  const selectedPitch = pitch || config.voice.pitch || '-10Hz';

  const outputPathNormalized = outputPath.replace(/\\/g, '/');

  // Build edge-tts command
  const cmd = `edge-tts --voice "${selectedVoice}" --rate="${selectedRate}" --pitch="${selectedPitch}" --text "${escapedScript}" --write-media "${outputPathNormalized}"`;

  logger.info(`Generating voiceover with Edge TTS (FREE) - Voice: ${selectedVoice} | Speed: ${selectedRate} | Pitch: ${selectedPitch}`);

  try {
    await execAsync(cmd, { timeout: 60000 });
    logger.info('✅ Edge TTS voiceover generated successfully - $0.00');
    return outputPathNormalized;
  } catch (err) {
    // If edge-tts isn't installed, try with Python module syntax
    if (err.message.includes('not recognized') || err.message.includes('not found')) {
      logger.warn('edge-tts command not found, trying python -m edge_tts...');
      const pythonCmd = `python -m edge_tts --voice "${selectedVoice}" --rate="${selectedRate}" --pitch="${selectedPitch}" --text "${escapedScript}" --write-media "${outputPathNormalized}"`;
      await execAsync(pythonCmd, { timeout: 60000 });
      return outputPathNormalized;
    }
    throw err;
  }
}

// ============================================
// GET AUDIO DURATION WITH FFPROBE
// ============================================
async function getAudioDuration(filePath) {
  try {
    const filePathNormalized = filePath.replace(/\\/g, '/');
    const { stdout } = await execAsync(
      `"${config.processing.ffprobePath}" -v quiet -show_entries format=duration -of csv=p=0 "${filePathNormalized}"`
    );
    const duration = parseFloat(stdout.trim());
    if (isNaN(duration)) throw new Error('Invalid duration');
    return duration;
  } catch (err) {
    logger.warn('FFprobe duration detection failed, estimating from file size');
    // Estimate: ~16KB per second for MP3
    try {
      const stats = await fs.stat(filePath);
      return Math.round(stats.size / 16000);
    } catch {
      return 30; // Default fallback
    }
  }
}

// ============================================
// CONVERT MP3 TO PROPER FORMAT IF NEEDED
// ============================================
async function ensureAudioFormat(inputPath, outputDir) {
  const mp3Path = path.join(outputDir, 'voiceover.mp3');

  const inputPathNormalized = inputPath.replace(/\\/g, '/');
  const mp3PathNormalized = mp3Path.replace(/\\/g, '/');

  // Edge TTS outputs MP3 by default, but let's ensure proper format
  if (inputPathNormalized.endsWith('.mp3')) {
    return inputPathNormalized;
  }

  // Convert to MP3 with FFmpeg
  const cmd = `"${config.processing.ffmpegPath}" -y -i "${inputPathNormalized}" -codec:a libmp3lame -b:a 192k "${mp3PathNormalized}"`;
  await execAsync(cmd, { timeout: 30000 });
  return mp3PathNormalized;
}

// ============================================
function isPsychologyCategory(category) {
  const psychoCategories = ['dark_psychology', 'body_language', 'neuroscience', 'mental_health', 'social_dynamics', 'personality_traits', 'subconscious_mind'];
  return psychoCategories.includes(category);
}

export async function generateVoiceover(script, videoId, category) {
  const outputDir = path.join(config.processing.tempDir, videoId);
  await ensureDir(outputDir);

  const outputPath = path.join(outputDir, 'voiceover.mp3');
  const outputPathNormalized = outputPath.replace(/\\/g, '/');

  const selectedVoice = config.voice.defaultVoice || 'en-US-SteffanNeural';
  
  const isPsycho = isPsychologyCategory(category);
  const selectedRate = isPsycho ? '-20%' : '+5%';
  const selectedPitch = isPsycho ? '-25Hz' : '-5Hz';

  // Generate with retry logic
  await pRetry(
    () => generateWithEdgeTTS(script, outputPathNormalized, selectedVoice, selectedRate, selectedPitch),
    {
      retries: 3,
      minTimeout: 3000,
      onFailedAttempt: (error) => {
        logger.warn(`Edge TTS attempt ${error.attemptNumber} failed`, {
          error: error.message,
        });
        // Try a different voice on retry
        if (error.attemptNumber === 2) {
          logger.info('Trying alternative voice: DavisNeural');
        }
      },
    }
  );

  // Verify file exists
  try {
    await fs.access(outputPathNormalized);
  } catch {
    throw new Error('Voiceover file was not created');
  }

  // Get duration
  const duration = await getAudioDuration(outputPathNormalized);

  logger.info(`🎙️ Voiceover ready: ${duration.toFixed(1)}s | Voice: Edge TTS | Cost: $0.00 FREE`);

  return {
    filePath: outputPathNormalized,
    duration,
    provider: 'edge-tts (FREE)',
    cost: 0,
  };
}

// ============================================
// LIST AVAILABLE VOICES (utility)
// ============================================
export async function listAvailableVoices() {
  try {
    const { stdout } = await execAsync('edge-tts --list-voices', { timeout: 15000 });
    const englishVoices = stdout.split('\n')
      .filter(line => line.includes('en-'))
      .map(line => line.trim());
    return englishVoices;
  } catch {
    return Object.entries(VOICES).map(([key, val]) => `${key}: ${val}`);
  }
}

export default { generateVoiceover, listAvailableVoices };
