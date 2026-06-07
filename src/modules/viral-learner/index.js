import { createModuleLogger } from '../../utils/logger.js';
import { getAIClient } from '../../utils/ai-client.js';
import { getAnalyticsForLearning, insertViralPattern, getViralPatterns, getSupabase } from '../../database/client.js';

const logger = createModuleLogger('viral-learner');

const LEARNING_SYSTEM_PROMPT = `You are a YouTube Shorts viral content analyst for AI/Future Technology niche.

Analyze performance data from past videos to identify patterns that drive virality.

For each pattern found, provide:
- Pattern type: hook_style, topic_type, pacing, visual_style, emotional_trigger
- Pattern value: specific description of the pattern
- Confidence: 0.0-1.0 based on sample size and consistency

Look for:
1. Which hook styles get highest retention
2. Which topic categories get most views
3. Which emotional arcs perform best
4. Which visual styles correlate with engagement
5. Optimal pacing patterns

Respond in JSON:
{
  "patterns": [
    {
      "pattern_type": "hook_style|topic_type|pacing|visual_style|emotional_trigger",
      "pattern_value": "description",
      "description": "explanation of why this works",
      "confidence_score": 0.0-1.0
    }
  ],
  "recommendations": [
    "actionable recommendation for future content"
  ],
  "avoid": [
    "patterns that correlate with poor performance"
  ]
}`;

// ============================================
// ANALYZE AND LEARN
// ============================================
export async function analyzeAndLearn() {
  logger.info('Starting viral pattern learning...');

  const analyticsData = await getAnalyticsForLearning();

  if (!analyticsData || analyticsData.length < 5) {
    logger.info('Not enough data for learning (need 5+ videos with 100+ views)');
    return { patterns: [], message: 'Insufficient data' };
  }

  const ai = getAIClient();

  // Prepare analysis data
  const analysisInput = analyticsData.map(a => ({
    title: a.videos?.title,
    hook: a.videos?.hook,
    category: a.videos?.topic_category,
    tags: a.videos?.tags,
    views: a.views,
    retention: a.retention_rate,
    ctr: a.ctr,
    likes: a.likes,
    comments: a.comments,
    tier: a.performance_tier,
  }));

  // Split into high and low performers
  const sorted = analysisInput.sort((a, b) => b.views - a.views);
  const topPerformers = sorted.slice(0, Math.ceil(sorted.length * 0.3));
  const bottomPerformers = sorted.slice(-Math.ceil(sorted.length * 0.3));

  const result = await ai.chat({
    systemPrompt: LEARNING_SYSTEM_PROMPT,
    userPrompt: `Analyze these video performance results:

TOP PERFORMERS:
${JSON.stringify(topPerformers, null, 2)}

BOTTOM PERFORMERS:
${JSON.stringify(bottomPerformers, null, 2)}

Total videos analyzed: ${analyticsData.length}

Identify viral patterns and what to avoid.`,
    temperature: 0.4,
    maxTokens: 1500,
    jsonMode: true,
  });

  // Store patterns
  let stored = 0;
  for (const pattern of result.patterns) {
    try {
      // Calculate stats from matching videos
      const matchingVideos = analyticsData.filter(a => {
        if (pattern.pattern_type === 'topic_type') {
          return a.videos?.topic_category === pattern.pattern_value;
        }
        return true;
      });

      await insertViralPattern({
        pattern_type: pattern.pattern_type,
        pattern_value: pattern.pattern_value,
        description: pattern.description,
        sample_size: matchingVideos.length,
        avg_views: matchingVideos.reduce((s, v) => s + v.views, 0) / (matchingVideos.length || 1),
        avg_retention: matchingVideos.reduce((s, v) => s + v.retention_rate, 0) / (matchingVideos.length || 1),
        avg_ctr: matchingVideos.reduce((s, v) => s + v.ctr, 0) / (matchingVideos.length || 1),
        confidence_score: pattern.confidence_score,
        source_video_ids: matchingVideos.map(v => v.video_id).slice(0, 10),
      });
      stored++;
    } catch (err) {
      logger.warn(`Failed to store pattern`, { error: err.message });
    }
  }

  logger.info(`Viral learning complete: ${stored} patterns stored, ${result.recommendations.length} recommendations`);

  return {
    patterns: result.patterns,
    recommendations: result.recommendations,
    avoid: result.avoid,
    patternsStored: stored,
  };
}

export default { analyzeAndLearn };
