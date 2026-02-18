import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { FILTER_PROMPT } from './config/prompt-templates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CANDIDATES_PATH = join(__dirname, 'config', 'candidates.json');
const RELEVANT_PATH = join(__dirname, 'config', 'relevant.json');
const TOPICS_PATH = join(__dirname, 'config', 'article-topics.json');
const ARTICLES_DIR = join(__dirname, '..', 'src', 'content', 'articles');

// Max articles to publish per run — with hourly runs, 3 is plenty
const MAX_ARTICLES_TO_PUBLISH = 3;

// Dedup thresholds
const HEADLINE_SIMILARITY_THRESHOLD = 0.35; // Jaccard on significant words
const PEOPLE_OVERLAP_FOR_DEDUP = 2; // Need 2+ shared people AND 1+ shared tag

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
  noveltyStatement: string;
  isDuplicate?: boolean;
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
  summary?: string;
  topic: string;
  people: string[];
  tags: string[];
}

interface ExistingArticle {
  slug: string;
  title: string;
  summary: string;
  novelty: string; // What specific new thing this article reported
  people: string[];
  tags: string[];
}

// ──────────────────────────────────────────────────
// Text similarity utilities (shared with fetch-rss)
// ──────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'that', 'this', 'with', 'from', 'have', 'been', 'were', 'their',
  'about', 'after', 'says', 'said', 'over', 'into', 'will', 'more',
  'than', 'also', 'just', 'back', 'when', 'what', 'could', 'would',
  'some', 'them', 'other', 'being', 'does', 'most', 'make', 'like',
  'report', 'reports', 'news', 'former', 'amid', 'ties', 'linked',
  'following', 'according', 'epstein', 'jeffrey', 'files', 'case',
]);

function getSignificantWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
}

function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = a.filter((w) => setB.has(w));
  const union = new Set([...setA, ...setB]);
  return union.size > 0 ? intersection.length / union.size : 0;
}

// ──────────────────────────────────────────────────
// Load existing articles for dedup comparison
// ──────────────────────────────────────────────────

function loadExistingArticles(): ExistingArticle[] {
  const articles: ExistingArticle[] = [];

  // Load from article-topics.json (pipeline's own record)
  try {
    if (existsSync(TOPICS_PATH)) {
      const topics: ArticleTopic[] = JSON.parse(readFileSync(TOPICS_PATH, 'utf-8'));
      for (const t of topics) {
        articles.push({
          slug: t.slug,
          title: t.title,
          summary: t.summary || t.topic || '',
          novelty: (t as any).novelty || t.summary || t.topic || '',
          people: t.people || [],
          tags: t.tags || [],
        });
      }
    }
  } catch { /* continue without topics */ }

  // Also scan actual article files to catch any not in topics file
  try {
    const files = readdirSync(ARTICLES_DIR).filter((f) => f.endsWith('.md'));
    const knownSlugs = new Set(articles.map((a) => a.slug));

    for (const file of files) {
      const slug = file.replace('.md', '');
      if (knownSlugs.has(slug)) continue; // Already have it from topics

      const content = readFileSync(join(ARTICLES_DIR, file), 'utf-8');
      const titleMatch = content.match(/^title:\s*"(.+?)"/m);
      const summaryMatch = content.match(/^summary:\s*"(.+?)"/m);

      // Parse people array from frontmatter
      const peopleSection = content.match(/^people:\n((?:\s+-\s+.+\n)*)/m);
      const people = peopleSection
        ? peopleSection[1].match(/^\s+-\s+(.+)/gm)?.map((l) => l.replace(/^\s+-\s+/, '').trim()) || []
        : [];

      // Parse tags array from frontmatter
      const tagsSection = content.match(/^tags:\n((?:\s+-\s+.+\n)*)/m);
      const tags = tagsSection
        ? tagsSection[1].match(/^\s+-\s+(.+)/gm)?.map((l) => l.replace(/^\s+-\s+/, '').trim()) || []
        : [];

      if (titleMatch) {
        articles.push({
          slug,
          title: titleMatch[1],
          summary: summaryMatch?.[1] || '',
          novelty: summaryMatch?.[1] || titleMatch[1], // Fallback for articles without novelty field
          people,
          tags,
        });
      }
    }
  } catch { /* continue without filesystem scan */ }

  return articles;
}

function loadExistingTopicsForPrompt(articles: ExistingArticle[]): string {
  if (articles.length === 0) return '(No existing articles yet)';
  // Only show the 25 most recent articles to avoid overwhelming the AI
  // Sort by slug (which starts with date) descending
  const recent = [...articles]
    .sort((a, b) => b.slug.localeCompare(a.slug))
    .slice(0, 25);
  return recent
    .map((a) => {
      const people = a.people.slice(0, 4).join(', ');
      const novelty = a.novelty || a.summary;
      return `- "${a.title}" [${people}] → NEW: ${novelty.slice(0, 120)}`;
    })
    .join('\n');
}

// ──────────────────────────────────────────────────
// HARD DEDUP GATE — programmatic similarity check
// Runs AFTER AI scoring, catches what the AI misses
// ──────────────────────────────────────────────────

interface DedupResult {
  isDuplicate: boolean;
  matchedSlug?: string;
  matchedTitle?: string;
  reason?: string;
  headlineSimilarity?: number;
  peopleOverlap?: number;
  tagOverlap?: number;
}

function hardDedupCheck(
  candidate: RelevantArticle,
  existingArticles: ExistingArticle[]
): DedupResult {
  const candidateHeadline = candidate.filterResult.suggestedHeadline || candidate.title;
  const candidateNovelty = candidate.filterResult.noveltyStatement || '';
  const candidateWords = getSignificantWords(candidateHeadline);
  const candidateNoveltyWords = getSignificantWords(candidateNovelty);
  const candidateDescWords = getSignificantWords(`${candidateHeadline} ${candidate.description.slice(0, 200)}`);
  const candidatePeople = new Set(candidate.filterResult.mentionedPeople || []);
  const candidateTags = new Set(candidate.filterResult.tags || []);

  // PRIMARY CHECK: If the AI already flagged it as duplicate via novelty
  if (candidateNovelty.toUpperCase().startsWith('DUPLICATE:')) {
    return {
      isDuplicate: true,
      reason: `ai_novelty_dup: ${candidateNovelty.slice(0, 80)}`,
    };
  }

  for (const existing of existingArticles) {
    const existingWords = getSignificantWords(existing.title);
    const existingNoveltyWords = getSignificantWords(existing.novelty || existing.summary);
    const existingFullWords = getSignificantWords(`${existing.title} ${existing.summary.slice(0, 200)}`);
    const existingPeople = new Set(existing.people || []);
    const existingTags = new Set(existing.tags || []);

    // People & tag overlap (used in multiple rules)
    const peopleOverlap = [...candidatePeople].filter((p) => existingPeople.has(p)).length;
    const tagOverlap = [...candidateTags].filter((t) => existingTags.has(t)).length;

    // ── PRIMARY: Novelty statement similarity ──
    // This is the most important check — "what's new" should be different
    const noveltySim = jaccardSimilarity(candidateNoveltyWords, existingNoveltyWords);
    if (noveltySim >= 0.60) {
      return {
        isDuplicate: true,
        matchedSlug: existing.slug,
        matchedTitle: existing.title,
        reason: `novelty_sim=${noveltySim.toFixed(2)}`,
        headlineSimilarity: jaccardSimilarity(candidateWords, existingWords),
        peopleOverlap,
        tagOverlap,
      };
    }

    // Novelty overlap + same people = almost certainly same story
    if (noveltySim >= 0.50 && peopleOverlap >= 2) {
      return {
        isDuplicate: true,
        matchedSlug: existing.slug,
        matchedTitle: existing.title,
        reason: `novelty_sim=${noveltySim.toFixed(2)}+people=${peopleOverlap}`,
        headlineSimilarity: jaccardSimilarity(candidateWords, existingWords),
        peopleOverlap,
        tagOverlap,
      };
    }

    // ── SECONDARY: Headline similarity ──
    const headlineSim = jaccardSimilarity(candidateWords, existingWords);

    // Very high headline similarity alone = duplicate
    if (headlineSim >= 0.50) {
      return {
        isDuplicate: true,
        matchedSlug: existing.slug,
        matchedTitle: existing.title,
        reason: `headline_sim=${headlineSim.toFixed(2)}`,
        headlineSimilarity: headlineSim,
        peopleOverlap,
        tagOverlap,
      };
    }

    // ── TERTIARY: Full text + people combo ──
    const fullTextSim = jaccardSimilarity(candidateDescWords, existingFullWords);
    if (fullTextSim >= 0.55 && peopleOverlap >= 2) {
      return {
        isDuplicate: true,
        matchedSlug: existing.slug,
        matchedTitle: existing.title,
        reason: `text_sim=${fullTextSim.toFixed(2)}+people=${peopleOverlap}`,
        headlineSimilarity: headlineSim,
        peopleOverlap,
        tagOverlap,
      };
    }
  }

  return { isDuplicate: false };
}

// Also dedup candidates against EACH OTHER in the same batch
function dedupWithinBatch(articles: RelevantArticle[]): RelevantArticle[] {
  const kept: RelevantArticle[] = [];

  for (const article of articles) {
    const headline = article.filterResult.suggestedHeadline || article.title;
    const words = getSignificantWords(headline);
    const people = new Set(article.filterResult.mentionedPeople || []);

    let isDup = false;
    for (const existing of kept) {
      const existingHeadline = existing.filterResult.suggestedHeadline || existing.title;
      const existingWords = getSignificantWords(existingHeadline);
      const existingPeople = new Set(existing.filterResult.mentionedPeople || []);

      const sim = jaccardSimilarity(words, existingWords);
      const peopleOverlap = [...people].filter((p) => existingPeople.has(p)).length;

      if (sim >= 0.4 || (sim >= 0.3 && peopleOverlap >= 2)) {
        console.log(`  DEDUP (batch): "${headline.slice(0, 50)}" ≈ "${existingHeadline.slice(0, 50)}" (sim=${sim.toFixed(2)}, people=${peopleOverlap})`);
        isDup = true;
        break;
      }
    }

    if (!isDup) {
      kept.push(article);
    }
  }

  return kept;
}

// ──────────────────────────────────────────────────
// Scoring & feature detection
// ──────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────
// AI filter
// ──────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────
// Main pipeline
// ──────────────────────────────────────────────────

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

  // ── Step 1: Load all existing articles for dedup ──
  const existingArticles = loadExistingArticles();
  console.log(`Loaded ${existingArticles.length} existing articles for dedup comparison.\n`);

  const existingTopics = loadExistingTopicsForPrompt(existingArticles);
  const client = new Anthropic();
  const scored: RelevantArticle[] = [];

  console.log(`Filtering ${candidates.length} candidates with Claude Haiku...\n`);

  // ── Step 2: AI filter each candidate ──
  for (const item of candidates) {
    const result = await filterArticle(client, item, existingTopics);

    if (!result || !result.relevant || result.confidence < 0.7) {
      const isDup = result?.isDuplicate === true;
      const reason = !result ? 'no-result' : isDup ? 'duplicate' : (!result.relevant ? 'irrelevant' : 'low-conf');
      const conf = result?.confidence ?? 'N/A';
      console.log(`  SKIP (conf=${conf}, reason=${reason}): ${item.title.slice(0, 70)}`);
      continue;
    }

    // AI duplicate judgment logged but NOT used to reject — hard dedup gate decides
    if (result.isDuplicate) {
      console.log(`  AI says dup (ignored, hard dedup decides): ${item.title.slice(0, 60)}`);
      console.log(`    novelty: ${result.noveltyStatement?.slice(0, 80) || 'N/A'}`);
    }

    // HARD GUARD: Too many people = roundup article, reject
    const MAX_PEOPLE_FILTER = 8;
    if ((result.mentionedPeople || []).length > MAX_PEOPLE_FILTER) {
      console.log(`  SKIP (roundup: ${result.mentionedPeople.length} people): ${item.title.slice(0, 60)}`);
      continue;
    }

    const rankScore = calculateRankScore(result, item);
    const recencyHours = Math.round((Date.now() - new Date(item.pubDate).getTime()) / 3600000);

    console.log(`  PASS (score=${rankScore}, news=${result.newsworthiness}, search=${result.searchPotential}, ${recencyHours}h ago)${result.isBreaking ? ' BREAKING' : ''}`);
    console.log(`        ${result.suggestedHeadline || item.title.slice(0, 70)}`);

    scored.push({ ...item, filterResult: result, rankScore });
  }

  // ── Step 3: Hard dedup gate — programmatic check against existing articles ──
  console.log(`\n--- Hard Dedup Gate ---`);
  const afterDedup: RelevantArticle[] = [];

  for (const article of scored) {
    const headline = article.filterResult.suggestedHeadline || article.title;
    const check = hardDedupCheck(article, existingArticles);

    if (check.isDuplicate) {
      console.log(`  DEDUP BLOCKED: "${headline.slice(0, 55)}"`);
      console.log(`    ≈ "${check.matchedTitle?.slice(0, 55)}" (${check.reason})`);
    } else {
      afterDedup.push(article);
    }
  }

  // ── Step 4: Dedup within batch (catches same story from different sources) ──
  const dedupedBatch = dedupWithinBatch(afterDedup);

  console.log(`\nAfter hard dedup: ${scored.length} → ${afterDedup.length} → ${dedupedBatch.length} (AI pass → dedup vs existing → dedup within batch)`);

  // Sort by rank score — best stories first
  dedupedBatch.sort((a, b) => b.rankScore - a.rankScore);

  // ── Step 5: Detect feature article opportunities ──
  const featureCandidates = detectFeatureCandidates(dedupedBatch);

  let topStories: RelevantArticle[];
  if (featureCandidates.length > 0) {
    const feature = featureCandidates[0];
    console.log(`\n  FEATURE DETECTED: ${feature.topic.slice(0, 70)} (${feature.articles.length} sources)`);

    // The best-scored article in the cluster becomes the feature
    const featureArticle = feature.articles[0];
    featureArticle.isFeature = true;
    featureArticle.featureSources = feature.articles.slice(1);

    // Remaining slots go to non-feature articles
    const nonFeatureArticles = dedupedBatch.filter(
      (a) => !feature.articles.includes(a)
    );
    topStories = [featureArticle, ...nonFeatureArticles.slice(0, MAX_ARTICLES_TO_PUBLISH - 1)];
  } else {
    topStories = dedupedBatch.slice(0, MAX_ARTICLES_TO_PUBLISH);
  }

  console.log(`\n--- Filter Results ---`);
  console.log(`Candidates:        ${candidates.length}`);
  console.log(`AI passed:         ${scored.length}`);
  console.log(`After dedup:       ${dedupedBatch.length}`);
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
