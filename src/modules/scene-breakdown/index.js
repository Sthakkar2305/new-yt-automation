import { createModuleLogger } from '../../utils/logger.js';
import { getAIClient } from '../../utils/ai-client.js';
import config from '../../config/index.js';

const logger = createModuleLogger('scene-breakdown');

function isPsychologyCategory(category) {
  const psychoCategories = ['dark_psychology', 'body_language', 'neuroscience', 'mental_health', 'social_dynamics', 'personality_traits', 'subconscious_mind'];
  return psychoCategories.includes(category);
}

export async function breakdownScenes(script, topic) {
  const ai = getAIClient();
  const isPsycho = isPsychologyCategory(topic.category);

  const visualStyle = isPsycho
    ? "- Visual style: dark psychological thriller, eerie, mysterious, cinematic, dark shadows, dramatic lighting"
    : "- Visual style: cinematic, ancient rome, stoic, inspiring, high-end luxury, marble statues, highly disciplined aesthetic";

  const systemPrompt = `You are a cinematic scene director for YouTube Shorts.

Break a narration script into individual visual scenes for a vertical 9:16 video.

Rules:
- Create ${config.content.minScenes}-${config.content.maxScenes} scenes
- Each scene should be 3-6 seconds
- Each scene needs a unique, vivid visual description. IMPORTANT: The visual description MUST BE IN ENGLISH, even if the script is in Hindi.
- Scenes should PROGRESS visually (don't repeat same imagery)
- Include camera direction (zoom in, pan, wide shot, close-up)
${visualStyle}
- All scenes must be vertical 9:16 composition

Respond in JSON:
{
  "scenes": [
    {
      "scene_number": 1,
      "narration_text": "the narration for this scene",
      "duration_seconds": 4,
      "visual_description": "detailed visual description",
      "camera_direction": "slow zoom in",
      "mood": "tense|mysterious|awe|dramatic|dark",
      "transition": "fade|cut|dissolve|zoom"
    }
  ],
  "total_duration": 30,
  "visual_progression": "description of visual arc"
}`;

  const result = await ai.chat({
    systemPrompt: systemPrompt,
    userPrompt: `Script:\n"${script}"\n\nTopic: ${topic.title}\nCategory: ${topic.category}\n\nBreak this into ${config.content.minScenes}-${config.content.maxScenes} cinematic scenes.`,
    temperature: 0.7,
    maxTokens: 1500,
    jsonMode: true,
  });

  // Validate scene count
  if (!result.scenes || result.scenes.length < config.content.minScenes) {
    throw new Error(`Too few scenes: ${result.scenes?.length || 0}`);
  }

  // Ensure total duration is within range
  const totalDuration = result.scenes.reduce((sum, s) => sum + s.duration_seconds, 0);
  if (totalDuration < 20 || totalDuration > 45) {
    // Adjust scene durations proportionally
    const targetDuration = 32;
    const ratio = targetDuration / totalDuration;
    result.scenes.forEach(s => {
      s.duration_seconds = Math.round(s.duration_seconds * ratio * 10) / 10;
    });
  }

  logger.info(`Scene breakdown: ${result.scenes.length} scenes, ~${totalDuration}s total`);

  return {
    scenes: result.scenes,
    totalDuration: result.scenes.reduce((sum, s) => sum + s.duration_seconds, 0),
    visualProgression: result.visual_progression,
  };
}

export default { breakdownScenes };
