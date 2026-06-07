import { createModuleLogger } from '../../utils/logger.js';
import { getAIClient } from '../../utils/ai-client.js';
import { getSupabase } from '../../database/client.js';
import { getViralPatterns } from '../../database/client.js';

const logger = createModuleLogger('topic-scoring');

// ============================================
// SCORING PROMPT
// ============================================
const SCORING_SYSTEM_PROMPT = `You are a viral YouTube Shorts strategist specializing in AI and Future Technology content.

Your task is to score a topic on 5 dimensions for its potential as a 30-second YouTube Short.

Score each dimension from 0.0 to 1.0:

1. VIRALITY (0-1): How likely this will go viral on YouTube Shorts
   - High: Shocking, surprising, world-changing implications
   - Low: Niche, already well-known, boring

2. EMOTION (0-1): How strong an emotional reaction this creates
   - High: Fear, amazement, disbelief, wonder, outrage
   - Low: Neutral, academic, dry

3. CURIOSITY (0-1): How much this makes someone NEED to watch the full video
   - High: "Wait, what?!" reaction, mystery, unexpected twist
   - Low: Predictable, no intrigue

4. VISUAL (0-1): How well this can be represented with AI-generated visuals
   - High: Dramatic imagery possible (robots, futuristic cities, AI labs)
   - Low: Abstract concept hard to visualize

5. UNIQUENESS (0-1): How different this is from typical AI content
   - High: Novel angle, underreported, surprising perspective
   - Low: "AI will take jobs" (overdone)

Respond in JSON format:
{
  "virality_score": 0.0,
  "emotional_score": 0.0,
  "curiosity_score": 0.0,
  "visual_score": 0.0,
  "uniqueness_score": 0.0,
  "reasoning": "brief explanation",
  "suggested_angle": "the best angle for a Short on this topic"
}`;

// ============================================
// SCORE SINGLE TOPIC
// ============================================
async function scoreTopic(topic) {
  const ai = getAIClient();

  const result = await ai.chat({
    systemPrompt: SCORING_SYSTEM_PROMPT,
    userPrompt: `Topic: ${topic.title}\n\nDescription: ${topic.description || 'N/A'}\nSource: ${topic.source}\nCategory: ${topic.category}`,
    temperature: 0.3,
    maxTokens: 500,
    jsonMode: true,
  });

  // Calculate composite score (weighted)
  const weights = {
    virality: 0.30,
    emotion: 0.20,
    curiosity: 0.25,
    visual: 0.15,
    uniqueness: 0.10,
  };

  const compositeScore =
    (result.virality_score * weights.virality) +
    (result.emotional_score * weights.emotion) +
    (result.curiosity_score * weights.curiosity) +
    (result.visual_score * weights.visual) +
    (result.uniqueness_score * weights.uniqueness);

  return {
    virality_score: result.virality_score,
    emotional_score: result.emotional_score,
    curiosity_score: result.curiosity_score,
    visual_score: result.visual_score,
    uniqueness_score: result.uniqueness_score,
    composite_score: Math.round(compositeScore * 1000) / 1000,
    suggested_angle: result.suggested_angle,
    reasoning: result.reasoning,
  };
}

// ============================================
// SCORE ALL UNSCORED TOPICS
// ============================================
export async function scoreUnscoredTopics() {
  logger.info('Starting topic scoring...');
  const supabase = getSupabase();

  // Get topics with 0 composite score
  const { data: topics, error } = await supabase
    .from('topics')
    .select('*')
    .eq('composite_score', 0)
    .eq('used', false)
    .limit(30);

  if (error) throw error;
  if (!topics || topics.length === 0) {
    logger.info('No unscored topics found');
    return { scored: 0 };
  }

  logger.info(`Scoring ${topics.length} topics...`);

  // Load viral patterns to boost scoring context
  let patterns = [];
  try {
    patterns = await getViralPatterns(10);
  } catch (e) {
    // Patterns table might be empty initially
  }

  let scored = 0;
  for (const topic of topics) {
    try {
      const scores = await scoreTopic(topic);

      // Apply viral pattern boost if topic matches known viral patterns
      let boost = 0;
      for (const pattern of patterns) {
        if (pattern.pattern_type === 'topic_type' &&
            topic.category === pattern.pattern_value) {
          boost = Math.min(0.1, pattern.confidence_score * 0.1);
        }
      }

      const finalComposite = Math.min(1.0, scores.composite_score + boost);

      const { error: dbError } = await supabase
        .from('topics')
        .update({
          virality_score: scores.virality_score,
          emotional_score: scores.emotional_score,
          curiosity_score: scores.curiosity_score,
          visual_score: scores.visual_score,
          uniqueness_score: scores.uniqueness_score,
          composite_score: finalComposite,
          raw_data: {
            ...topic.raw_data,
            scoring: {
              reasoning: scores.reasoning,
              suggested_angle: scores.suggested_angle,
              pattern_boost: boost,
            },
          },
        })
        .eq('id', topic.id);

      if (dbError) throw dbError;

      scored++;
      logger.debug(`Scored topic: "${topic.title.substring(0, 60)}..." → ${finalComposite}`);
    } catch (err) {
      logger.warn(`Failed to score topic ${topic.id}`, { error: err.message });
    }
  }

  logger.info(`Topic scoring complete: ${scored}/${topics.length} scored`);
  return { scored, total: topics.length };
}

// ============================================
// SELECT BEST TOPIC FOR NEXT VIDEO
// ============================================
export async function selectBestTopic() {
  const supabase = getSupabase();

  const { data: topics, error } = await supabase
    .from('topics')
    .select('*')
    .eq('used', false)
    .gt('composite_score', 0.4) // Minimum quality threshold
    .order('composite_score', { ascending: false })
    .limit(5);

  if (error) throw error;
  if (!topics || topics.length === 0) {
    throw new Error('No high-quality topics available. Run trend discovery first.');
  }

  // Pick from top 5 with slight randomization to avoid repetitive content
  const weights = topics.map((t, i) => Math.pow(0.7, i)); // Exponential decay
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let random = Math.random() * totalWeight;

  for (let i = 0; i < topics.length; i++) {
    random -= weights[i];
    if (random <= 0) {
      logger.info(`Selected topic: "${topics[i].title.substring(0, 80)}..." (score: ${topics[i].composite_score})`);
      return topics[i];
    }
  }

  return topics[0];
}

export default { scoreUnscoredTopics, selectBestTopic };
