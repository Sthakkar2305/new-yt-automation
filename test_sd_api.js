import axios from 'axios';
import fs from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

console.log('==================================================');
console.log('🤖 IMAGE GENERATOR DIAGNOSTIC TOOL');
console.log('==================================================\n');

async function testLocalStableDiffusion() {
  const sdUrl = process.env.STABLE_DIFFUSION_API_URL || 'http://127.0.0.1:7860';
  const endpoint = `${sdUrl.replace(/\/$/, '')}/sdapi/v1/txt2img`;

  console.log('--------------------------------------------------');
  console.log('1. Testing Local Stable Diffusion Connection...');
  console.log(`- Target URL: ${sdUrl}`);
  console.log(`- API Endpoint: ${endpoint}`);
  console.log('--------------------------------------------------');

  try {
    const optionsUrl = `${sdUrl.replace(/\/$/, '')}/sdapi/v1/options`;
    console.log('Attempting to fetch options (checking if --api flag is active)...');
    const optionsRes = await axios.get(optionsUrl, { timeout: 5000 });
    console.log('✅ Success! Stable Diffusion API is running.');
    console.log(`  Active Checkpoint: ${optionsRes.data.sd_model_checkpoint || 'Default'}`);

    console.log('\nSending test image generation payload...');
    const payload = {
      prompt: 'a futuristic robot with glowing eyes, highly detailed',
      steps: 8,
      cfg_scale: 2.5,
      width: 512,
      height: 512,
    };
    
    const start = Date.now();
    const response = await axios.post(endpoint, payload, { timeout: 60000 });
    const elapsed = ((Date.now() - start) / 1000).toFixed(2);
    
    if (response.data?.images?.[0]) {
      console.log(`✅ Generation complete in ${elapsed}s! Saved test image to 'test_sd_local.png'`);
      await fs.writeFile('test_sd_local.png', Buffer.from(response.data.images[0], 'base64'));
      return true;
    } else {
      console.log('❌ Connected, but API did not return image data.');
    }
  } catch (error) {
    console.log('❌ Local Stable Diffusion connection failed!');
    if (error.code === 'ECONNREFUSED') {
      console.log('  -> Reason: Could not connect to the port. Is Stable Diffusion open on your computer?');
      console.log('  -> Fix: Launch AUTOMATIC1111 on your machine.');
    } else if (error.response?.status === 404) {
      console.log('  -> Reason: API not found (404). AUTOMATIC1111 is running, but the API is disabled.');
      console.log('  -> Fix: You MUST start Stable Diffusion with the "--api" flag.');
      console.log('          Edit your webui-user.bat and add set COMMANDLINE_ARGS=--api');
    } else {
      console.log(`  -> Error detail: ${error.message}`);
    }
  }
  return false;
}

async function testHuggingFace() {
  const token = process.env.HF_API_KEY || process.env.HUGGINGFACE_API_KEY;
  const model = process.env.HF_MODEL || 'black-forest-labs/FLUX.1-schnell';
  const url = `https://router.huggingface.co/hf-inference/models/${model}`;

  console.log('\n--------------------------------------------------');
  console.log('2. Testing Hugging Face Inference API...');
  console.log(`- Model: ${model}`);
  console.log(`- Router URL: ${url}`);
  console.log('--------------------------------------------------');

  if (!token) {
    console.log('❌ Skipped: No HF_API_KEY or HUGGINGFACE_API_KEY found in your .env file.');
    console.log('   -> Fix: Go to huggingface.co, sign up, create an Access Token, and put it in your .env');
    return false;
  }

  try {
    console.log('Sending request to Hugging Face...');
    const start = Date.now();
    const response = await axios.post(
      url,
      { inputs: 'a futuristic robot with glowing eyes, highly detailed' },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer',
        timeout: 60000
      }
    );
    const elapsed = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`✅ Success! Hugging Face generated image in ${elapsed}s! Saved to 'test_sd_hf.png'`);
    await fs.writeFile('test_sd_hf.png', Buffer.from(response.data));
    return true;
  } catch (error) {
    console.log('❌ Hugging Face request failed!');
    if (error.response) {
      const status = error.response.status;
      let bodyText = '';
      try {
        bodyText = Buffer.from(error.response.data).toString();
      } catch (e) {}

      console.log(`  -> HTTP Status: ${status}`);
      console.log(`  -> Response message: ${bodyText}`);

      if (status === 402 || bodyText.includes('depleted') || bodyText.includes('credits')) {
        console.log('  -> Fix: Your monthly free credits for this Hugging Face API key are completely depleted.');
        console.log('          You can sign up for a new free Hugging Face account to get a fresh API key.');
      } else if (status === 401) {
        console.log('  -> Fix: The API token in your .env is invalid. Re-check the key on huggingface.co.');
      }
    } else {
      console.log(`  -> Error detail: ${error.message}`);
      if (error.code === 'ENOTFOUND') {
        console.log('  -> Fix: DNS lookup failed. Please check your internet connection.');
      }
    }
  }
  return false;
}

async function run() {
  const localOk = await testLocalStableDiffusion();
  const hfOk = await testHuggingFace();
  
  console.log('\n==================================================');
  console.log('SUMMARY & ACTION REQUIRED:');
  console.log('==================================================');
  
  if (localOk) {
    console.log('✨ LOCAL STABLE DIFFUSION IS WORKING! ✨');
    console.log('To use it, update your .env file with:');
    console.log('IMAGE_PROVIDER=local-stable-diffusion');
  } else if (hfOk) {
    console.log('✨ HUGGING FACE INFERENCE IS WORKING! ✨');
    console.log('To use it, update your .env file with:');
    console.log('IMAGE_PROVIDER=huggingface');
  } else {
    console.log('❌ BOTH GENERATORS FAILED.');
    console.log('To fix it, you have two choices:');
    console.log('  Choice A (No installation): Create a new free account on huggingface.co,');
    console.log('            generate a new API token, add it as HF_API_KEY in your .env, and');
    console.log('            set IMAGE_PROVIDER=huggingface.');
    console.log('  Choice B (Local generation): Start Stable Diffusion on your computer');
    console.log('            with the "--api" flag enabled.');
  }
  console.log('==================================================\n');
}

run();
