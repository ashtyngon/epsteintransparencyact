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
  noveltyStatement?: string;
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

// Known aggregator/syndication sources that repackage original reporting.
// When these appear as the RSS source, the AI must identify and credit the original reporter.
const AGGREGATOR_SOURCES = new Set([
  'yahoo', 'yahoo news', 'yahoo entertainment', 'yahoo finance',
  'msn', 'msn news', 'microsoft news',
  'aol', 'aol news',
  'newsbreak', 'smartnews', 'apple news',
  'google news', 'google',
  'flipboard',
  'unknown source',
]);

function isAggregatorSource(source: string): boolean {
  return AGGREGATOR_SOURCES.has(source.toLowerCase().trim());
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
    const files = readdirSync(ARTICLES_DIR)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .reverse()
      .slice(0, 15); // Only show 15 most recent to limit over-linking
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
  let prompt = GENERATE_PROMPT
    .replace('{title}', item.title)
    .replace('{content}', item.description)
    .replace('{source}', item.source)
    .replace('{sourceUrl}', item.link)
    .replace('{publishedAt}', item.pubDate)
    .replace('{existingArticles}', existingArticles);

  // When source is an aggregator, inject instruction to find the original reporter
  if (isAggregatorSource(item.source)) {
    prompt += `\n\n## CRITICAL: Aggregator Source — Find the Original Reporter\n\n"${item.source}" is a news AGGREGATOR, not an original reporting outlet. The actual reporting was done by a different publication. Examine the article content for phrases like "according to [outlet]", "first reported by", "originally published in", or byline credits. Your article MUST credit the ORIGINAL reporting outlet by name — not "${item.source}". Use "according to The New Republic" or "The Guardian reported" — never "according to Yahoo" or "according to a report." If you cannot identify the original source from the content, state the specific factual claims with "according to documents" or "according to FBI records" rather than attributing to the aggregator.`;
  }

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

  const sourceCount = (item.featureSources?.length || 0) + 1;
  const wordCountGuidance = sourceCount <= 2
    ? '500-800 words — this is a normal news article drawing from 2 sources, not a long-form feature. Write at standard article length.'
    : '1200-2000 words — this is a FEATURE with 3+ sources. Go deeper on the topic.';

  let prompt = FEATURE_PROMPT
    .replace('{sourceReports}', sourceReports)
    .replace('{existingArticles}', existingArticles)
    .replace(/1200-2000 words — this is a FEATURE, not a news brief/, wordCountGuidance);

  // Check if any source is an aggregator — warn the AI to find original reporters
  const allSources = [item, ...(item.featureSources || [])];
  const aggregatorSources = allSources.filter(s => isAggregatorSource(s.source));
  if (aggregatorSources.length > 0) {
    const names = [...new Set(aggregatorSources.map(s => s.source))].join(', ');
    prompt += `\n\n## CRITICAL: Aggregator Source(s) Detected — Find Original Reporters\n\nThe following source(s) are news AGGREGATORS, not original reporting outlets: ${names}. Examine each source's content for the ORIGINAL reporting outlet (e.g., "according to The New Republic", "first reported by The Guardian"). Your article MUST credit the original reporters by name — never attribute reporting to an aggregator like Yahoo or MSN.`;
  }

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

/**
 * When the RSS source is an aggregator (Yahoo, MSN, etc.), try to extract
 * the original reporting outlet from the article body. The AI was instructed
 * to credit the original reporter, so look for "according to [Outlet]" or
 * "[Outlet] reported" patterns in the first few paragraphs.
 */
function extractOriginalSource(body: string, rssSource: string): string {
  if (!isAggregatorSource(rssSource)) return rssSource;

  // Look in first ~600 chars for the original reporter attribution
  const leadText = body.slice(0, 600);

  // Common patterns: "The New Republic reported", "according to The Guardian",
  // "first reported by The Daily Beast", "[Outlet] first reported"
  const patterns = [
    /\*\*([A-Z][A-Za-z\s]+?)\*\*\s+(?:reported|first reported)/,
    /according to\s+\*\*([A-Z][A-Za-z\s]+?)\*\*/,
    /according to\s+([A-Z][A-Za-z\s]+?)(?:[.,;<]|\s+report)/,
    /([A-Z][A-Za-z\s]+?)\s+first reported/,
    /([A-Z][A-Za-z\s]+?)\s+reported\s+(?:that|on|this)/,
    /reported by\s+([A-Z][A-Za-z\s]+?)(?:[.,;<])/,
  ];

  for (const pattern of patterns) {
    const match = leadText.match(pattern);
    if (match && match[1]) {
      const outlet = match[1].trim();
      // Sanity check: must look like a publication name (2-5 words, not a person's name)
      if (outlet.length > 3 && outlet.length < 40 && !isAggregatorSource(outlet)) {
        return outlet;
      }
    }
  }

  // Fallback: check the References section for the first non-aggregator source
  const refMatch = body.match(/## References[\s\S]*?\[([A-Z][A-Za-z\s]+?)\s+[—–-]\s+/);
  if (refMatch && refMatch[1] && !isAggregatorSource(refMatch[1].trim())) {
    return refMatch[1].trim();
  }

  return rssSource; // Give up, keep original
}

function buildMarkdown(item: RelevantArticle, body: string): string {
  const fullDate = formatDateForFrontmatter(item.pubDate);
  const dateStr = formatDateForSlug(item.pubDate);

  // Use AI-suggested headline if available, otherwise original
  const headline = item.filterResult.suggestedHeadline || item.title;

  // If source is an aggregator, try to extract the real reporter from the article body
  const resolvedSource = extractOriginalSource(body, item.source);
  if (resolvedSource !== item.source) {
    console.log(`  SOURCE FIX: "${item.source}" → "${resolvedSource}" (aggregator resolved)`);
  }

  // Build a clean summary from the first ~160 chars of the body (for meta description)
  const bodyText = body
    .replace(/<sup>.*?<\/sup>/g, '')       // Strip <sup> footnote tags
    .replace(/<[^>]+>/g, '')               // Strip any remaining HTML tags
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // Convert [text](url) to just text
    .replace(/[#*\[\]()]/g, '')            // Strip remaining markdown chars
    .replace(/\*\*([^*]+)\*\*/g, '$1')     // Strip bold markers
    .replace(/\n+/g, ' ')
    .trim();
  // Cut at word boundary, max ~160 chars
  const rawSummary = bodyText.length <= 160
    ? bodyText
    : bodyText.slice(0, 160).replace(/\s+\S*$/, '');
  const summary = rawSummary.replace(/"/g, '\\"');

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
source: "${/google/i.test(resolvedSource) ? 'Unknown Source' : /[^\x00-\x7F]/.test(resolvedSource) ? 'Unknown Source' : resolvedSource}"
sourceUrl: "${item.link}"
summary: "${summary}"${imageLine}
people:
${people || '  []'}
tags:
${tags || '  []'}
status: published
aiGenerated: true
articleType: ${item.isFeature && (item.featureSources?.length || 0) >= 2 ? 'feature' : 'news'}
confidence: ${item.filterResult.confidence}
---

${body}
`;
}

function updateArticleTopics(newArticles: { slug: string; headline: string; summary: string; novelty: string; people: string[]; tags: string[] }[]) {
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
      novelty: article.novelty,
      topic: article.novelty || article.summary || article.headline,
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
  const newArticles: { slug: string; headline: string; summary: string; novelty: string; people: string[]; tags: string[] }[] = [];

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

    // Safety net: reject headlines with pipeline annotations that leaked through
    const leakedAnnotation = /\((?:Already Reported|Duplicate|Previously Covered|Not New|Roundup)\)/i;
    if (leakedAnnotation.test(headline)) {
      console.log(`  SKIP (leaked annotation in headline): ${headline.slice(0, 70)}`);
      processed.processedUrls.push(item.link);
      continue;
    }

    const sourceCount = (item.featureSources?.length || 0) + 1;
    if (item.isFeature) {
      console.log(`  MULTI-SOURCE (${sourceCount}): ${headline.slice(0, 70)}...`);
      item.featureSources?.forEach((fs, i) => {
        console.log(`    source ${i + 2}: ${fs.source} — ${fs.title.slice(0, 60)}`);
      });
    } else {
      console.log(`  Writing: ${headline.slice(0, 70)}...`);
    }

    const body = item.isFeature
      ? await generateFeatureArticle(client, item, existingArticles)
      : await generateArticleBody(client, item, existingArticles);
    if (!body) continue;

    // Enforce minimum word count — reject thin articles
    const wordCount = body.split(/\s+/).filter(w => w.length > 0).length;
    // 2-source merges target normal article length; 3+ sources are full features
    const minWords = (item.isFeature && sourceCount >= 3) ? 600 : 300;
    if (wordCount < minWords) {
      console.log(`  SKIP (too short: ${wordCount} words, min ${minWords}): ${headline.slice(0, 60)}`);
      processed.processedUrls.push(item.link);
      continue;
    }

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
      novelty: item.filterResult.noveltyStatement || articleSummary,
      people: item.filterResult.mentionedPeople || [],
      tags: item.filterResult.tags || [],
    });

    // Track processed URLs (including all merged sources)
    processed.processedUrls.push(item.link);
    if (item.featureSources) {
      for (const fs of item.featureSources) {
        processed.processedUrls.push(fs.link);
      }
    }
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
