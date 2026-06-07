import path from 'path';
import { generateVisuals } from '../modules/visual-generator/index.js';

const testVideoId = `image-test-${Date.now()}`;
const prompts = [
  {
    positive_prompt: 'a compact fusion reactor lighting a dark laboratory, plasma energy, cinematic future technology',
    negative_prompt: 'text, watermark, logo, blurry, low quality',
  },
];

const [imagePath] = await generateVisuals(prompts, testVideoId);

console.log('Image generation test complete.');
console.log(`Output: ${path.resolve(imagePath)}`);
