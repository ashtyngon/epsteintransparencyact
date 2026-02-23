import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import RSSParser from 'rss-parser';
import {
  normalizeUrl,
  getSignificantWords,
  jaccardSimilarity,
  textsAreSimilar,
  contentHash,
  FeedHealthData,
  createEmptyFeedHealth,
  recordFeedSuccess,
  recordFeedFailure,
  getDownFeeds,
} from './lib/pipeline-utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Only consider articles from the last 7 days
const MAX_AGE_DAYS = 7;
// Hard timeout per feed (ms)
const FEED_TIMEOUT = 8000;
// Overall script timeout (ms) — kill everything after 90 seconds
const SCRIPT_TIMEOUT = 90000;

interface FeedConfig {
  id: string;
  name: string;
  url: string;
  category: string;
  priority: number;
  enabled: boolean;
}

interface FeedsConfig {
  feeds: FeedConfig[];
  filterKeywords: string[];
  maxArticlesPerRun: number;
  deduplicationWindowDays: number;
}

interface RSSItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  source: string;
  sourceId: string;
  sourcePriority: number;
  image?: string;
  bodyHash?: string;  // Fix #4: content signature for body-level dedup
}

interface ProcessedUrls {
  processedUrls: string[];
  lastRun: string | null;
}

const CANDIDATES_PATH = join(__dirname, 'config', 'candidates.json');
const PROCESSED_PATH = join(__dirname, 'config', 'processed-urls.json');
const FEEDS_PATH = join(__dirname, 'config', 'feeds.json');
const FEED_HEALTH_PATH = join(__dirname, 'config', 'feed-health.json');
const ARTICLES_DIR = join(__dirname, '..', 'src', 'content', 'articles');

// Fix #6: Minimum content gate — reject items with fewer than this many words
// in title + description. Prevents thin wire stubs from entering the pipeline.
const MIN_CONTENT_WORDS = 25;

const parser = new RSSParser({
  timeout: FEED_TIMEOUT,
  maxRedirects: 3,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)',
  },
});

/**
 * Resolve Google News redirect URLs to their actual destination.
 * Google News RSS links are base64-encoded redirects — we follow them
 * to get the real publisher URL for sourceUrl in frontmatter.
 *
 * Fix #5: Added canonical URL extraction and link[rel=canonical] fallback
 * when redirect following fails.
 */
async function resolveGoogleNewsUrl(url: string): Promise<string> {
  if (!url.includes('news.google.com')) return url;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)' },
    });
    clearTimeout(timer);
    // After following redirects, response.url is the real destination
    const resolved = response.url;
    if (resolved && !resolved.includes('news.google.com')) {
      return normalizeUrl(resolved);
    }
    // If still Google News, try extracting from HTML
    const html = await response.text();
    // Try meta refresh
    const metaMatch = html.match(/content=["']\d+;\s*url=([^"']+)/i);
    if (metaMatch) return normalizeUrl(metaMatch[1]);
    // Try JS redirect
    const jsMatch = html.match(/window\.location\.replace\(["']([^"']+)/);
    if (jsMatch) return normalizeUrl(jsMatch[1]);
    // Fix #5: Try canonical link or data-url attribute
    const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i);
    if (canonicalMatch && !canonicalMatch[1].includes('news.google.com')) {
      return normalizeUrl(canonicalMatch[1]);
    }
    const dataUrlMatch = html.match(/data-url=["']([^"']+)/);
    if (dataUrlMatch && !dataUrlMatch[1].includes('news.google.com')) {
      return normalizeUrl(dataUrlMatch[1]);
    }
    return url; // Give up, return original
  } catch {
    return url; // On error, keep original
  }
}

async function fetchFeed(feed: FeedConfig, cutoffDate: Date): Promise<RSSItem[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT);

    const response = await fetch(feed.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)' },
    });
    const xml = await response.text();
    clearTimeout(timer);

    const parsed = await parser.parseString(xml);

    const items = (parsed.items || [])
      .map((item: any) => {
        // Extract image from multiple RSS image sources
        let image: string | undefined;
        // 1. Enclosure (common in RSS 2.0)
        if (item.enclosure?.url && item.enclosure?.type?.startsWith('image/')) {
          image = item.enclosure.url;
        }
        // 2. media:content or media:thumbnail
        if (!image && item['media:content']?.$?.url) {
          image = item['media:content'].$.url;
        }
        if (!image && item['media:thumbnail']?.$?.url) {
          image = item['media:thumbnail'].$.url;
        }
        // 3. Extract from content/description HTML (og:image pattern or <img src>)
        if (!image) {
          const html = item.content || item['content:encoded'] || '';
          const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
          if (imgMatch) image = imgMatch[1];
        }

        // For Google News aggregator, extract actual publisher name
        let sourceName = feed.name;
        if (feed.category === 'aggregator') {
          // rss-parser exposes <source> as string or object with _ / name / $ properties
          const rssSource = typeof item.source === 'string' ? item.source
            : (item.source?._ || item.source?.name || item.source?.$?.text || null);
          if (rssSource && typeof rssSource === 'string' && rssSource.length > 1) {
            sourceName = rssSource;
          } else {
            // Google News titles: "Article Title - Publisher Name"
            const titleParts = (item.title || '').split(' - ');
            if (titleParts.length > 1) {
              sourceName = titleParts[titleParts.length - 1].trim();
            }
          }
          // HARD FAILSAFE: never output "Google News" or "Google" as source
          if (/google/i.test(sourceName)) {
            const parts = (item.title || '').split(' - ');
            sourceName = parts.length > 1 ? parts[parts.length - 1].trim() : 'Unknown Source';
          }
          // HARD FAILSAFE: source names must be English/ASCII — reject non-Latin scripts
          if (/[^\x00-\x7F]/.test(sourceName)) {
            // Try extracting from title "Article Title - Publisher" pattern
            const parts = (item.title || '').split(' - ');
            const lastPart = parts.length > 1 ? parts[parts.length - 1].trim() : '';
            if (lastPart && !/[^\x00-\x7F]/.test(lastPart)) {
              sourceName = lastPart;
            } else {
              sourceName = 'Unknown Source';
            }
          }
        }

        const description = (item.contentSnippet || item.content || '').slice(0, 1000);
        const rawLink = item.link || '';

        return {
          title: item.title || '',
          link: rawLink,
          description,
          pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
          source: sourceName,
          sourceId: feed.id,
          sourcePriority: feed.priority,
          image,
          bodyHash: contentHash(description),  // Fix #4: body signature for dedup
        };
      })
      // Drop articles older than cutoff
      .filter((item) => {
        const itemDate = new Date(item.pubDate);
        return !isNaN(itemDate.getTime()) && itemDate >= cutoffDate;
      })
      // Fix #6: Minimum content gate — reject items with <25 words total
      .filter((item) => {
        const wordCount = `${item.title} ${item.description}`.split(/\s+/).filter(w => w.length > 0).length;
        return wordCount >= MIN_CONTENT_WORDS;
      });

    // For aggregator feeds (Google News), resolve redirect URLs to real publisher URLs
    if (feed.category === 'aggregator') {
      const resolved = await Promise.allSettled(
        items.map(async (item) => {
          item.link = await resolveGoogleNewsUrl(item.link);
          return item;
        })
      );
      return resolved
        .filter((r): r is PromiseFulfilledResult<RSSItem> => r.status === 'fulfilled')
        .map((r) => r.value);
    }

    return items;
  } catch (error) {
    console.error(`  WARN: ${feed.name}: ${(error as Error).message?.slice(0, 50)}`);
    return [];
  }
}

function preFilterByKeywords(items: RSSItem[], keywords: string[]): RSSItem[] {
  const lowerKeywords = keywords.map((k) => k.toLowerCase());
  return items.filter((item) => {
    const text = `${item.title} ${item.description}`.toLowerCase();
    return lowerKeywords.some((kw) => text.includes(kw));
  });
}

// Jaccard functions now imported from pipeline-utils (uses domain stopwords)

function titlesAreSimilar(a: string, b: string): boolean {
  const setA = getSignificantWords(a);
  const setB = getSignificantWords(b);
  return jaccardSimilarity(setA, setB) >= 0.4;
}

function loadExistingArticleTitles(): string[] {
  try {
    const files = readdirSync(ARTICLES_DIR).filter((f) => f.endsWith('.md'));
    const titles: string[] = [];
    for (const file of files) {
      const content = readFileSync(join(ARTICLES_DIR, file), 'utf-8');
      const titleMatch = content.match(/^title:\s*"(.+?)"/m);
      const summaryMatch = content.match(/^summary:\s*"(.+?)"/m);
      if (titleMatch) {
        // Store title + summary combined for richer matching surface
        // This catches cases where titles differ but summaries describe the same event
        const combined = summaryMatch
          ? `${titleMatch[1]} ${summaryMatch[1]}`
          : titleMatch[1];
        titles.push(combined);
      }
    }
    return titles;
  } catch {
    return [];
  }
}

// textsAreSimilar is now imported from pipeline-utils

function deduplicateByTitle(items: RSSItem[], existingTitles: string[]): RSSItem[] {
  const groups: { text: string; hash: string | null; best: RSSItem | null }[] = [];

  // Seed groups with existing published articles — these block but don't output
  for (const title of existingTitles) {
    if (title.length > 0) {
      groups.push({ text: title, hash: null, best: null });
    }
  }

  for (const item of items) {
    const itemText = `${item.title} ${item.description.slice(0, 200)}`;
    let merged = false;

    for (const group of groups) {
      // Fix #4: Also check body hash for exact-content dedup
      if (item.bodyHash && group.hash && item.bodyHash === group.hash) {
        if (group.best === null) { merged = true; break; }
        if (item.sourcePriority < group.best.sourcePriority) {
          group.best = item;
          group.text = itemText;
          group.hash = item.bodyHash || null;
        }
        merged = true;
        break;
      }

      // Jaccard on title
      if (titlesAreSimilar(item.title, group.text)) {
        if (group.best === null) { merged = true; break; }
        if (item.sourcePriority < group.best.sourcePriority) {
          group.best = item;
          group.text = itemText;
          group.hash = item.bodyHash || null;
        }
        merged = true;
        break;
      }
    }

    // If not matched by title, check description similarity against ALL groups
    if (!merged) {
      for (const group of groups) {
        const groupText = group.best
          ? `${group.best.title} ${group.best.description.slice(0, 200)}`
          : group.text;
        if (textsAreSimilar(itemText, groupText, 0.45)) {
          if (group.best === null) { merged = true; break; }
          if (item.sourcePriority < group.best.sourcePriority) {
            group.best = item;
            group.text = itemText;
            group.hash = item.bodyHash || null;
          }
          merged = true;
          break;
        }
      }
    }

    if (!merged) {
      groups.push({ text: itemText, hash: item.bodyHash || null, best: item });
    }
  }

  return groups.filter((g) => g.best !== null).map((g) => g.best!);
}

async function main() {
  // Safety: kill the whole script if it runs too long
  const killTimer = setTimeout(() => {
    console.error('\nScript timeout — force exiting.');
    process.exit(1);
  }, SCRIPT_TIMEOUT);
  killTimer.unref(); // Don't keep process alive just for this timer

  const config: FeedsConfig = JSON.parse(readFileSync(FEEDS_PATH, 'utf-8'));
  const processed: ProcessedUrls = JSON.parse(readFileSync(PROCESSED_PATH, 'utf-8'));

  const cutoffDate = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  const enabledFeeds = config.feeds.filter((f) => f.enabled);

  console.log(`Fetching ${enabledFeeds.length} feeds (articles from last ${MAX_AGE_DAYS} days only)...\n`);

  const allItems: RSSItem[] = [];

  // Fix #15: Load feed health for tracking
  let feedHealth: FeedHealthData;
  try {
    feedHealth = existsSync(FEED_HEALTH_PATH)
      ? JSON.parse(readFileSync(FEED_HEALTH_PATH, 'utf-8'))
      : createEmptyFeedHealth();
  } catch {
    feedHealth = createEmptyFeedHealth();
  }

  // Fetch all feeds concurrently (with individual timeouts)
  const results = await Promise.allSettled(
    enabledFeeds.map(async (feed) => {
      const items = await fetchFeed(feed, cutoffDate);
      return { feed, items };
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { feed, items } = result.value;
      if (items.length > 0) {
        console.log(`  OK   ${feed.name.padEnd(25)} ${items.length} items`);
        recordFeedSuccess(feedHealth, feed.id, feed.name);
      } else {
        // 0 items could be normal (no Epstein news) or a feed failure
        // Only record failure if this is unexpected (priority 1-2 feeds usually have content)
        if (feed.priority <= 2) {
          recordFeedFailure(feedHealth, feed.id, feed.name, 'returned 0 items');
        }
      }
      allItems.push(...items);
    } else {
      // Feed fetch threw an error
      const error = (result.reason as Error)?.message || 'unknown error';
      recordFeedFailure(feedHealth, (enabledFeeds[0] || {}).id || 'unknown', 'unknown', error);
    }
  }

  // Fix #1: Deduplicate by NORMALIZED URL (strips tracking params, trailing slashes)
  const seen = new Set(processed.processedUrls.map(normalizeUrl));
  const newItems = allItems.filter((item) => {
    if (!item.link) return false;
    const normalized = normalizeUrl(item.link);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });

  // Pre-filter by keywords
  const preFiltered = preFilterByKeywords(newItems, config.filterKeywords);

  // Deduplicate same-story from different outlets AND against existing site articles
  const existingTitles = loadExistingArticleTitles();
  const deduplicated = deduplicateByTitle(preFiltered, existingTitles);

  // Sort by recency — newest first
  deduplicated.sort((a, b) => {
    const dateA = new Date(a.pubDate).getTime() || 0;
    const dateB = new Date(b.pubDate).getTime() || 0;
    return dateB - dateA;
  });

  // Cap at max per run
  const candidates = deduplicated.slice(0, config.maxArticlesPerRun);

  console.log(`\n--- Pipeline Summary ---`);
  console.log(`Total fetched:     ${allItems.length}`);
  console.log(`New (unseen):      ${newItems.length}`);
  console.log(`Keyword matches:   ${preFiltered.length}`);
  console.log(`Existing articles: ${existingTitles.length}`);
  console.log(`After dedup:       ${deduplicated.length}`);
  console.log(`Candidates (cap):  ${candidates.length}`);

  if (candidates.length > 0) {
    console.log(`\nTop candidates (newest first):`);
    candidates.forEach((c, i) => {
      const age = Math.round((Date.now() - new Date(c.pubDate).getTime()) / 3600000);
      console.log(`  ${i + 1}. [${age}h ago] [${c.source}] ${c.title.slice(0, 70)}`);
    });
  }

  writeFileSync(CANDIDATES_PATH, JSON.stringify(candidates, null, 2));
  console.log(`\nWrote ${candidates.length} candidates.`);

  // Fix #15: Save feed health and warn about down feeds
  feedHealth.lastUpdated = new Date().toISOString();
  writeFileSync(FEED_HEALTH_PATH, JSON.stringify(feedHealth, null, 2));
  const downFeeds = getDownFeeds(feedHealth);
  if (downFeeds.length > 0) {
    console.log(`\n--- Feed Health Warnings ---`);
    for (const f of downFeeds) {
      console.log(`  DOWN: ${f.feedName} (${f.consecutiveFailures} failures) — ${f.lastError || 'unknown'}`);
    }
  }

  clearTimeout(killTimer);
}

main().catch(console.error);
