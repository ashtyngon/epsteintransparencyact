import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { FILTER_PROMPT } from './config/prompt-templates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CANDIDATES_PATH = join(__dirname, 'config', 'candidates.json');
const RELEVANT_PATH = join(__dirname, 'config', 'relevant.json');
const TOPICS_PATH = join(__dirname, 'config', 'article-topics.json');

// Max articles to publish per run — with hourly runs, 3 is plenty
const MAX_ARTICLES_TO_PUBLISH = 3;

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
  isFeature?: boolean;
  featureSources?: RelevantArticle[];
}

interface FeatureCandidate {
  topic: string;
  articles: RelevantArticle[];
  combinedScore: number;
}

interface ArticleTopic {
  slug: string;
  title: string;
  topic: string;
  people: string[];
  tags: string[];
}

function loadExistingTopics(): string {
  try {
    if (!existsSync(TOPICS_PATH)) return '(No existing articles yet)';
    const topics: ArticleTopic[] = JSON.parse(readFileSync(TOPICS_PATH, 'utf-8'));
    return topics
      .map((t) => `- "${t.title}" — ${t.topic}`)
      .join('\n');
  } catch {
    return '(No existing articles yet)';
  }
}

function calculateRankScore(filter: FilterResult, item: RSSItem): number {
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

function detectFeatureCandidates(articles: RelevantArticle[]): FeatureCandidate[] {
  const clusters: { articles: RelevantArticle[] }[] = [];

  for (const article of articles) {
    const people = article.filterResult.mentionedPeople || [];
    const tags = article.filterResult.tags || [];
    const keyTerms = [...people, ...tags];

    let merged = false;
    for (const cluster of clusters) {
      const clusterTerms = new Set(
        cluster.articles.flatMap((a) => [
          ...(a.filterResult.mentionedPeople || []),
          ...(a.filterResult.tags || []),
        ])
      );
      const overlap = keyTerms.filter((t) => clusterTerms.has(t));
      if (overlap.length >= 2) {
        cluster.articles.push(article);
        merged = true;
        break;
      }
    }

    if (!merged) {
      clusters.push({ articles: [article] });
    }
  }

  // Only clusters with 3+ articles from 2+ sources warrant a feature
  return clusters
    .filter((c) => {
      const uniqueSources = new Set(c.articles.map((a) => a.sourceId));
      return c.articles.length >= 3 && uniqueSources.size >= 2;
    })
    .map((c) => ({
      topic: c.articles[0].filterResult.suggestedHeadline || c.articles[0].title,
      articles: c.articles.sort((a, b) => b.rankScore - a.rankScore),
      combinedScore: c.articles.reduce((sum, a) => sum + a.rankScore, 0),
    }))
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, 1); // At most 1 feature per run
}

async function filterArticle(
  client: Anthropic,
  item: RSSItem,
  existingTopics: string
): Promise<FilterResult | null> {
  const prompt = FILTER_PROMPT
    .replace('{title}', item.title)
    .replace('{description}', item.description)
    .replace('{source}', item.source)
    .replace('{publishedAt}', item.pubDate)
    .replace('{existingTopics}', existingTopics);

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
  const existingTopics = loadExistingTopics();

  console.log(`Filtering ${candidates.length} candidates with Claude Haiku...\n`);

  for (const item of candidates) {
    const result = await filterArticle(client, item, existingTopics);

    if (!result || !result.relevant || result.confidence < 0.7 || (result as any).isDuplicate) {
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

  // Detect feature article opportunities
  const featureCandidates = detectFeatureCandidates(scored);

  let topStories: RelevantArticle[];
  if (featureCandidates.length > 0) {
    const feature = featureCandidates[0];
    console.log(`\n  FEATURE DETECTED: ${feature.topic.slice(0, 70)} (${feature.articles.length} sources)`);

    // The best-scored article in the cluster becomes the feature
    const featureArticle = feature.articles[0];
    featureArticle.isFeature = true;
    featureArticle.featureSources = feature.articles.slice(1);

    // Remaining slots go to non-feature articles
    const nonFeatureArticles = scored.filter(
      (a) => !feature.articles.includes(a)
    );
    topStories = [featureArticle, ...nonFeatureArticles.slice(0, MAX_ARTICLES_TO_PUBLISH - 1)];
  } else {
    topStories = scored.slice(0, MAX_ARTICLES_TO_PUBLISH);
  }

  console.log(`\n--- Filter Results ---`);
  console.log(`Relevant found:    ${scored.length}`);
  console.log(`Publishing top:    ${topStories.length}`);

  if (topStories.length > 0) {
    console.log(`\nRanked stories to publish:`);
    topStories.forEach((s, i) => {
      const label = s.isFeature ? ' [FEATURE]' : '';
      console.log(`  ${i + 1}. [score=${s.rankScore}]${label} ${s.filterResult.suggestedHeadline || s.title.slice(0, 70)}`);
      console.log(`     news=${s.filterResult.newsworthiness} search=${s.filterResult.searchPotential} breaking=${s.filterResult.isBreaking}`);
    });
  }

  writeFileSync(RELEVANT_PATH, JSON.stringify(topStories, null, 2));
  console.log(`\nWrote ${topStories.length} stories to publish.`);
}

main().catch(console.error);
