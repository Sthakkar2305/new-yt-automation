import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { createModuleLogger } from '../../utils/logger.js';
import config from '../../config/index.js';
import { ensureDir, sleep } from '../../utils/helpers.js';

const logger = createModuleLogger('visual-generator');

const OUTPUT_WIDTH = config.videoSpecs.width;
const OUTPUT_HEIGHT = config.videoSpecs.height;
const DEFAULT_NEGATIVE_PROMPT = [
  'text',
  'caption',
  'watermark',
  'logo',
  'signature',
  'blurry',
  'low quality',
  'distorted',
  'extra limbs',
  'bad anatomy',
].join(', ');

function isPsychologyCategory(category) {
  const psychoCategories = ['dark_psychology', 'body_language', 'neuroscience', 'mental_health', 'social_dynamics', 'personality_traits', 'subconscious_mind'];
  return psychoCategories.includes(category);
}

function buildGenerationPrompt(prompt, category) {
  const isPsycho = isPsychologyCategory(category);
  
  const baseStyle = isPsycho
    ? [
        'cinematic dark psychological thriller visual',
        'eerie high contrast lighting, dark shadows',
        'mysterious, surreal, hyperrealistic concept art'
      ]
    : [
        'cinematic motivational stoicism visual',
        'majestic, inspiring lighting, highly disciplined',
        'hyperrealistic, ancient roman marble statues or high-end luxury aesthetic'
      ];

  return [
    String(prompt || '').replace(/\s+/g, ' ').trim(),
    'vertical 9:16 YouTube Shorts frame',
    ...baseStyle,
    'no text, no watermark, no logo',
  ].filter(Boolean).join(', ');
}

function buildAuthHeader() {
  const { stableDiffusionUsername, stableDiffusionPassword } = config.imageGen;
  if (!stableDiffusionUsername || !stableDiffusionPassword) return {};

  const token = Buffer
    .from(`${stableDiffusionUsername}:${stableDiffusionPassword}`)
    .toString('base64');

  return { Authorization: `Basic ${token}` };
}

function stripImageDataPrefix(base64Image) {
  if (!base64Image) return '';
  const value = String(base64Image);
  const commaIndex = value.indexOf(',');
  return value.startsWith('data:image') && commaIndex !== -1
    ? value.slice(commaIndex + 1)
    : value;
}

async function saveImageBuffer(buffer, outputPath) {
  await sharp(buffer)
    .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, { fit: 'cover', position: 'center' })
    .png()
    .toFile(outputPath);
}

// ============================================
// PROVIDER 1: NVIDIA FLUX.1-SCHNELL (FREE CREDITS)
// ============================================
async function generateWithNvidiaFlux(prompt, outputPath, sceneIndex, category) {
  const apiKey = config.imageGen.nvidiaApiKey;
  if (!apiKey) {
    throw new Error('NVIDIA_API_KEY is not set in your .env file. Get one free at https://build.nvidia.com');
  }

  const fullPrompt = buildGenerationPrompt(prompt, category);
  const endpoint = 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell';

  logger.debug(`Generating image ${sceneIndex} via NVIDIA FLUX.1-schnell`);

  const response = await axios.post(endpoint, {
    prompt: fullPrompt,
    height: 1024,
    width: 768,
    steps: 4,
  }, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    timeout: 60000,
  });

  if (!response.data?.artifacts?.[0]?.base64) {
    throw new Error('NVIDIA FLUX API did not return image data');
  }

  const imageBuffer = Buffer.from(response.data.artifacts[0].base64, 'base64');
  await saveImageBuffer(imageBuffer, outputPath);

  logger.info(`✅ HD image generated via NVIDIA FLUX for scene ${sceneIndex}`);
  return outputPath;
}

// ============================================
// PROVIDER 2: LOCAL STABLE DIFFUSION API
// ============================================
async function generateWithStableDiffusion(prompt, negativePrompt, outputPath, sceneIndex, category) {
  const {
    stableDiffusionUrl,
    stableDiffusionModel,
    stableDiffusionSampler,
    stableDiffusionSteps,
    stableDiffusionCfgScale,
    stableDiffusionWidth,
    stableDiffusionHeight,
    stableDiffusionTimeoutMs,
  } = config.imageGen;

  const endpoint = `${stableDiffusionUrl.replace(/\/$/, '')}/sdapi/v1/txt2img`;
  const payload = {
    prompt: buildGenerationPrompt(prompt, category),
    negative_prompt: negativePrompt || DEFAULT_NEGATIVE_PROMPT,
    width: stableDiffusionWidth,
    height: stableDiffusionHeight,
    steps: stableDiffusionSteps,
    cfg_scale: stableDiffusionCfgScale,
    sampler_name: stableDiffusionSampler,
    batch_size: 1,
    n_iter: 1,
    seed: -1,
    restore_faces: false,
    tiling: false,
    save_images: false,
    ...(stableDiffusionModel ? {
      override_settings: {
        sd_model_checkpoint: stableDiffusionModel,
      },
    } : {}),
  };

  logger.debug(`Generating image ${sceneIndex}: local Stable Diffusion API`);

  const { default: axios } = await import('axios');
  const response = await axios.post(endpoint, payload, {
    timeout: stableDiffusionTimeoutMs,
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeader(),
    },
  });

  const base64Image = response.data?.images?.[0];
  if (!base64Image) {
    throw new Error('Stable Diffusion API did not return image data');
  }

  const imageBuffer = Buffer.from(stripImageDataPrefix(base64Image), 'base64');
  await saveImageBuffer(imageBuffer, outputPath);

  logger.info(`Image generated via local Stable Diffusion API for scene ${sceneIndex}`);
  return outputPath;
}

// ============================================
// PROVIDER 3: HUGGING FACE INFERENCE API
// ============================================
async function generateWithHuggingFace(prompt, negativePrompt, outputPath, sceneIndex, category) {
  const token = process.env.HF_API_KEY || process.env.HUGGINGFACE_API_KEY;
  if (!token) {
    throw new Error('HF_API_KEY or HUGGINGFACE_API_KEY is not defined in your .env file');
  }

  // Default to state-of-the-art FLUX.1-schnell model
  const model = process.env.HF_MODEL || 'black-forest-labs/FLUX.1-schnell';
  const url = `https://router.huggingface.co/hf-inference/models/${model}`;

  logger.debug(`Generating image ${sceneIndex} via Hugging Face model: ${model}`);

  const { default: axios } = await import('axios');
  const response = await axios.post(
    url,
    {
      inputs: buildGenerationPrompt(prompt, category),
      parameters: {
        negative_prompt: negativePrompt || DEFAULT_NEGATIVE_PROMPT,
        width: 768,
        height: 1344,
      }
    },
    {
      responseType: 'arraybuffer',
      timeout: 120000,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const imageBuffer = Buffer.from(response.data);
  await saveImageBuffer(imageBuffer, outputPath);

  logger.info(`✅ Image generated via Hugging Face for scene ${sceneIndex}`);
  return outputPath;
}

// ============================================
// PROVIDER 4: POLLINATIONS.AI (FREE API)
// ============================================
async function generateWithPollinations(prompt, outputPath, sceneIndex, category) {
  const seed = Math.floor(Math.random() * 100000);
  const encodedPrompt = encodeURIComponent(buildGenerationPrompt(prompt, category));
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=768&height=1344&seed=${seed}&model=flux`;

  logger.debug(`Generating image ${sceneIndex} via Pollinations.ai`);

  const { default: axios } = await import('axios');
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });

  const imageBuffer = Buffer.from(response.data);
  await saveImageBuffer(imageBuffer, outputPath);

  logger.info(`✅ Image generated via Pollinations for scene ${sceneIndex}`);
  return outputPath;
}

// ============================================
// OFFLINE FALLBACK: ABSTRACT SVG RENDERER
// ============================================
function hashString(value) {
  let hash = 2166136261;
  const text = String(value || '');

  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function pick(values, seed, offset = 0) {
  return values[(seed + offset) % values.length];
}

function getTheme(prompt) {
  const text = String(prompt || '').toLowerCase();

  if (/(fusion|reactor|energy|plasma|quantum|power)/.test(text)) {
    return {
      name: 'fusion',
      colors: ['#07111f', '#123c69', '#19b4c6', '#f4d35e'],
      icon: 'core',
    };
  }

  if (/(robot|android|machine|motor|sensor|hardware)/.test(text)) {
    return {
      name: 'robotics',
      colors: ['#08111a', '#263544', '#7dd3fc', '#cbd5e1'],
      icon: 'circuit',
    };
  }

  if (/(space|planet|orbit|rocket|satellite|galaxy|moon)/.test(text)) {
    return {
      name: 'space',
      colors: ['#050816', '#1d2b53', '#7c3aed', '#22d3ee'],
      icon: 'orbit',
    };
  }

  if (/(ai|neural|data|model|chip|compute|algorithm)/.test(text)) {
    return {
      name: 'ai',
      colors: ['#06131f', '#0f766e', '#38bdf8', '#a7f3d0'],
      icon: 'network',
    };
  }

  return {
    name: 'future-tech',
    colors: ['#09090b', '#1f2937', '#3b82f6', '#f59e0b'],
    icon: 'signal',
  };
}

function svgEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildGrid(seed) {
  const major = 180 + (seed % 5) * 18;
  const minor = major / 3;
  return `
    <pattern id="minorGrid" width="${minor}" height="${minor}" patternUnits="userSpaceOnUse">
      <path d="M ${minor} 0 L 0 0 0 ${minor}" fill="none" stroke="#ffffff" stroke-width="1" opacity="0.08"/>
    </pattern>
    <pattern id="majorGrid" width="${major}" height="${major}" patternUnits="userSpaceOnUse">
      <rect width="${major}" height="${major}" fill="url(#minorGrid)"/>
      <path d="M ${major} 0 L 0 0 0 ${major}" fill="none" stroke="#ffffff" stroke-width="1.5" opacity="0.12"/>
    </pattern>
  `;
}

function buildAbstractScene(prompt, sceneIndex) {
  const seed = hashString(`${sceneIndex}:${prompt}`);
  const theme = getTheme(prompt);
  const [bg, mid, accent, warm] = theme.colors;
  const centerX = 540 + ((seed % 121) - 60);
  const centerY = 820 + (((seed >> 8) % 361) - 180);
  const tilt = ((seed % 31) - 15) / 10;

  const rayCount = 13;
  const rays = Array.from({ length: rayCount }, (_, index) => {
    const angle = (index / rayCount) * Math.PI * 2 + seed / 1000;
    const x1 = centerX + Math.cos(angle) * 120;
    const y1 = centerY + Math.sin(angle) * 120;
    const x2 = centerX + Math.cos(angle) * (650 + (index % 3) * 90);
    const y2 = centerY + Math.sin(angle) * (650 + (index % 4) * 70);
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${index % 2 ? accent : warm}" stroke-width="${index % 3 === 0 ? 5 : 2}" opacity="0.28"/>`;
  }).join('');

  const nodes = Array.from({ length: 28 }, (_, index) => {
    const x = 90 + ((seed * (index + 11)) % 900);
    const y = 180 + (((seed >> 3) * (index + 17)) % 1500);
    const radius = 3 + ((seed + index) % 8);
    return `<circle cx="${x}" cy="${y}" r="${radius}" fill="${pick([accent, warm, '#ffffff'], seed, index)}" opacity="${index % 4 === 0 ? '0.55' : '0.24'}"/>`;
  }).join('');

  const panels = Array.from({ length: 7 }, (_, index) => {
    const x = 70 + ((seed * (index + 5)) % 790);
    const y = 210 + (((seed >> 4) * (index + 9)) % 1320);
    const w = 120 + ((seed + index * 29) % 210);
    const h = 54 + ((seed + index * 37) % 120);
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="#ffffff" opacity="0.035" stroke="${accent}" stroke-width="1.5"/>`;
  }).join('');

  const icon = {
    core: `
      <ellipse cx="${centerX}" cy="${centerY}" rx="210" ry="88" fill="none" stroke="${accent}" stroke-width="8" opacity="0.9" transform="rotate(${tilt * 12} ${centerX} ${centerY})"/>
      <ellipse cx="${centerX}" cy="${centerY}" rx="88" ry="210" fill="none" stroke="${warm}" stroke-width="5" opacity="0.65" transform="rotate(${tilt * -18} ${centerX} ${centerY})"/>
      <circle cx="${centerX}" cy="${centerY}" r="96" fill="url(#coreGlow)" opacity="0.95"/>
    `,
    circuit: `
      <rect x="${centerX - 150}" y="${centerY - 150}" width="300" height="300" rx="36" fill="url(#coreGlow)" stroke="${accent}" stroke-width="8" opacity="0.9"/>
      <path d="M${centerX - 310} ${centerY - 90} H${centerX - 150} M${centerX + 150} ${centerY + 90} H${centerX + 330} M${centerX - 90} ${centerY - 310} V${centerY - 150} M${centerX + 90} ${centerY + 150} V${centerY + 320}" stroke="${warm}" stroke-width="10" opacity="0.65"/>
      <circle cx="${centerX}" cy="${centerY}" r="64" fill="${accent}" opacity="0.65"/>
    `,
    orbit: `
      <circle cx="${centerX}" cy="${centerY}" r="132" fill="url(#coreGlow)" opacity="0.9"/>
      <ellipse cx="${centerX}" cy="${centerY}" rx="330" ry="120" fill="none" stroke="${accent}" stroke-width="6" opacity="0.78" transform="rotate(-18 ${centerX} ${centerY})"/>
      <ellipse cx="${centerX}" cy="${centerY}" rx="260" ry="96" fill="none" stroke="${warm}" stroke-width="4" opacity="0.55" transform="rotate(31 ${centerX} ${centerY})"/>
      <circle cx="${centerX + 236}" cy="${centerY - 68}" r="26" fill="${warm}" opacity="0.9"/>
    `,
    network: `
      <path d="M${centerX - 230} ${centerY + 130} C${centerX - 90} ${centerY - 240}, ${centerX + 120} ${centerY + 250}, ${centerX + 255} ${centerY - 120}" fill="none" stroke="${accent}" stroke-width="9" opacity="0.75"/>
      <path d="M${centerX - 255} ${centerY - 110} C${centerX - 80} ${centerY + 230}, ${centerX + 90} ${centerY - 250}, ${centerX + 235} ${centerY + 125}" fill="none" stroke="${warm}" stroke-width="5" opacity="0.55"/>
      <circle cx="${centerX - 210}" cy="${centerY + 120}" r="34" fill="${accent}" opacity="0.8"/>
      <circle cx="${centerX}" cy="${centerY}" r="82" fill="url(#coreGlow)" opacity="0.9"/>
      <circle cx="${centerX + 230}" cy="${centerY - 120}" r="34" fill="${warm}" opacity="0.8"/>
    `,
    signal: `
      <path d="M${centerX - 230} ${centerY + 220} L${centerX - 70} ${centerY - 130} L${centerX + 40} ${centerY + 40} L${centerX + 230} ${centerY - 230}" fill="none" stroke="${accent}" stroke-width="18" opacity="0.72"/>
      <circle cx="${centerX}" cy="${centerY}" r="96" fill="url(#coreGlow)" opacity="0.9"/>
      <circle cx="${centerX}" cy="${centerY}" r="190" fill="none" stroke="${warm}" stroke-width="5" opacity="0.48"/>
    `,
  }[theme.icon];

  return `
    <svg width="${OUTPUT_WIDTH}" height="${OUTPUT_HEIGHT}" viewBox="0 0 ${OUTPUT_WIDTH} ${OUTPUT_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${bg}"/>
          <stop offset="52%" stop-color="${mid}"/>
          <stop offset="100%" stop-color="#020617"/>
        </linearGradient>
        <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="${warm}"/>
          <stop offset="48%" stop-color="${accent}"/>
          <stop offset="100%" stop-color="${mid}" stop-opacity="0"/>
        </radialGradient>
        <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="16" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
        ${buildGrid(seed)}
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)"/>
      <rect width="100%" height="100%" fill="url(#majorGrid)" opacity="0.42"/>
      <g transform="rotate(${tilt} 540 960)" filter="url(#softGlow)">
        ${rays}
        ${icon}
      </g>
      <g>${panels}</g>
      <g>${nodes}</g>
      <rect x="0" y="0" width="100%" height="100%" fill="none" stroke="${accent}" stroke-width="18" opacity="0.16"/>
      <metadata>${svgEscape(theme.name)}</metadata>
    </svg>
  `;
}

async function generateWithLocalRenderer(prompt, outputPath, sceneIndex) {
  const svgBuffer = Buffer.from(buildAbstractScene(prompt, sceneIndex));
  await sharp(svgBuffer)
    .png()
    .toFile(outputPath);

  logger.info(`Generated offline local renderer image for scene ${sceneIndex}`);
  return outputPath;
}

// ============================================
// MAIN GENERATION CONTROLLER WITH FALLBACK
// ============================================
async function generateImage(prompt, negativePrompt, outputPath, sceneIndex, category) {
  const provider = (config.imageGen.provider || 'nvidia-flux').toLowerCase();

  // Define the provider functions and their fallback chain
  const providerChain = [];

  if (provider === 'nvidia-flux') {
    providerChain.push({ name: 'NVIDIA FLUX', fn: () => generateWithNvidiaFlux(prompt, outputPath, sceneIndex, category) });
  } else if (provider === 'local-stable-diffusion') {
    providerChain.push({ name: 'Local Stable Diffusion', fn: () => generateWithStableDiffusion(prompt, negativePrompt, outputPath, sceneIndex, category) });
  } else if (provider === 'huggingface') {
    providerChain.push({ name: 'Hugging Face', fn: () => generateWithHuggingFace(prompt, negativePrompt, outputPath, sceneIndex, category) });
  } else if (provider === 'pollinations') {
    providerChain.push({ name: 'Pollinations', fn: () => generateWithPollinations(prompt, outputPath, sceneIndex, category) });
  } else {
    logger.warn(`Unknown image provider "${provider}"; will try NVIDIA FLUX.`);
    providerChain.push({ name: 'NVIDIA FLUX', fn: () => generateWithNvidiaFlux(prompt, outputPath, sceneIndex, category) });
  }

  // Try each provider in the chain, fall back to next on failure
  for (const { name, fn } of providerChain) {
    try {
      return await fn();
    } catch (err) {
      logger.warn(`${name} failed for scene ${sceneIndex}: ${err.message}`);
    }
  }

  // Final fallback: offline SVG renderer
  logger.warn(`All image providers failed for scene ${sceneIndex}; using offline SVG renderer.`);
  return generateWithLocalRenderer(prompt, outputPath, sceneIndex);
}

export async function generateVisuals(visualPrompts, videoId, category) {
  const outputDir = path.join(config.processing.tempDir, videoId, 'images');
  await ensureDir(outputDir);

  const imageUrls = [];
  const totalScenes = visualPrompts.length;

  logger.info(`Generating ${totalScenes} images with provider: ${config.imageGen.provider}`);

  for (let i = 0; i < totalScenes; i++) {
    const prompt = visualPrompts[i];
    const outputPath = path.join(outputDir, `scene_${i + 1}.png`);

    try {
      logger.info(`Generating visual ${i + 1}/${totalScenes}...`);

      await generateImage(
        prompt.positive_prompt,
        prompt.negative_prompt,
        outputPath,
        i + 1,
        category
      );

      imageUrls.push(outputPath);

      if (i < totalScenes - 1) {
        logger.debug('Waiting 1s between image generations...');
        await sleep(1000);
      }
    } catch (err) {
      logger.error(`Failed to generate visual for scene ${i + 1}`, { error: err.message });
      imageUrls.push(null);
    }
  }

  const successCount = imageUrls.filter(Boolean).length;
  logger.info(`Visual generation complete: ${successCount}/${totalScenes} images`);

  const minimumRequired = Math.min(3, totalScenes);
  if (successCount < minimumRequired) {
    throw new Error(`Only ${successCount} images generated successfully, need at least ${minimumRequired}`);
  }

  return imageUrls;
}

export default { generateVisuals };
