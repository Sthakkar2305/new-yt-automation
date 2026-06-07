import fs from 'fs/promises';
import path from 'path';
import { createModuleLogger } from './logger.js';
import config from '../config/index.js';

const logger = createModuleLogger('cleanup');

/**
 * Cleanup old temp files (older than 24 hours)
 */
async function cleanupOldTempFiles() {
  const tempDir = config.processing.tempDir;
  const maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours

  try {
    const entries = await fs.readdir(tempDir, { withFileTypes: true });
    let cleaned = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const dirPath = path.join(tempDir, entry.name);
      const stats = await fs.stat(dirPath);
      const age = Date.now() - stats.mtimeMs;

      if (age > maxAgeMs) {
        await fs.rm(dirPath, { recursive: true, force: true });
        cleaned++;
      }
    }

    logger.info(`Cleanup complete: ${cleaned} old temp directories removed`);
    return { cleaned };
  } catch (err) {
    if (err.code === 'ENOENT') {
      logger.info('Temp directory does not exist, nothing to clean');
      return { cleaned: 0 };
    }
    throw err;
  }
}

// CLI entry point
if (process.argv[1]?.includes('cleanup')) {
  cleanupOldTempFiles()
    .then(r => console.log(`Cleaned ${r.cleaned} directories`))
    .catch(e => console.error(e));
}

export { cleanupOldTempFiles };
export default { cleanupOldTempFiles };
