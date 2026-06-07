import { createModuleLogger } from '../../utils/logger.js';
import { getAIClient } from '../../utils/ai-client.js';

const logger = createModuleLogger('seo-generator');

const SEO_SYSTEM_PROMPT = `You are a YouTube SEO specialist for Motivational & Stoicism Shorts.

Generate SEO metadata that maximizes discoverability while feeling authentic.

TITLE RULES:
- 40-60 characters
- Create curiosity gap
- Feel urgent but not spammy
- Include 1 relevant keyword naturally
- Avoid ALL CAPS (one word max)
- No clickbait spam

DESCRIPTION RULES:
- 150-300 characters
- Include relevant keywords naturally
- Add a call to action
- Include 3-5 hashtags at the end

TAG RULES:
- 8-15 relevant tags
- Mix broad + specific
- Include trending stoicism and motivation keywords
- No irrelevant tags

HASHTAG RULES:
- 10-15 hashtags
- Mix popular + niche
- Include #Shorts always
- Ensure they are highly relevant and engaging

Respond in JSON:
{
  "title": "SEO optimized title",
  "description": "full description with hashtags",
  "tags": ["tag1", "tag2"],
  "hashtags": ["#Shorts", "#AI"],
  "primary_keyword": "main keyword",
  "secondary_keywords": ["kw1", "kw2"]
}`;

export async function generateSEO(script, topic, hook) {
  const ai = getAIClient();

  const result = await ai.chat({
    systemPrompt: SEO_SYSTEM_PROMPT,
    userPrompt: `Script: "${script}"\nTopic: ${topic.title}\nCategory: ${topic.category}\nHook: "${hook}"\n\nGenerate SEO metadata.`,
    temperature: 0.6,
    maxTokens: 600,
    jsonMode: true,
  });

  // Ensure #Shorts is included
  if (!result.hashtags.includes('#Shorts')) {
    result.hashtags.unshift('#Shorts');
  }

  // Validate title length
  if (result.title.length > 100) {
    result.title = result.title.substring(0, 97) + '...';
  }

  // Append user-requested static keywords to the description
  const staticKeywordsText = "\n\nKeywords: stoicism, stoic mindset, stoic philosophy, marcus aurelius, seneca, epictetus, self discipline, mental toughness, personal growth, self improvement, motivation, success mindset, mindset, life lessons, productivity, emotional intelligence, confidence, inner peace, philosophy, daily motivation.";
  result.description = result.description + staticKeywordsText;

  // Append user-requested static tags to the tags array
  const staticTags = [
    "The Stoic Mindset", "Stoic Wisdom", "Stoicism Explained", 
    "Marcus Aurelius Quotes", "Daily Stoic", "Stoic Motivation", 
    "Self Discipline", "Personal Development", "Mental Strength", 
    "Ancient Wisdom", "Life Lessons", "Mindset Training", 
    "Success Habits", "Motivational Videos", "Emotional Control"
  ];
  
  // Combine AI generated tags with static tags, deduplicate, and limit total characters for YouTube (500 limit)
  let finalTags = [...new Set([...result.tags, ...staticTags])];
  
  // Basic safeguard to keep tags under ~450 chars
  while (finalTags.join(',').length > 450 && finalTags.length > staticTags.length) {
    finalTags.shift(); // Remove AI tags first to preserve the mandatory static tags
  }
  result.tags = finalTags;

  logger.info(`SEO generated: "${result.title}"`);

  return {
    title: result.title,
    description: result.description,
    tags: result.tags,
    hashtags: result.hashtags,
    primaryKeyword: result.primary_keyword,
    secondaryKeywords: result.secondary_keywords,
  };
}

export default { generateSEO };
