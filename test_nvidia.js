import axios from 'axios';
import fs from 'fs/promises';

async function testNvidia() {
  const apiKey = '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';
  const url = 'https://ai.api.nvidia.com/v1/genai/stabilityai/stable-diffusion-xl-base-1.0';

  console.log(`Connecting to Nvidia API: ${url}`);
  try {
    const response = await axios.post(
      url,
      {
        text_prompts: [{ text: "A futuristic cyborg terminator with glowing red eyes, highly detailed, photorealistic" }],
        steps: 20,
        cfg_scale: 7,
        width: 1024,
        height: 1024
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      }
    );

    console.log("Nvidia response keys:", Object.keys(response.data));
    if (response.data.artifacts && response.data.artifacts[0]) {
      const base64Data = response.data.artifacts[0].base64;
      const buffer = Buffer.from(base64Data, 'base64');
      await fs.writeFile('nvidia_test.png', buffer);
      console.log('✅ Successfully generated and saved image from Nvidia API!');
      console.log('File saved as nvidia_test.png');
    } else {
      console.log('❌ Nvidia response did not contain artifacts:', response.data);
    }
  } catch (error) {
    console.error('❌ Nvidia test failed:', error.message);
    if (error.response) {
      console.error('HTTP Status:', error.response.status);
      console.error('Response Data:', error.response.data);
    }
  }
}

testNvidia();
