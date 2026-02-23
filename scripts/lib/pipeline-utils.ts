/**
 * Shared pipeline utilities — single source of truth for URL normalization,
 * Jaccard similarity, stopwords, content hashing, aggregator detection,
 * API retry logic, and Discord notifications.
 *
 * Every pipeline script imports from here so changes propagate everywhere.
 */

import { createHash } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';

// ──────────────────────────────────────────────────
// URL Normalization (Fix #1)
// ──────────────────────────────────────────────────

/**
 * Normalize a URL for dedup comparison.
 * Strips tracking params (utm_*, fbclid, etc.), trailing slashes,
 * lowercases scheme+host, and removes fragment anchors.
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    // Lowercase scheme + host
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();

    // Remove common tracking parameters
    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'msclkid', 'mc_cid', 'mc_eid',
      'ref', '_ref', 'source', 'ncid', 'ocid',
      'cmpid', 'cmp', 'amp', '__twitter_impression',
    ];
    for (const param of trackingParams) {
      u.searchParams.delete(param);
    }

    // Sort remaining params for consistent comparison
    u.searchParams.sort();

    // Remove fragment
    u.hash = '';

    // Remove trailing slash from path (unless root)
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }

    return u.toString();
  } catch {
    // If URL parsing fails, return as-is lowercased
    return url.toLowerCase().replace(/\/$/, '');
  }
}

// ──────────────────────────────────────────────────
// Domain-Specific Stopwords (Fix #3)
// ──────────────────────────────────────────────────

/**
 * Domain-specific stopwords for Epstein case Jaccard similarity.
 * These words appear in nearly every article and inflate false matches.
 * Exported so all dedup code uses the same set.
 */
export const DOMAIN_STOPWORDS = new Set([
  // General English stopwords (short)
  'that', 'this', 'with', 'from', 'have', 'been', 'were', 'their',
  'about', 'after', 'says', 'said', 'over', 'into', 'will', 'more',
  'than', 'also', 'just', 'back', 'when', 'what', 'could', 'would',
  'some', 'them', 'other', 'being', 'does', 'most', 'make', 'like',
  // Domain-specific — appear in nearly every Epstein article
  'epstein', 'jeffrey', 'files', 'documents', 'case', 'according',
  'report', 'reports', 'reported', 'reporting', 'news',
  'former', 'amid', 'ties', 'linked', 'following',
  'allegations', 'alleged', 'accused',
  'investigation', 'investigators',
  'transparency', 'released', 'release',
  'associated', 'connected', 'connection', 'connections',
  'trafficking', 'abuse',
]);

/**
 * Extract significant words from text for Jaccard comparison.
 * Uses domain stopwords to filter out noise.
 */
export function getSignificantWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !DOMAIN_STOPWORDS.has(w));
  return new Set(words);
}

/**
 * Jaccard similarity between two word sets.
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const arrA = Array.from(a);
  const intersection = arrA.filter((w) => b.has(w)).length;
  const arrB = Array.from(b);
  const unionSet = new Set(arrA.concat(arrB));
  return unionSet.size > 0 ? intersection / unionSet.size : 0;
}

/**
 * Check if two texts are similar above a given Jaccard threshold.
 */
export function textsAreSimilar(a: string, b: string, threshold: number): boolean {
  const wordsA = getSignificantWords(a);
  const wordsB = getSignificantWords(b);
  return jaccardSimilarity(wordsA, wordsB) >= threshold;
}

// ──────────────────────────────────────────────────
// Content Hashing (Fix #2 + #4)
// ──────────────────────────────────────────────────

/**
 * Generate a short content signature for body-level dedup.
 * Uses first 500 chars of description to create an 8-char hex hash.
 * Two articles with the same contentHash are the same story — even if titles differ.
 */
export function contentHash(text: string): string {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 500);
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

// ──────────────────────────────────────────────────
// Aggregator Detection
// ──────────────────────────────────────────────────

export const AGGREGATOR_SOURCES = new Set([
  'yahoo', 'yahoo news', 'yahoo entertainment', 'yahoo finance',
  'msn', 'msn news', 'microsoft news',
  'aol', 'aol news',
  'newsbreak', 'smartnews', 'apple news',
  'google news', 'google',
  'flipboard',
  'unknown source',
]);

export function isAggregatorSource(source: string): boolean {
  return AGGREGATOR_SOURCES.has(source.toLowerCase().trim());
}

// ──────────────────────────────────────────────────
// API Retry with Exponential Backoff (Fix #12)
// ──────────────────────────────────────────────────

interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;     // ms
  maxDelay?: number;      // ms
  timeoutMs?: number;     // per-attempt timeout
}

const DEFAULT_RETRY: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelay: 2000,
  maxDelay: 30000,
  timeoutMs: 120000,
};

/**
 * Call the Anthropic API with automatic retry on 429/529/5xx errors.
 * Uses exponential backoff with jitter. Respects retry-after headers.
 */
export async function callAnthropicWithRetry(
  client: Anthropic,
  params: Anthropic.MessageCreateParams,
  opts?: RetryOptions,
): Promise<Anthropic.Message> {
  const { maxRetries, baseDelay, maxDelay, timeoutMs } = { ...DEFAULT_RETRY, ...opts };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const response = await client.messages.create(params, {
        signal: controller.signal as any,
      });

      clearTimeout(timer);
      return response;
    } catch (error: any) {
      lastError = error;
      clearTimeout(0); // just in case

      const status = error?.status || error?.statusCode || 0;
      const isRetryable =
        status === 429 ||         // Rate limited
        status === 529 ||         // Overloaded
        (status >= 500 && status < 600) || // Server error
        error?.code === 'ECONNRESET' ||
        error?.code === 'ETIMEDOUT' ||
        error?.message?.includes('aborted');

      if (!isRetryable || attempt >= maxRetries) {
        throw error;
      }

      // Calculate backoff with jitter
      let delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

      // Respect retry-after header if present
      const retryAfter = error?.headers?.['retry-after'];
      if (retryAfter) {
        const retryMs = parseInt(retryAfter, 10) * 1000;
        if (!isNaN(retryMs)) delay = Math.max(delay, retryMs);
      }

      // Add jitter (±25%)
      delay = delay * (0.75 + Math.random() * 0.5);

      console.log(`  API retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms (status=${status})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error('API call failed after retries');
}

// ──────────────────────────────────────────────────
// Discord Webhook Notification (Fix #11)
// ──────────────────────────────────────────────────

interface PipelineResult {
  articlesCreated: number;
  articlesRejected: number;
  factCheckFails: string[];
  errors: string[];
  feedsFailed: string[];
}

/**
 * Send a pipeline summary to Discord via webhook.
 * Only sends if DISCORD_WEBHOOK_URL env var is set.
 * Fails silently — notification errors should never block the pipeline.
 */
export async function notifyDiscord(result: PipelineResult): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    const emoji = result.errors.length > 0 ? ':warning:' :
                  result.articlesCreated > 0 ? ':newspaper:' : ':zzz:';

    let description = `**Created:** ${result.articlesCreated} articles\n**Rejected:** ${result.articlesRejected}`;

    if (result.factCheckFails.length > 0) {
      description += `\n\n:x: **Fact-check failures:**\n${result.factCheckFails.map(f => `- ${f}`).join('\n')}`;
    }

    if (result.errors.length > 0) {
      description += `\n\n:warning: **Errors:**\n${result.errors.slice(0, 5).map(e => `- ${e}`).join('\n')}`;
    }

    if (result.feedsFailed.length > 0) {
      description += `\n\n:broken_heart: **Feeds down:**\n${result.feedsFailed.map(f => `- ${f}`).join('\n')}`;
    }

    const payload = {
      embeds: [{
        title: `${emoji} Pipeline Run`,
        description,
        color: result.errors.length > 0 ? 0xff4444 : result.articlesCreated > 0 ? 0x44bb44 : 0x888888,
        timestamp: new Date().toISOString(),
      }],
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch {
    // Silently fail — notifications should never break the pipeline
  }
}

// ──────────────────────────────────────────────────
// Feed Health Tracking (Fix #15)
// ──────────────────────────────────────────────────

export interface FeedHealthEntry {
  feedId: string;
  feedName: string;
  lastSuccess: string | null;
  lastFailure: string | null;
  consecutiveFailures: number;
  lastError: string | null;
}

export interface FeedHealthData {
  feeds: Record<string, FeedHealthEntry>;
  lastUpdated: string;
}

export function createEmptyFeedHealth(): FeedHealthData {
  return { feeds: {}, lastUpdated: new Date().toISOString() };
}

export function recordFeedSuccess(health: FeedHealthData, feedId: string, feedName: string): void {
  if (!health.feeds[feedId]) {
    health.feeds[feedId] = { feedId, feedName, lastSuccess: null, lastFailure: null, consecutiveFailures: 0, lastError: null };
  }
  health.feeds[feedId].lastSuccess = new Date().toISOString();
  health.feeds[feedId].consecutiveFailures = 0;
  health.feeds[feedId].lastError = null;
}

export function recordFeedFailure(health: FeedHealthData, feedId: string, feedName: string, error: string): void {
  if (!health.feeds[feedId]) {
    health.feeds[feedId] = { feedId, feedName, lastSuccess: null, lastFailure: null, consecutiveFailures: 0, lastError: null };
  }
  health.feeds[feedId].lastFailure = new Date().toISOString();
  health.feeds[feedId].consecutiveFailures += 1;
  health.feeds[feedId].lastError = error.slice(0, 200);
}

export function getDownFeeds(health: FeedHealthData, threshold: number = 3): FeedHealthEntry[] {
  return Object.values(health.feeds).filter(f => f.consecutiveFailures >= threshold);
}
