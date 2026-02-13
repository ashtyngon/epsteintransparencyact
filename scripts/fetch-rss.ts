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
    const parser = new RSSParser();
    const parsed = await parser.parseURL(feed.url);

    return (parsed.items || []).map((item) => ({
      title: item.title || '',
      link: item.link || '',
      description: item.contentSnippet || item.content || '',
      pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
      source: feed.name,
      sourceId: feed.id,
    }));
  } catch (error) {
    console.error(`Failed to fetch feed ${feed.name}: ${error}`);
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

async function main() {
  const config: FeedsConfig = JSON.parse(readFileSync(FEEDS_PATH, 'utf-8'));
  const processed: ProcessedUrls = JSON.parse(readFileSync(PROCESSED_PATH, 'utf-8'));

  const enabledFeeds = config.feeds.filter((f) => f.enabled);
  console.log(`Fetching ${enabledFeeds.length} RSS feeds...`);

  const allItems: RSSItem[] = [];
  for (const feed of enabledFeeds) {
    const items = await fetchFeed(feed);
    console.log(`  ${feed.name}: ${items.length} items`);
    allItems.push(...items);
  }

  // Deduplicate by URL
  const seen = new Set(processed.processedUrls);
  const newItems = allItems.filter((item) => {
    if (!item.link || seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  });

  console.log(`\nTotal items: ${allItems.length}`);
  console.log(`New (not previously processed): ${newItems.length}`);

  // Pre-filter by keywords before sending to AI
  const preFiltered = preFilterByKeywords(newItems, config.filterKeywords);
  console.log(`Pre-filtered by keywords: ${preFiltered.length}`);

  // Cap at max per run
  const candidates = preFiltered.slice(0, config.maxArticlesPerRun);
  console.log(`Candidates for AI filtering: ${candidates.length}`);

  writeFileSync(CANDIDATES_PATH, JSON.stringify(candidates, null, 2));
  console.log(`\nWrote candidates to ${CANDIDATES_PATH}`);
}

main().catch(console.error);
