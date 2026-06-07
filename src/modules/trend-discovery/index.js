import axios from 'axios';
import * as cheerio from 'cheerio';
import Parser from 'rss-parser';
import { createModuleLogger } from '../../utils/logger.js';
import { insertTopic, topicExists } from '../../database/client.js';
import { generateFingerprint, sleep } from '../../utils/helpers.js';

const logger = createModuleLogger('trend-discovery');
const rssParser = new Parser();

const STOIC_KEYWORDS = [
  'stoicism', 'stoic', 'Marcus Aurelius', 'Seneca', 'Epictetus',
  'motivation', 'self improvement', 'discipline', 'productivity',
  'success habits', 'life lessons', 'mindset', 'resilience',
  'mental toughness', 'personal growth', 'overcoming adversity',
  'focus', 'habits', 'morning routine', 'hustle', 'philosophy'
];

const PSYCHO_KEYWORDS = [
  'psychology', 'human behavior', 'subconscious', 'mind',
  'body language', 'dark psychology', 'manipulation',
  'cognitive bias', 'mental', 'trauma', 'personality',
  'neuroscience', 'brain', 'social dynamics', 'sociology',
  'persuasion', 'psychological trick', 'psychopath',
  'narcissist', 'narcissism', 'sociopath', 'behavioral'
];

const CATEGORY_MAP = {
  // Stoic Categories
  'stoic|aurelius|seneca|epictetus': 'stoic_philosophy',
  'motivat|inspir|success': 'motivation',
  'discipline|toughness|resilience': 'discipline',
  'productiv|habit|routine': 'productivity_hacks',
  'life|lesson|growth|mindset': 'life_advice',
  // Psychology Categories
  'dark|manipul|persua': 'dark_psychology',
  'body language|micro.?expression|posture': 'body_language',
  'neuro|brain|cognitive': 'neuroscience',
  'trauma|mental|therapy': 'mental_health',
  'social|sociolog|dynamic': 'social_dynamics',
  'personality|narcissis|psychopath|sociopath': 'personality_traits',
  'subconscious|dream|mind': 'subconscious_mind'
};

function isStoicDay() {
  // Alternates every day: even days = Stoicism, odd days = Psychology
  return new Date().getDate() % 2 === 0;
}

function getActiveKeywords() {
  return isStoicDay() ? STOIC_KEYWORDS : PSYCHO_KEYWORDS;
}

function categorize(text) {
  const lower = text.toLowerCase();
  for (const [pattern, category] of Object.entries(CATEGORY_MAP)) {
    if (new RegExp(pattern).test(lower)) return category;
  }
  return isStoicDay() ? 'motivation' : 'dark_psychology'; // Fallback to current day's primary category
}

// ============================================
// SOURCE: REDDIT
// ============================================
async function fetchRedditTopics() {
  const subreddits = isStoicDay() 
    ? ['Stoicism', 'selfimprovement', 'productivity', 'GetMotivated', 'DecidingToBeBetter', 'ZenHabits', 'philosophy', 'Discipline']
    : ['psychology', 'science', 'neuroscience', 'socialskills', 'humanbehavior', 'sociology', 'CognitiveScience', 'PsychologicalTricks'];
  const topics = [];
  const activeKeywords = getActiveKeywords();

  for (const sub of subreddits) {
    try {
      const response = await axios.get(
        `https://www.reddit.com/r/${sub}/hot.json?limit=15`,
        {
          headers: { 'User-Agent': 'YTShortsBot/1.0' },
          timeout: 10000,
        }
      );

      const posts = response.data?.data?.children || [];
      for (const post of posts) {
        const { title, selftext, url, score, num_comments, created_utc } = post.data;

        // Filter: must be recent (last 72 hours) and have engagement
        const ageHours = (Date.now() / 1000 - created_utc) / 3600;
        if (ageHours > 72 || score < 50) continue;

        // Filter: must match niche
        const isRelevant = activeKeywords.some(kw =>
          title.toLowerCase().includes(kw.toLowerCase())
        );
        if (!isRelevant) continue;

        topics.push({
          title: title.substring(0, 300),
          description: (selftext || '').substring(0, 500),
          source: 'reddit',
          source_url: url,
          category: categorize(title),
          raw_data: { subreddit: sub, score, num_comments, age_hours: Math.round(ageHours) },
        });
      }
      await sleep(1000); // Rate limiting
    } catch (err) {
      logger.warn(`Reddit fetch failed for r/${sub}`, { error: err.message });
    }
  }

  logger.info(`Fetched ${topics.length} topics from Reddit`);
  return topics;
}

// ============================================
// SOURCE: HACKER NEWS
// ============================================
async function fetchHackerNewsTopics() {
  const topics = [];
  const activeKeywords = getActiveKeywords();
  try {
    const { data: topIds } = await axios.get(
      'https://hacker-news.firebaseio.com/v0/topstories.json',
      { timeout: 10000 }
    );

    const top50 = topIds.slice(0, 50);
    for (const id of top50) {
      try {
        const { data: story } = await axios.get(
          `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
          { timeout: 5000 }
        );

        if (!story || !story.title) continue;

        const isRelevant = activeKeywords.some(kw =>
          story.title.toLowerCase().includes(kw.toLowerCase())
        );
        if (!isRelevant) continue;

        if (story.score < 30) continue;

        topics.push({
          title: story.title,
          description: story.url || '',
          source: 'hackernews',
          source_url: story.url || `https://news.ycombinator.com/item?id=${id}`,
          category: categorize(story.title),
          raw_data: { score: story.score, comments: story.descendants || 0 },
        });
      } catch (err) {
        // Skip individual story errors
      }
      await sleep(200);
    }
  } catch (err) {
    logger.warn('HackerNews fetch failed', { error: err.message });
  }

  logger.info(`Fetched ${topics.length} topics from HackerNews`);
  return topics;
}

// ============================================
// SOURCE: TECHCRUNCH (RSS)
// ============================================
async function fetchTechCrunchTopics() {
  const topics = [];
  const activeKeywords = getActiveKeywords();
  try {
    const query = isStoicDay() 
      ? 'stoicism+motivation+self+improvement' 
      : 'psychology+human+behavior+dark+psychology';
    const feed = await rssParser.parseURL(`https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`);

    for (const item of feed.items.slice(0, 20)) {
      const isRelevant = activeKeywords.some(kw =>
        (item.title + ' ' + (item.contentSnippet || '')).toLowerCase().includes(kw.toLowerCase())
      );
      if (!isRelevant) continue;

      topics.push({
        title: item.title,
        description: (item.contentSnippet || '').substring(0, 500),
        source: 'techcrunch',
        source_url: item.link,
        category: categorize(item.title),
        raw_data: { pubDate: item.pubDate },
      });
    }
  } catch (err) {
    logger.warn('TechCrunch feed fetch failed', { error: err.message });
  }

  logger.info(`Fetched ${topics.length} topics from TechCrunch`);
  return topics;
}

// ============================================
// SOURCE: GOOGLE TRENDS (via RSS)
// ============================================
async function fetchGoogleTrendsTopics() {
  const topics = [];
  const activeKeywords = getActiveKeywords();
  try {
    const feed = await rssParser.parseURL(
      'https://trends.google.com/trends/trendingsearches/daily/rss?geo=US'
    );

    for (const item of feed.items.slice(0, 30)) {
      const isRelevant = activeKeywords.some(kw =>
        item.title.toLowerCase().includes(kw.toLowerCase())
      );
      if (!isRelevant) continue;

      topics.push({
        title: item.title,
        description: (item.contentSnippet || '').substring(0, 500),
        source: 'google_trends',
        source_url: item.link || '',
        category: categorize(item.title),
        raw_data: { traffic: item['ht:approx_traffic'] },
      });
    }
  } catch (err) {
    logger.warn('Google Trends fetch failed', { error: err.message });
  }

  logger.info(`Fetched ${topics.length} topics from Google Trends`);
  return topics;
}

// ============================================
// SOURCE: ARXIV (AI papers)
// ============================================
async function fetchArxivTopics() {
  const topics = [];
  const activeKeywords = getActiveKeywords();
  try {
    const query = isStoicDay() 
      ? 'all:stoicism+OR+all:motivation+OR+all:productivity' 
      : 'cat:q-bio.NC+OR+all:psychology+OR+all:behavior';
    
    const { data } = await axios.get(
      `http://export.arxiv.org/api/query?search_query=${query}&sortBy=submittedDate&sortOrder=descending&max_results=15`,
      { timeout: 15000 }
    );

    // Parse XML with cheerio
    const $ = cheerio.load(data, { xmlMode: true });
    $('entry').each((_, entry) => {
      const title = $(entry).find('title').text().replace(/\n/g, ' ').trim();
      const summary = $(entry).find('summary').text().replace(/\n/g, ' ').trim().substring(0, 500);
      const link = $(entry).find('id').text();

      if (activeKeywords.some(kw =>
        (title + ' ' + summary).toLowerCase().includes(kw.toLowerCase())
      )) {
        topics.push({
          title,
          description: summary,
          source: 'arxiv',
          source_url: link,
          category: categorize(title + ' ' + summary),
          raw_data: { type: 'research_paper' },
        });
      }
    });
  } catch (err) {
    logger.warn('ArXiv fetch failed', { error: err.message });
  }

  logger.info(`Fetched ${topics.length} topics from ArXiv`);
  return topics;
}

// ============================================
// MAIN DISCOVERY FUNCTION
// ============================================
export async function discoverTopics() {
  logger.info('Starting trend discovery across all sources...');

  // Fetch from all sources in parallel
  const [reddit, hn, tc, trends, arxiv] = await Promise.allSettled([
    fetchRedditTopics(),
    fetchHackerNewsTopics(),
    fetchTechCrunchTopics(),
    fetchGoogleTrendsTopics(),
    fetchArxivTopics(),
  ]);

  const allTopics = [
    ...(reddit.status === 'fulfilled' ? reddit.value : []),
    ...(hn.status === 'fulfilled' ? hn.value : []),
    ...(tc.status === 'fulfilled' ? tc.value : []),
    ...(trends.status === 'fulfilled' ? trends.value : []),
    ...(arxiv.status === 'fulfilled' ? arxiv.value : []),
  ];

  logger.info(`Total raw topics discovered: ${allTopics.length}`);

  // Deduplicate and insert
  let inserted = 0;
  let skipped = 0;

  for (const topic of allTopics) {
    const fingerprint = generateFingerprint(topic.title);
    const exists = await topicExists(fingerprint);

    if (exists) {
      skipped++;
      continue;
    }

    try {
      await insertTopic({
        ...topic,
        fingerprint,
        virality_score: 0,
        emotional_score: 0,
        curiosity_score: 0,
        visual_score: 0,
        uniqueness_score: 0,
        composite_score: 0,
      });
      inserted++;
    } catch (err) {
      logger.warn(`Failed to insert topic: ${topic.title}`, { error: err.message });
    }
  }

  logger.info(`Trend discovery complete: ${inserted} new, ${skipped} duplicates skipped`);
  return { total: allTopics.length, inserted, skipped };
}

export default { discoverTopics };
