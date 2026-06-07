import { createModuleLogger } from '../../utils/logger.js';
import { getAIClient } from '../../utils/ai-client.js';
import { getViralPatterns } from '../../database/client.js';

const logger = createModuleLogger('hook-generator');

const STOIC_HOOK_FORMULAS = [
  "Marcus Aurelius used this one habit to rule an empire…",
  "If you want to be truly successful, stop doing this immediately…",
  "The ancient stoic secret to never feeling stressed again…",
  "This one mindset shift will change your life…",
  "Why 99% of people fail, and how to be the 1%…",
  "Seneca warned us about this 2000 years ago…",
  "The harsh truth about success nobody tells you…",
  "If you feel lost in life, listen to this ancient advice…",
  "Discipline is the only cheat code to life. Here is why…",
  "Stop wasting your time. Do this instead…",
  "The ultimate productivity system used by billionaires…",
  "How to build an unbreakable mind like a stoic…",
  "This is why you are not achieving your goals…",
  "A powerful life lesson you need to hear today…",
  "Your daily routine is destroying your potential…",
];

const PSYCHO_HOOK_FORMULAS = [
  "This psychological fact will terrify you…",
  "Your brain has been tricking you all along…",
  "The dark truth about human behavior nobody tells you…",
  "Psychologists are warning everyone about this…",
  "Nobody realizes they are doing this every day…",
  "Why your subconscious mind is secretly controlling you…",
  "This is the most dangerous psychological trick ever…",
  "The psychology behind why we fail is insane…",
  "You need to know this before someone manipulates you…",
  "Your reality is an illusion…",
  "Everything you know about human nature is wrong…",
  "This psychological study shocked scientists…",
  "Are you being manipulated right now? Here is how to tell…",
  "This dark psychology trick is almost illegal…",
  "The disturbing truth about how your mind works…",
];

function isPsychologyCategory(category) {
  const psychoCategories = ['dark_psychology', 'body_language', 'neuroscience', 'mental_health', 'social_dynamics', 'personality_traits', 'subconscious_mind'];
  return psychoCategories.includes(category);
}

const HOOK_SYSTEM_PROMPT = `You are an elite YouTube Shorts hook writer.

Rules:
- 3-12 words max
- Create instant curiosity, profound realization, or fear
- Tone depends on the topic: either highly authoritative/disciplined (for Motivation) or highly intelligent/mysterious (for Dark Psychology)
- MUST BE WRITTEN IN HINDI (Devanagari script)
- Use "…" for pauses
- Avoid spam words

Respond in JSON:
{
  "hooks": [
    { "text": "Hindi hook text here", "trigger_type": "fear|curiosity|amazement", "estimated_ctr": 0.0-1.0 }
  ],
  "recommended_index": 0
}`;

export async function generateHooks(topic) {
  const ai = getAIClient();
  const isPsycho = isPsychologyCategory(topic.category);

  const formulas = isPsycho ? PSYCHO_HOOK_FORMULAS : STOIC_HOOK_FORMULAS;
  const randomFormulas = formulas.sort(() => Math.random() - 0.5).slice(0, 5).join('\n');

  const result = await ai.chat({
    systemPrompt: HOOK_SYSTEM_PROMPT,
    userPrompt: `Topic: ${topic.title}\nCategory: ${topic.category}\nAngle: ${topic.raw_data?.scoring?.suggested_angle || 'truth'}\n\nInspiration formulas (translate and adapt to Hindi):\n${randomFormulas}\n\nGenerate 5 unique viral Hindi hooks.`,
    temperature: 0.85,
    maxTokens: 800,
    jsonMode: true,
  });

  const selectedIndex = result.recommended_index || 0;
  const selectedHook = result.hooks[selectedIndex];

  logger.info(`Generated ${result.hooks.length} hooks, selected: "${selectedHook.text}"`);

  return {
    selectedHook: selectedHook.text,
    allHooks: result.hooks,
    triggerType: selectedHook.trigger_type,
    estimatedCtr: selectedHook.estimated_ctr,
  };
}

export default { generateHooks };
