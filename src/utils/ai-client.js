import axios from 'axios';
import config from '../config/index.js';
import { createModuleLogger } from './logger.js';
import pRetry from 'p-retry';

const logger = createModuleLogger('ai-client');

/**
 * 100% FREE AI client using GROQ API (Llama 3).
 * 
 * Groq is insanely fast and has a huge free tier.
 * Models: llama3-8b-8192, llama3-70b-8192
 */
export class AIClient {
  constructor() {
    // We will repurpose the GEMINI_API_KEY environment variable spot to hold the Groq key
    // so you don't have to change your .env file names.
    this.apiKey = config.ai.gemini.apiKey; 
    this.baseUrl = 'https://api.groq.com/openai/v1/chat/completions';
    this.requestCount = 0;
    this.lastRequestTime = 0;
  }

  /**
   * Rate limiter (Groq is very generous, 30 RPM for 8b model)
   */
  async _rateLimit() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;

    // 2 seconds between requests
    if (elapsed < 2000) {
      const waitTime = 2000 - elapsed;
      logger.debug(`Rate limiting: waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
    this.requestCount++;
  }

  /**
   * Send a chat request to Groq API (FREE).
   */
  async chat({ systemPrompt, userPrompt, temperature = 0.7, maxTokens = 2000, jsonMode = false, usePro = false }) {
    await this._rateLimit();

    const model = usePro ? 'llama-3.3-70b-versatile' : 'llama-3.1-8b-instant';

    const requestBody = {
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: temperature,
      max_tokens: maxTokens,
      top_p: 0.95
    };

    if (jsonMode) {
      requestBody.response_format = { type: 'json_object' };
    }

    const run = async () => {
      const startTime = Date.now();

      const response = await axios.post(this.baseUrl, requestBody, {
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        timeout: 60000,
      });

      const elapsed = Date.now() - startTime;
      const result = response.data;

      const content = result.choices[0]?.message?.content || '';
      const usage = result.usage || {};

      logger.debug(`Groq response [${model}]`, {
        elapsed_ms: elapsed,
        total_tokens: usage.total_tokens,
        cost: '$0.00 (FREE)',
      });

      if (!content) {
        throw new Error('Empty response from Groq');
      }

      return jsonMode ? this._parseJSON(content) : content;
    };

    return pRetry(run, {
      retries: 3,
      minTimeout: 2000,
      factor: 2,
      onFailedAttempt: (error) => {
        const isRateLimit = error.message?.includes('429');
        logger.warn(`Groq request attempt ${error.attemptNumber} failed`, {
          error: error.message,
          isRateLimit,
          retriesLeft: error.retriesLeft,
        });

        if (isRateLimit) {
          return new Promise(resolve => setTimeout(resolve, 5000));
        }
      },
    });
  }

  /**
   * Parse JSON from AI response, handling markdown code blocks.
   */
  _parseJSON(content) {
    let cleaned = content.trim();

    // Remove markdown code block wrapping
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }

    try {
      return JSON.parse(cleaned.trim());
    } catch (e) {
      logger.error('Failed to parse JSON from Groq', {
        content: cleaned.substring(0, 300),
      });
      throw new Error(`Groq returned invalid JSON: ${e.message}`);
    }
  }
}

// Singleton
let aiClientInstance = null;
export function getAIClient() {
  if (!aiClientInstance) {
    aiClientInstance = new AIClient();
  }
  return aiClientInstance;
}

export default AIClient;
