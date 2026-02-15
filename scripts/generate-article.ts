import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { GENERATE_PROMPT, FEATURE_PROMPT } from './config/prompt-templates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RELEVANT_PATH = join(__dirname, 'config', 'relevant.json');
const PROCESSED_PATH = join(__dirname, 'config', 'processed-urls.json');
const TOPICS_PATH = join(__dirname, 'config', 'article-topics.json');
const ARTICLES_DIR = join(__dirname, '..', 'src', 'content', 'articles');

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

interface RelevantArticle {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  source: string;
  sourceId: string;
  sourcePriority: number;
  image?: string;
  filterResult: FilterResult;
  rankScore: number;
  isFeature?: boolean;
  featureSources?: RelevantArticle[];
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
  if (isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function formatDateForSlug(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toISOString().split('T')[0];
}

function loadExistingArticlesManifest(): string {
  try {
    const files = readdirSync(ARTICLES_DIR).filter((f) => f.endsWith('.md'));
    const entries: string[] = [];

    for (const file of files) {
      const slug = file.replace('.md', '');
      const content = readFileSync(join(ARTICLES_DIR, file), 'utf-8');
      const titleMatch = content.match(/^title:\s*"(.+?)"/m);
      const title = titleMatch ? titleMatch[1] : slug;
      entries.push(`- "${title}" → /news/${slug}`);
    }

    return entries.length > 0 ? entries.join('\n') : '(No existing articles yet)';
  } catch {
    return '(No existing articles yet)';
  }
}

async function generateArticleBody(
  client: Anthropic,
  item: RelevantArticle,
  existingArticles: string
): Promise<string | null> {
  const prompt = GENERATE_PROMPT
    .replace('{title}', item.title)
    .replace('{content}', item.description)
    .replace('{source}', item.source)
    .replace('{sourceUrl}', item.link)
    .replace('{publishedAt}', item.pubDate)
    .replace('{existingArticles}', existingArticles);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    const response = await client.messages.create(
      {
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: controller.signal as any }
    );

    clearTimeout(timeout);

    return response.content[0].type === 'text' ? response.content[0].text : null;
  } catch (error) {
    console.error(`  ERR: Failed to generate "${item.title.slice(0, 50)}": ${(error as Error).message?.slice(0, 60)}`);
    return null;
  }
}

async function generateFeatureArticle(
  client: Anthropic,
  item: RelevantArticle,
  existingArticles: string
): Promise<string | null> {
  const sourceReports = [item, ...(item.featureSources || [])].map((src, i) =>
    `### Source ${i + 1}: ${src.source}\nTitle: ${src.title}\nContent: ${src.description}\nURL: ${src.link}\nPublished: ${src.pubDate}`
  ).join('\n\n');

  const prompt = FEATURE_PROMPT
    .replace('{sourceReports}', sourceReports)
    .replace('{existingArticles}', existingArticles);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    const response = await client.messages.create(
      {
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: controller.signal as any }
    );

    clearTimeout(timeout);
    return response.content[0].type === 'text' ? response.content[0].text : null;
  } catch (error) {
    console.error(`  ERR: Failed to generate feature: ${(error as Error).message?.slice(0, 60)}`);
    return null;
  }
}

function buildMarkdown(item: RelevantArticle, body: string): string {
  const fullDate = formatDateForFrontmatter(item.pubDate);
  const dateStr = formatDateForSlug(item.pubDate);

  // Use AI-suggested headline if available, otherwise original
  const headline = item.filterResult.suggestedHeadline || item.title;

  // Build a clean summary from the first ~160 chars of the body (for meta description)
  const bodyText = body.replace(/[#*\[\]()]/g, '').replace(/\n+/g, ' ').trim();
  const summary = bodyText.slice(0, 160).replace(/"/g, '\\"');

  // Sanitize: filter out empty/non-string values from AI output
  const people = (item.filterResult.mentionedPeople || [])
    .filter((p) => typeof p === 'string' && p.trim().length > 0)
    .map((p) => `  - ${p.trim()}`)
    .join('\n');
  const tags = (item.filterResult.tags || [])
    .filter((t) => typeof t === 'string' && t.trim().length > 0)
    .map((t) => `  - ${t.trim()}`)
    .join('\n');

  const imageLine = item.image ? `\nimage: "${item.image}"` : '';

  return `---
title: "${headline.replace(/"/g, '\\"')}"
publishedAt: "${fullDate}"
source: "${/google/i.test(item.source) ? 'Unknown Source' : item.source}"
sourceUrl: "${item.link}"
summary: "${summary}"${imageLine}
people:
${people || '  []'}
tags:
${tags || '  []'}
status: published
aiGenerated: true
articleType: ${item.isFeature ? 'feature' : 'news'}
confidence: ${item.filterResult.confidence}
---

${body}
`;
}

function updateArticleTopics(newArticles: { slug: string; headline: string; summary: string; people: string[]; tags: string[] }[]) {
  let topics: any[] = [];
  try {
    if (existsSync(TOPICS_PATH)) {
      topics = JSON.parse(readFileSync(TOPICS_PATH, 'utf-8'));
    }
  } catch { /* start fresh */ }

  for (const article of newArticles) {
    // Don't add duplicates
    if (topics.some((t: any) => t.slug === article.slug)) continue;
    topics.push({
      slug: article.slug,
      title: article.headline,
      summary: article.summary,
      topic: article.summary || article.headline,
      people: article.people,
      tags: article.tags,
    });
  }

  writeFileSync(TOPICS_PATH, JSON.stringify(topics, null, 2));
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

  // Load existing articles so the writer can reference them
  const existingArticles = loadExistingArticlesManifest();
  console.log(`Generating ${relevant.length} articles with Claude Sonnet...\n`);

  let created = 0;
  const newArticles: { slug: string; headline: string; summary: string; people: string[]; tags: string[] }[] = [];

  for (const item of relevant) {
    const headline = item.filterResult.suggestedHeadline || item.title;
    const dateStr = formatDateForSlug(item.pubDate);
    const slug = `${dateStr}-${slugify(headline)}`;
    const filePath = join(ARTICLES_DIR, `${slug}.md`);

    if (existsSync(filePath)) {
      console.log(`  SKIP (exists): ${slug}`);
      processed.processedUrls.push(item.link);
      continue;
    }

    if (item.isFeature) {
      console.log(`  FEATURE: ${headline.slice(0, 70)} (${(item.featureSources?.length || 0) + 1} sources)...`);
    } else {
      console.log(`  Writing: ${headline.slice(0, 70)}...`);
    }

    const body = item.isFeature
      ? await generateFeatureArticle(client, item, existingArticles)
      : await generateArticleBody(client, item, existingArticles);
    if (!body) continue;

    if (item.image) console.log(`  IMAGE: ${item.image.slice(0, 60)}...`);

    const markdown = buildMarkdown(item, body);
    writeFileSync(filePath, markdown);
    console.log(`  CREATED: ${slug}`);
    created++;

    // Track for dedup record — extract summary from generated body
    const summaryMatch = body.match(/^(.{10,200}?)(?:\.\s|\n)/);
    const articleSummary = summaryMatch ? summaryMatch[1].trim() : headline;
    newArticles.push({
      slug,
      headline,
      summary: articleSummary,
      people: item.filterResult.mentionedPeople || [],
      tags: item.filterResult.tags || [],
    });

    // Track processed URL
    processed.processedUrls.push(item.link);
  }

  processed.lastRun = new Date().toISOString();
  writeFileSync(PROCESSED_PATH, JSON.stringify(processed, null, 2));

  // Update dedup record with new articles
  if (newArticles.length > 0) {
    updateArticleTopics(newArticles);
    console.log(`Updated article-topics.json with ${newArticles.length} new entries.`);
  }

  console.log(`\nDone. Created ${created} articles.`);
}

main().catch(console.error);
