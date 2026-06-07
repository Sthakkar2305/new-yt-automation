import { GoogleGenAI } from '@google/genai';
import fs from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

async function testGeminiImageGeneration() {
  const apiKey = process.env.GEMINI_IMAGE_API_KEY;
  
  if (!apiKey || apiKey === 'PUT_YOUR_GOOGLE_GEMINI_API_KEY_HERE') {
    console.log('==================================================');
    console.log('❌ GEMINI_IMAGE_API_KEY is not set!');
    console.log('==================================================');
    console.log('');
    console.log('To fix this:');
    console.log('1. Go to: https://aistudio.google.com/apikey');
    console.log('2. Sign in with your Google account');
    console.log('3. Click "Create API Key"');
    console.log('4. Copy the key (starts with "AIza...")');
    console.log('5. Open your .env file and replace:');
    console.log('   GEMINI_IMAGE_API_KEY=PUT_YOUR_GOOGLE_GEMINI_API_KEY_HERE');
    console.log('   with:');
    console.log('   GEMINI_IMAGE_API_KEY=AIzaSy...your_actual_key');
    console.log('');
    console.log('This is 100% FREE — Google gives you 15 requests/minute!');
    console.log('==================================================');
    return;
  }

  console.log('==================================================');
  console.log('🤖 GEMINI IMAGEN TEST');
  console.log('==================================================\n');
  console.log(`API Key: ${apiKey.substring(0, 8)}...`);

  const ai = new GoogleGenAI({ apiKey });

  const modelsToTest = [
    'imagen-3.0-fast-generate-001',
    'imagen-3.0-generate-001',
    'imagen-4.0-generate-001',
  ];

  for (const modelName of modelsToTest) {
    console.log(`\n--- Testing model: ${modelName} ---`);
    try {
      const start = Date.now();
      const response = await ai.models.generateImages({
        model: modelName,
        prompt: 'A futuristic fusion reactor glowing bright blue in a dark laboratory, cinematic lighting, photorealistic, high detail, science documentary visual, vertical 9:16 frame',
        config: {
          numberOfImages: 1,
        },
      });

      const elapsed = ((Date.now() - start) / 1000).toFixed(2);

      if (response.generatedImages && response.generatedImages[0]) {
        const imgBytes = response.generatedImages[0].image.imageBytes;
        const buffer = Buffer.from(imgBytes, 'base64');
        const filename = `test_gemini_${modelName.replace(/[^a-z0-9]/g, '_')}.png`;
        await fs.writeFile(filename, buffer);
        console.log(`✅ SUCCESS! Image generated in ${elapsed}s`);
        console.log(`   Saved as: ${filename} (${(buffer.length / 1024).toFixed(0)} KB)`);
        console.log('');
        console.log('==================================================');
        console.log('🎉 GEMINI IMAGEN IS WORKING!');
        console.log(`   Best model: ${modelName}`);
        console.log('   Your videos will now have HD quality images!');
        console.log('==================================================');
        return;
      } else {
        console.log('❌ No image data in response');
      }
    } catch (error) {
      const msg = error.message || '';
      if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid')) {
        console.log('❌ API key is INVALID. Please check your key at https://aistudio.google.com/apikey');
        return;
      } else if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
        console.log('⚠️ Rate limited — your key works but you\'ve hit the free tier limit. Wait a minute and try again.');
        return;
      } else {
        console.log(`❌ Failed: ${msg.substring(0, 200)}`);
      }
    }
  }
  
  console.log('\n❌ All models failed. Check your API key and try again.');
}

testGeminiImageGeneration();
