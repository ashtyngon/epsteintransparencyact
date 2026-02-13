import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
}

interface ProcessedUrls {
  processedUrls: string[];
  lastRun: string | null;
}

const CANDIDATES_PATH = join(__dirname, 'config', 'candidates.json');
const PROCESSED_PATH = join(__dirname, 'config', 'processed-urls.json');
const FEEDS_PATH = join(__dirname, 'config', 'feeds.json');

async function fetchFeed(feed: FeedConfig): Promise<RSSItem[]> {
  try {
    const RSSParser = (await import('rss-parser')).default;
    const parser = new RSSParser({
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; EpsteinTransparencyBot/1.0)',
      },
    });
    const parsed = await parser.parseURL(feed.url);

    return (parsed.items || []).map((item) => ({
      title: item.title || '',
      link: item.link || '',
      description: item.contentSnippet || item.content || '',
      pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
      source: feed.name,
      sourceId: feed.id,
      sourcePriority: feed.priority,
    }));
  } catch (error) {
    console.error(`  WARN: Failed to fetch ${feed.name}: ${(error as Error).message?.slice(0, 60)}`);
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

function deduplicateByTitle(items: RSSItem[]): RSSItem[] {
  // Remove near-duplicate stories (same event reported by multiple outlets)
  // Keep the one from the highest-priority source
  const seen = new Map<string, RSSItem>();

  for (const item of items) {
    // Normalize title for comparison: lowercase, strip punctuation, collapse whitespace
    const normalized = item.title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Extract key words (skip common words) to detect same-story variants
    const keyWords = normalized
      .split(' ')
      .filter((w) => w.length > 3 && !['that', 'this', 'with', 'from', 'have', 'been', 'were', 'their', 'about', 'after', 'says', 'said'].includes(w));

    const signature = keyWords.slice(0, 6).sort().join('|');

    if (!seen.has(signature)) {
      seen.set(signature, item);
    } else {
      // Keep higher-priority source (lower number = higher priority)
      const existing = seen.get(signature)!;
      if (item.sourcePriority < existing.sourcePriority) {
        seen.set(signature, item);
      }
    }
  }

  return [...seen.values()];
}

async function main() {
  const config: FeedsConfig = JSON.parse(readFileSync(FEEDS_PATH, 'utf-8'));
  const processed: ProcessedUrls = JSON.parse(readFileSync(PROCESSED_PATH, 'utf-8'));

  const enabledFeeds = config.feeds.filter((f) => f.enabled);
  console.log(`Fetching ${enabledFeeds.length} RSS feeds...\n`);

  const allItems: RSSItem[] = [];
  for (const feed of enabledFeeds) {
    const items = await fetchFeed(feed);
    if (items.length > 0) {
      console.log(`  OK   ${feed.name}: ${items.length} items`);
    }
    allItems.push(...items);
  }

  // Deduplicate by URL (already processed)
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
      console.log(`  ${i + 1}. [${age}h ago] [${c.source}] ${c.title}`);
    });
  }

  writeFileSync(CANDIDATES_PATH, JSON.stringify(candidates, null, 2));
  console.log(`\nWrote ${candidates.length} candidates.`);
}

main().catch(console.error);
