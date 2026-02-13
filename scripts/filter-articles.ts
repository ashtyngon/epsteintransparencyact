import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { FILTER_PROMPT } from './config/prompt-templates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CANDIDATES_PATH = join(__dirname, 'config', 'candidates.json');
const RELEVANT_PATH = join(__dirname, 'config', 'relevant.json');

interface RSSItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  source: string;
  sourceId: string;
}

interface FilterResult {
  relevant: boolean;
  confidence: number;
  tags: string[];
  mentionedPeople: string[];
}

interface RelevantArticle extends RSSItem {
  filterResult: FilterResult;
}

async function filterArticle(
  client: Anthropic,
  item: RSSItem
): Promise<FilterResult | null> {
  const prompt = FILTER_PROMPT
    .replace('{title}', item.title)
    .replace('{description}', item.description)
    .replace('{source}', item.source);

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return JSON.parse(text) as FilterResult;
  } catch (error) {
    console.error(`Failed to filter article "${item.title}": ${error}`);
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
  const relevant: RelevantArticle[] = [];

  console.log(`Filtering ${candidates.length} candidates with Claude Haiku...`);

  for (const item of candidates) {
    const result = await filterArticle(client, item);
    if (result && result.relevant && result.confidence > 0.7) {
      console.log(`  RELEVANT (${result.confidence}): ${item.title}`);
      relevant.push({ ...item, filterResult: result });
    } else {
      const conf = result?.confidence ?? 'N/A';
      console.log(`  SKIPPED (${conf}): ${item.title}`);
    }
  }

  console.log(`\n${relevant.length} relevant articles found.`);
  writeFileSync(RELEVANT_PATH, JSON.stringify(relevant, null, 2));
  console.log(`Wrote relevant articles to ${RELEVANT_PATH}`);
}

main().catch(console.error);
