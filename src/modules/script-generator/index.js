import { createModuleLogger } from '../../utils/logger.js';
import { getAIClient } from '../../utils/ai-client.js';
import config from '../../config/index.js';

const logger = createModuleLogger('script-generator');

function isPsychologyCategory(category) {
  const psychoCategories = ['dark_psychology', 'body_language', 'neuroscience', 'mental_health', 'social_dynamics', 'personality_traits', 'subconscious_mind'];
  return psychoCategories.includes(category);
}

export async function generateScript(topic, hook) {
  const ai = getAIClient();
  const isPsycho = isPsychologyCategory(topic.category);

  const toneInstruction = isPsycho 
    ? "- Use conversational human rhythm. The tone must be deep, intense, and mysterious—like a mad scientist revealing dark secrets of human psychology."
    : "- Use conversational human rhythm. The tone must be calm, authoritative, stoic, disciplined, and deeply inspiring—like a mentor or ancient philosopher sharing powerful life lessons.";

  const styleInstruction = isPsycho
    ? "- Style: Dark psychology, viral storytelling, intense psychological revelations, and high-retention faceless automation."
    : "- Style: Stoic philosophy, motivational storytelling, discipline-focused, highly inspiring, and high-retention faceless automation.";

  const systemPrompt = `You are an elite YouTube Shorts scriptwriter.

STRICT VOICE GENERATION RULES:
- NEVER read punctuation marks aloud. Do NOT include words like "comma", "period", "quotation mark", "double quote", "colon", "semicolon", or "bracket" in the script text.
${toneInstruction}
- Do NOT make the narration too slow. Keep a medium-fast modern pacing optimized for high audience retention.
- Add natural pause markers strategically where needed: [pause-short], [pause-medium], [pause-long]. Never overuse pauses.
- Sentences must flow naturally for neural AI voice engines (Edge TTS). Avoid overly complex sentence structures.
- Convert difficult written language into simple, spoken, natural Hindi (Devanagari script). The entire script MUST be in Hindi.
- No emojis under any circumstance, as they break TTS engines.

NARRATION & RETENTION STYLE RULES:
${styleInstruction}
- Use strong hooks, emotional pacing, curiosity gaps, tension building, and smooth transitions.
- Shorter, punchy sentences (maximum 15 words per sentence).
- ADVANCED RETENTION OPTIMIZATION: Every 3 to 7 seconds, maintain curiosity, introduce emotional variation, avoid flat pacing, and keep the energy dynamic.

PACING STRUCTURE:
- 0-2 sec: HOOK (opening line - maximum impact)
- 2-8 sec: SETUP (context, what happened)
- 8-20 sec: ESCALATION (build tension, reveal layers)
- 20-35 sec: PAYOFF (big reveal, twist, or chilling conclusion)

Respond strictly in JSON format:
{
  "script": "the full narration script containing strategic [pause-short], [pause-medium], [pause-long] markers, but absolutely no emojis or spelled-out punctuation words",
  "word_count": 0,
  "estimated_duration_seconds": 0,
  "pacing_breakdown": {
    "hook": "0-2 sec text",
    "setup": "2-8 sec text",
    "escalation": "8-20 sec text",
    "payoff": "20-35 sec text"
  },
  "emotional_arc": "description of emotional journey",
  "key_retention_hooks": ["list of retention techniques used"]
}`;

  const result = await ai.chat({
    systemPrompt: systemPrompt,
    userPrompt: `Topic: ${topic.title}
Category: ${topic.category}
Description: ${topic.description || 'N/A'}
Angle: ${topic.raw_data?.scoring?.suggested_angle || 'dramatic reveal'}

HOOK (must be the opening line): "${hook}"

Write a viral YouTube Short script in HINDI (Devanagari script). Max ${config.content.maxScriptWords} words.
The script must start with the hook and build to a powerful payoff.
Make every word count. No wasted breath.`,
    temperature: 0.75,
    maxTokens: 1000,
    jsonMode: true,
  });

  // Validate word count
  const actualWords = result.script.split(/\s+/).length;
  if (actualWords > config.content.maxScriptWords + 10) {
    logger.warn(`Script exceeded word limit: ${actualWords} words, regenerating...`);
    // Retry with stricter prompt
    const retry = await ai.chat({
      systemPrompt: 'You are a script editor. Condense this script to EXACTLY 85 words or fewer while keeping the hook, tension, and payoff intact. Respond in the same JSON format. MUST BE IN HINDI (Devanagari).',
      userPrompt: `Original script (${actualWords} words):\n${result.script}\n\nCondense to under 85 words. Keep the dramatic pacing. MUST BE IN HINDI.`,
      temperature: 0.5,
      maxTokens: 800,
      jsonMode: true,
    });
    return {
      script: retry.script,
      wordCount: retry.script.split(/\s+/).length,
      estimatedDuration: retry.estimated_duration_seconds || 30,
      pacingBreakdown: retry.pacing_breakdown,
      emotionalArc: retry.emotional_arc,
      retentionHooks: retry.key_retention_hooks,
    };
  }

  logger.info(`Script generated: ${actualWords} words, ~${result.estimated_duration_seconds}s`);

  return {
    script: result.script,
    wordCount: actualWords,
    estimatedDuration: result.estimated_duration_seconds || 30,
    pacingBreakdown: result.pacing_breakdown,
    emotionalArc: result.emotional_arc,
    retentionHooks: result.key_retention_hooks,
  };
}

export default { generateScript };
