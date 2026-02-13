import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import RSSParser from 'rss-parser';

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
}

interface ProcessedUrls {
  processedUrls: string[];
  lastRun: string | null;
}

const CANDIDATES_PATH = join(__dirname, 'config', 'candidates.json');
const PROCESSED_PATH = join(__dirname, 'config', 'processed-urls.json');
const FEEDS_PATH = join(__dirname, 'config', 'feeds.json');

const parser = new RSSParser({
  timeout: FEED_TIMEOUT,
  maxRedirects: 3,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)',
  },
});

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

        return {
          title: item.title || '',
          link: item.link || '',
          description: (item.contentSnippet || item.content || '').slice(0, 1000),
          pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
          source: feed.name,
          sourceId: feed.id,
          sourcePriority: feed.priority,
          image,
        };
      })
      // Drop articles older than cutoff
      .filter((item) => {
        const itemDate = new Date(item.pubDate);
        return !isNaN(itemDate.getTime()) && itemDate >= cutoffDate;
      });

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

function getSignificantWords(text: string): string[] {
  const stopWords = new Set([
    'that', 'this', 'with', 'from', 'have', 'been', 'were', 'their',
    'about', 'after', 'says', 'said', 'over', 'into', 'will', 'more',
    'than', 'also', 'just', 'back', 'when', 'what', 'could', 'would',
    'some', 'them', 'other', 'being', 'does', 'most', 'make', 'like',
    'report', 'reports', 'news', 'former', 'amid', 'ties', 'linked',
    'following', 'according',
  ]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 3 && !stopWords.has(w));
}

function titlesAreSimilar(a: string[], b: string[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = a.filter((w) => setB.has(w));
  const union = new Set([...setA, ...setB]);
  // Jaccard similarity — if 40%+ of significant words overlap, it's the same story
  return union.size > 0 && intersection.length / union.size >= 0.4;
}

function deduplicateByTitle(items: RSSItem[]): RSSItem[] {
  const groups: { words: string[]; best: RSSItem }[] = [];

  for (const item of items) {
    const words = getSignificantWords(item.title);
    let merged = false;

    for (const group of groups) {
      if (titlesAreSimilar(words, group.words)) {
        // Keep the one from the higher-priority source (lower number = higher priority)
        if (item.sourcePriority < group.best.sourcePriority) {
          group.best = item;
          group.words = words; // Use the better source's title words
        }
        merged = true;
        break;
      }
    }

    if (!merged) {
      groups.push({ words, best: item });
    }
  }

  return groups.map((g) => g.best);
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
      }
      allItems.push(...items);
    }
  }

  // Deduplicate by URL
  const seen = new Set(processed.processedUrls);
  const newItems = allItems.filter((item) => {
    if (!item.link || seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  });

  // Pre-filter by keywords
  const preFiltered = preFilterByKeywords(newItems, config.filterKeywords);

  // Deduplicate same-story from different outlets
  const deduplicated = deduplicateByTitle(preFiltered);

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

  clearTimeout(killTimer);
}

main().catch(console.error);
