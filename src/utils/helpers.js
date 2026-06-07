import fs from 'fs/promises';
import path from 'path';
import config from '../config/index.js';
import { createModuleLogger } from './logger.js';
import { getDailyCost } from '../database/client.js';

const logger = createModuleLogger('helpers');

/**
 * Ensure a directory exists, create if not.
 */
export async function ensureDir(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

/**
 * Generate a unique fingerprint for deduplication.
 */
export function generateFingerprint(text) {
  const normalized = text.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 100);
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return `fp_${Math.abs(hash).toString(36)}`;
}

/**
 * Check budget (everything is FREE - always allowed).
 */
export async function checkBudget() {
  return { allowed: true, spent: 0, remaining: Infinity };
}

/**
 * Sleep for specified milliseconds.
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Clean up temp files for a video.
 */
export async function cleanupTempFiles(videoId) {
  const tempPath = path.join(config.processing.tempDir, videoId);
  try {
    await fs.rm(tempPath, { recursive: true, force: true });
    logger.info(`Cleaned up temp files for ${videoId}`);
  } catch (err) {
    logger.warn(`Failed to cleanup temp files for ${videoId}`, { error: err.message });
  }
}

/**
 * Get current date in IST.
 */
export function getISTDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/**
 * Get current time in IST as HH:MM.
 */
export function getISTTime() {
  return new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Truncate text to word limit.
 */
export function truncateWords(text, maxWords) {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ');
}

/**
 * Validate video output specs.
 */
export function validateVideoSpec(duration, fileSize) {
  const { min, max } = config.videoSpecs.duration;
  const issues = [];
  if (duration < min) issues.push(`Duration ${duration}s is below minimum ${min}s`);
  if (duration > max) issues.push(`Duration ${duration}s exceeds maximum ${max}s`);
  if (fileSize > 50) issues.push(`File size ${fileSize}MB exceeds 50MB limit`);
  return { valid: issues.length === 0, issues };
}

/**
 * Rotate through values (for hashtag rotation, API key rotation, etc.).
 */
export function rotateValue(values, index) {
  return values[index % values.length];
}
