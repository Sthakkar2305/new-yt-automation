import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

// Test video & subtitle files from the last run temp directory
const tempDir = 'D:/youtube automation/temp/12da7011-65ee-464b-a79d-21dc72b097bf';
const videoInput = `${tempDir}/video_with_voice.mp4`;
const subtitlesInput = `${tempDir}/subtitles.ass`;
const videoOutput = `${tempDir}/test_out.mp4`;

async function testEscaping(escapedPath) {
  const cmd = `"D:\\youtube automation\\node_modules\\@ffmpeg-installer\\win32-x64\\ffmpeg.exe" -y -i "${videoInput}" -vf "ass=${escapedPath}" -c:v libx264 -preset ultrafast -b:v 4000k -c:a copy "${videoOutput}"`;
  console.log(`\nRunning: ${cmd}`);
  try {
    const { stdout, stderr } = await execAsync(cmd);
    console.log("SUCCESS!");
    return true;
  } catch (err) {
    console.error("FAILED:");
    console.error(err.message);
    return false;
  }
}

async function run() {
  // Test 1: Single backslash escape colon, with single quotes
  console.log("=== Test 1: 'D\\:/path' ===");
  await testEscaping(`'D\\:/youtube automation/temp/12da7011-65ee-464b-a79d-21dc72b097bf/subtitles.ass'`);

  // Test 2: Double backslash escape colon, with single quotes
  console.log("=== Test 2: 'D\\\\:/path' ===");
  await testEscaping(`'D\\\\:/youtube automation/temp/12da7011-65ee-464b-a79d-21dc72b097bf/subtitles.ass'`);

  // Test 3: Four backslash escape colon, with single quotes
  console.log("=== Test 3: 'D\\\\\\\\:/path' ===");
  await testEscaping(`'D\\\\\\\\:/youtube automation/temp/12da7011-65ee-464b-a79d-21dc72b097bf/subtitles.ass'`);
}
run();
