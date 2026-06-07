import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createModuleLogger } from '../../utils/logger.js';
import config from '../../config/index.js';
import { ensureDir } from '../../utils/helpers.js';

const execAsync = promisify(exec);
const logger = createModuleLogger('subtitle-generator');

// ============================================
// HELPERS FOR PAUSE AND WEIGHT CALCULATION
// ============================================
export function stripPauseMarkers(text) {
  return text
    .replace(/\[pause-(short|medium|long)\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getWeight(text) {
  const cleanText = stripPauseMarkers(text);
  const words = cleanText.split(/\s+/).filter(w => w.length > 0);
  
  let weight = words.length;

  const shortPauses = (text.match(/\[pause-short\]/gi) || []).length;
  const mediumPauses = (text.match(/\[pause-medium\]/gi) || []).length;
  const longPauses = (text.match(/\[pause-long\]/gi) || []).length;

  weight += shortPauses * 1.5;
  weight += mediumPauses * 3.0;
  weight += longPauses * 5.0;

  return weight;
}

// ============================================
// GENERATE SRT FROM SCRIPT + DURATION
// ============================================
function generateSRT(script, totalDuration, scenes) {
  // Keep original sentences with pause markers intact to calculate weights
  const sentences = script
    .split(/(?<=[.!?…])\s+/)
    .filter(s => s.trim().length > 0)
    .map(s => s.trim());

  if (sentences.length === 0) return '';

  // Calculate timing based on weight distribution (spoken words + pause markers)
  const totalWeight = sentences.reduce((sum, s) => sum + getWeight(s), 0);
  let currentTime = 0;
  const srtEntries = [];

  const minWords = config.content.subtitleMinWords || 2;
  const maxWords = config.content.subtitleMaxWords || 5;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const sentenceWeight = getWeight(sentence);
    const segmentDuration = totalWeight > 0 ? (sentenceWeight / totalWeight) * totalDuration : 0;

    // Break sentence into 2-5 actual spoken words, keeping pause markers aligned
    const chunks = breakIntoWordChunks(sentence, minWords, maxWords);
    const totalChunkWeight = chunks.reduce((sum, c) => sum + getWeight(c), 0);

    for (const chunk of chunks) {
      const chunkWeight = getWeight(chunk);
      const chunkDuration = totalChunkWeight > 0 ? (chunkWeight / totalChunkWeight) * segmentDuration : 0;

      const startTime = currentTime;
      const endTime = currentTime + chunkDuration;

      // Clean raw pause markers so they never show up on screen
      const cleanChunk = stripPauseMarkers(chunk);

      if (cleanChunk.length > 0) {
        srtEntries.push({
          index: srtEntries.length + 1,
          start: formatSRTTime(startTime),
          end: formatSRTTime(endTime),
          text: cleanChunk,
        });
      }

      currentTime = endTime;
    }
  }

  // Format as SRT
  return srtEntries
    .map(e => `${e.index}\n${e.start} --> ${e.end}\n${e.text}\n`)
    .join('\n');
}

// ============================================
// BREAK TEXT INTO 2-5 SPOKEN WORDS CHUNKS (VIRAL PACE)
// ============================================
function breakIntoWordChunks(text, minWords = 2, maxWords = 5) {
  const tokens = text.split(/\s+/).filter(w => w.trim().length > 0);
  const chunks = [];
  
  let i = 0;
  while (i < tokens.length) {
    const remainingTokens = tokens.slice(i);
    const remainingActualWords = remainingTokens.filter(t => !/\[pause-/i.test(t)).length;
    
    let tokenCount = 0;
    
    if (remainingActualWords <= maxWords) {
      tokenCount = remainingTokens.length;
    } else {
      let wordsFound = 0;
      let j = 0;
      // We target 3 spoken words as the sweet spot
      const targetWords = 3;
      
      while (j < remainingTokens.length && wordsFound < targetWords) {
        if (!/\[pause-/i.test(remainingTokens[j])) {
          wordsFound++;
        }
        j++;
      }
      
      const nextRemainingActual = remainingActualWords - wordsFound;
      if (nextRemainingActual < minWords) {
        tokenCount = remainingTokens.length;
      } else {
        tokenCount = j;
      }
    }
    
    if (tokenCount === 0) tokenCount = 1;
    
    const chunk = tokens.slice(i, i + tokenCount).join(' ');
    chunks.push(chunk);
    i += tokenCount;
  }
  return chunks;
}

// ============================================
// FORMAT TIME FOR SRT
// ============================================
function formatSRTTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

// ============================================
// GENERATE ASS SUBTITLE (for styled burn-in)
// ============================================
function generateASS(script, totalDuration) {
  const sentences = script
    .split(/(?<=[.!?…])\s+/)
    .filter(s => s.trim().length > 0)
    .map(s => s.trim());

  const totalWeight = sentences.reduce((sum, s) => sum + getWeight(s), 0);
  let currentTime = 0;

  const minWords = config.content.subtitleMinWords || 2;
  const maxWords = config.content.subtitleMaxWords || 5;

  // ASS header with mobile-optimized styling
  let ass = `[Script Info]
Title: YT Shorts Subtitles
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial Black,72,&H0000FFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,6,3,2,40,40,250,1
Style: Highlight,Arial Black,80,&H0000E5FF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,7,3,2,40,40,250,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const sentenceWeight = getWeight(sentence);
    const segmentDuration = totalWeight > 0 ? (sentenceWeight / totalWeight) * totalDuration : 0;

    // Break into dynamic 2-5 actual spoken word chunks
    const chunks = breakIntoWordChunks(sentence, minWords, maxWords);
    const totalChunkWeight = chunks.reduce((sum, c) => sum + getWeight(c), 0);

    for (const chunk of chunks) {
      const chunkWeight = getWeight(chunk);
      const chunkDuration = totalChunkWeight > 0 ? (chunkWeight / totalChunkWeight) * segmentDuration : 0;

      const startTime = formatASSTime(currentTime);
      const endTime = formatASSTime(currentTime + chunkDuration);
      const style = i === 0 ? 'Highlight' : 'Default'; // Highlight the hook

      const cleanChunk = stripPauseMarkers(chunk);
      if (cleanChunk.length > 0) {
        ass += `Dialogue: 0,${startTime},${endTime},${style},,0,0,0,,${cleanChunk.toUpperCase()}\n`;
      }
      currentTime += chunkDuration;
    }
  }

  return ass;
}

function formatASSTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.round((seconds % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// ============================================
// MAIN SUBTITLE GENERATION
// ============================================
export async function generateSubtitles(script, voiceoverDuration, scenes, videoId) {
  const outputDir = path.join(config.processing.tempDir, videoId);
  await ensureDir(outputDir);

  const srtPath = path.join(outputDir, 'subtitles.srt');
  const assPath = path.join(outputDir, 'subtitles.ass');

  // Generate both formats
  const srtContent = generateSRT(script, voiceoverDuration, scenes);
  const assContent = generateASS(script, voiceoverDuration);

  await fs.writeFile(srtPath, srtContent);
  await fs.writeFile(assPath, assContent);

  logger.info(`Subtitles generated: SRT + ASS for ${voiceoverDuration}s video`);

  return {
    srtPath,
    assPath,
    format: 'ass', // Preferred for styled burn-in
  };
}

export default { generateSubtitles };
