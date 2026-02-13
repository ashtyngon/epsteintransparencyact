import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { FILTER_PROMPT } from './config/prompt-templates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CANDIDATES_PATH = join(__dirname, 'config', 'candidates.json');
const RELEVANT_PATH = join(__dirname, 'config', 'relevant.json');

// Max articles to publish per run — only the top-ranked make it through
const MAX_ARTICLES_TO_PUBLISH = 5;

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

interface FilterResult {
  relevant: boolean;
  confidence: number;
  newsworthiness: number;
  isBreaking: boolean;
  searchPotential: number;
  tags: string[];
  mentionedPeople: string[];
  suggestedHeadline: string;
}

interface RelevantArticle extends RSSItem {
  filterResult: FilterResult;
  rankScore: number;
}

function calculateRankScore(filter: FilterResult, item: RSSItem): number {
  // Weighted ranking formula:
  // - Newsworthiness: 35% (will people care?)
  // - Search potential: 25% (will people find it?)
  // - Confidence: 15% (is it genuinely relevant?)
  // - Recency bonus: 15% (how fresh is it?)
  // - Breaking bonus: 10% (is it happening now?)

  const recencyHours = (Date.now() - new Date(item.pubDate).getTime()) / 3600000;
  const recencyScore = Math.max(0, 10 - recencyHours / 2.4); // 10 at 0h, 0 at 24h

  const breakingBonus = filter.isBreaking ? 10 : 0;

  const score =
    filter.newsworthiness * 3.5 +
    filter.searchPotential * 2.5 +
    filter.confidence * 15 +
    recencyScore * 1.5 +
    breakingBonus * 1.0;

  return Math.round(score * 10) / 10;
}

async function filterArticle(
  client: Anthropic,
  item: RSSItem
): Promise<FilterResult | null> {
  const prompt = FILTER_PROMPT
    .replace('{title}', item.title)
    .replace('{description}', item.description)
    .replace('{source}', item.source)
    .replace('{publishedAt}', item.pubDate);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await client.messages.create(
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: controller.signal as any }
    );

    clearTimeout(timeout);

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    // Extract JSON from response (handle possible markdown wrapping)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]) as FilterResult;
  } catch (error) {
    console.error(`  ERR: Failed to filter "${item.title.slice(0, 50)}": ${(error as Error).message?.slice(0, 60)}`);
    return null;
  }
}

async function main() {
  if (!existsSync(CANDIDATES_PATH)) {
    console.log('No candidates file found. Run fetch-rss.ts first.');
    return;
  }

  const candidates: RSSItem[] = JSON.parse(readFileSync(CANDIDATES_PATH, 'utf-8'));
  if (candidates.length === 0) {
    console.log('No candidates to filter.');
    writeFileSync(RELEVANT_PATH, JSON.stringify([], null, 2));
    return;
  }

  const client = new Anthropic();
  const scored: RelevantArticle[] = [];

  console.log(`Filtering ${candidates.length} candidates with Claude Haiku...\n`);

  for (const item of candidates) {
    const result = await filterArticle(client, item);

    if (!result || !result.relevant || result.confidence < 0.7) {
      const conf = result?.confidence ?? 'N/A';
      console.log(`  SKIP (conf=${conf}): ${item.title.slice(0, 70)}`);
      continue;
    }

    const rankScore = calculateRankScore(result, item);
    const recencyHours = Math.round((Date.now() - new Date(item.pubDate).getTime()) / 3600000);

    console.log(`  PASS (score=${rankScore}, news=${result.newsworthiness}, search=${result.searchPotential}, ${recencyHours}h ago)${result.isBreaking ? ' BREAKING' : ''}`);
    console.log(`        ${result.suggestedHeadline || item.title.slice(0, 70)}`);

    scored.push({ ...item, filterResult: result, rankScore });
  }

  // Sort by rank score — best stories first
  scored.sort((a, b) => b.rankScore - a.rankScore);

  // Take only the top stories
  const topStories = scored.slice(0, MAX_ARTICLES_TO_PUBLISH);

  console.log(`\n--- Filter Results ---`);
  console.log(`Relevant found:    ${scored.length}`);
  console.log(`Publishing top:    ${topStories.length}`);

  if (topStories.length > 0) {
    console.log(`\nRanked stories to publish:`);
    topStories.forEach((s, i) => {
      console.log(`  ${i + 1}. [score=${s.rankScore}] ${s.filterResult.suggestedHeadline || s.title.slice(0, 70)}`);
      console.log(`     news=${s.filterResult.newsworthiness} search=${s.filterResult.searchPotential} breaking=${s.filterResult.isBreaking}`);
    });
  }

  writeFileSync(RELEVANT_PATH, JSON.stringify(topStories, null, 2));
  console.log(`\nWrote ${topStories.length} stories to publish.`);
}

main().catch(console.error);
