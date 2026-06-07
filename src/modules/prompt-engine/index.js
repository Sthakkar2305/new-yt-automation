import { createModuleLogger } from '../../utils/logger.js';
import { getAIClient } from '../../utils/ai-client.js';

const logger = createModuleLogger('prompt-engine');

const PROMPT_SYSTEM = `You are an expert AI image prompt engineer specializing in cinematic, futuristic visuals.

Convert scene descriptions into highly detailed image generation prompts optimized for Flux/SDXL models.

STYLE REQUIREMENTS:
- Cinematic futuristic aesthetic
- Dark, moody atmosphere with dramatic lighting
- Ultra-realistic or hyper-stylized cyberpunk
- Volumetric lighting and god rays
- High contrast, rich shadows
- Vertical composition (9:16 aspect ratio)
- Film grain texture for premium feel
- No text, no words, no letters in the image

PROMPT STRUCTURE:
[Subject] + [Environment] + [Lighting] + [Atmosphere] + [Camera angle] + [Quality modifiers]

Quality modifiers to always include:
"cinematic, ultra detailed, 8k, film quality, dramatic lighting, volumetric fog, vertical composition 9:16"

Respond in JSON:
{
  "prompts": [
    {
      "scene_number": 1,
      "positive_prompt": "detailed positive prompt",
      "negative_prompt": "text, watermark, blurry, low quality, deformed",
      "style_emphasis": "cyberpunk|sci-fi|laboratory|nature-tech|military"
    }
  ]
}`;

export async function generateVisualPrompts(scenes) {
  const ai = getAIClient();

  const sceneDescriptions = scenes.map((s, i) =>
    `Scene ${i + 1} (${s.duration_seconds}s, ${s.mood}): ${s.visual_description} | Camera: ${s.camera_direction}`
  ).join('\n');

  const result = await ai.chat({
    systemPrompt: PROMPT_SYSTEM,
    userPrompt: `Generate image prompts for these scenes:\n\n${sceneDescriptions}`,
    temperature: 0.8,
    maxTokens: 2000,
    jsonMode: true,
  });

  logger.info(`Generated ${result.prompts.length} visual prompts`);
  return result.prompts;
}

export default { generateVisualPrompts };
