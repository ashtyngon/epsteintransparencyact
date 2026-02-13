import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { GENERATE_PROMPT } from './config/prompt-templates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RELEVANT_PATH = join(__dirname, 'config', 'relevant.json');
const PROCESSED_PATH = join(__dirname, 'config', 'processed-urls.json');
const ARTICLES_DIR = join(__dirname, '..', 'src', 'content', 'articles');

interface FilterResult {
  relevant: boolean;
  confidence: number;
  tags: string[];
  mentionedPeople: string[];
}

interface RelevantArticle {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  source: string;
  sourceId: string;
  filterResult: FilterResult;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

function formatDateForFrontmatter(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toISOString().split('T')[0];
}

async function generateArticleBody(
  client: Anthropic,
  item: RelevantArticle
): Promise<string | null> {
  const prompt = GENERATE_PROMPT
    .replace('{title}', item.title)
    .replace('{content}', item.description)
    .replace('{source}', item.source)
    .replace('{sourceUrl}', item.link)
    .replace('{publishedAt}', item.pubDate);

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    return response.content[0].type === 'text' ? response.content[0].text : null;
  } catch (error) {
    console.error(`Failed to generate article for "${item.title}": ${error}`);
    return null;
  }
}

function buildMarkdown(item: RelevantArticle, body: string): string {
  const dateStr = formatDateForFrontmatter(item.pubDate);
  const summary = item.description.slice(0, 200).replace(/"/g, '\\"');
  const people = item.filterResult.mentionedPeople
    .map((p) => `  - ${p}`)
    .join('\n');
  const tags = item.filterResult.tags
    .map((t) => `  - ${t}`)
    .join('\n');

  return `---
title: "${item.title.replace(/"/g, '\\"')}"
publishedAt: ${dateStr}
source: "${item.source}"
sourceUrl: "${item.link}"
summary: "${summary}"
people:
${people || '  []'}
tags:
${tags || '  []'}
status: published
aiGenerated: true
confidence: ${item.filterResult.confidence}
---

${body}
`;
}

async function main() {
  if (!existsSync(RELEVANT_PATH)) {
    console.log('No relevant articles file found. Run filter-articles.ts first.');
    return;
  }

  const relevant: RelevantArticle[] = JSON.parse(readFileSync(RELEVANT_PATH, 'utf-8'));
  if (relevant.length === 0) {
    console.log('No relevant articles to generate.');
    return;
  }

  const client = new Anthropic();
  const processed: { processedUrls: string[]; lastRun: string | null } = JSON.parse(
    readFileSync(PROCESSED_PATH, 'utf-8')
  );

  console.log(`Generating ${relevant.length} articles with Claude Sonnet...`);

  for (const item of relevant) {
    const body = await generateArticleBody(client, item);
    if (!body) continue;

    const dateStr = formatDateForFrontmatter(item.pubDate);
    const slug = `${dateStr}-${slugify(item.title)}`;
    const filePath = join(ARTICLES_DIR, `${slug}.md`);

    if (existsSync(filePath)) {
      console.log(`  SKIP (exists): ${slug}`);
      continue;
    }

    const markdown = buildMarkdown(item, body);
    writeFileSync(filePath, markdown);
    console.log(`  CREATED: ${slug}`);

    // Track processed URL
    processed.processedUrls.push(item.link);
  }

  processed.lastRun = new Date().toISOString();
  writeFileSync(PROCESSED_PATH, JSON.stringify(processed, null, 2));
  console.log(`\nDone. Updated processed URLs.`);
}

main().catch(console.error);
