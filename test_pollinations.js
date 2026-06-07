import axios from 'axios';
import fs from 'fs/promises';

async function testPollinations() {
  const prompt = 'A futuristic fusion reactor glowing bright blue, high contrast lighting, cinematic science documentary visual';
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?` + new URLSearchParams({
    width: '768',
    height: '1344',
    nologo: 'true',
    seed: '42'
  }).toString();

  console.log(`Connecting to Pollinations.ai: ${url}`);
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });

    await fs.writeFile('pollinations_test.png', Buffer.from(response.data));
    console.log('✅ Successfully generated and saved image from Pollinations.ai!');
    console.log('File saved as pollinations_test.png');
  } catch (error) {
    console.error('❌ Pollinations.ai test failed:', error.message);
  }
}

testPollinations();
