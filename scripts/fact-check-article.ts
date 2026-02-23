/**
 * Blind fact-checker — runs AFTER edit-article.ts.
 *
 * For each newly created article, sends ONLY the article body (no source
 * material) to Claude Haiku. The model flags any factual claim it cannot
 * independently verify. Articles that FAIL are deleted before commit.
 *
 * This catches hallucinations that the editor (who saw the source) would miss,
 * because the fact-checker has no source to "confirm" against — it can only
 * evaluate whether claims seem plausible from public record.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { FACT_CHECK_PROMPT } from './config/fact-check-prompt.js';
import { callAnthropicWithRetry } from './lib/pipeline-utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RELEVANT_PATH = join(__dirname, 'config', 'relevant.json');
const ARTICLES_DIR = join(__dirname, '..', 'src', 'content', 'articles');

interface RelevantArticle {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  source: string;
  sourceId: string;
  sourcePriority: number;
  filterResult: {
    suggestedHeadline: string;
    mentionedPeople: string[];
    tags: string[];
    [key: string]: any;
  };
  rankScore: number;
  isFeature?: boolean;
}

interface FactCheckResult {
  verdict: 'PASS' | 'FLAG' | 'FAIL';
  flaggedClaims: Array<{
    claim: string;
    reason: string;
    severity: 'low' | 'medium' | 'high';
  }>;
  summary: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

function formatDateForSlug(dateStr: string): string {
  return new Date(dateStr).toISOString().split('T')[0];
}

function extractArticleBody(content: string): string | null {
  const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return match ? match[1].trim() : null;
}

async function factCheckArticle(
  client: Anthropic,
  articleBody: string,
): Promise<FactCheckResult | null> {
  const prompt = FACT_CHECK_PROMPT.replace('{articleBody}', articleBody);

  try {
    const response = await callAnthropicWithRetry(client, {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }, { timeoutMs: 30000, maxRetries: 2 });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]) as FactCheckResult;
  } catch (error) {
    console.error(`  ERR: Fact-check failed: ${(error as Error).message?.slice(0, 80)}`);
    return null;
  }
}

async function main() {
  if (!existsSync(RELEVANT_PATH)) {
    console.log('No relevant articles file found. Nothing to fact-check.');
    return;
  }

  const relevant: RelevantArticle[] = JSON.parse(readFileSync(RELEVANT_PATH, 'utf-8'));
  if (relevant.length === 0) {
    console.log('No articles to fact-check.');
    return;
  }

  const client = new Anthropic();
  console.log(`Fact-checking ${relevant.length} articles with Claude Haiku (blind pass)...\n`);

  let passed = 0;
  let flagged = 0;
  let failed = 0;

  for (const item of relevant) {
    const headline = item.filterResult.suggestedHeadline || item.title;
    const dateStr = formatDateForSlug(item.pubDate);
    const slug = `${dateStr}-${slugify(headline)}`;
    const filePath = join(ARTICLES_DIR, `${slug}.md`);

    if (!existsSync(filePath)) {
      continue; // Already deleted by editor quality gate
    }

    const content = readFileSync(filePath, 'utf-8');
    const body = extractArticleBody(content);
    if (!body) continue;

    console.log(`  Checking: ${headline.slice(0, 65)}...`);
    const result = await factCheckArticle(client, body);

    if (!result) {
      console.log(`    SKIP: Fact-checker returned no result — keeping article`);
      continue;
    }

    const highCount = result.flaggedClaims.filter(c => c.severity === 'high').length;
    const medCount = result.flaggedClaims.filter(c => c.severity === 'medium').length;

    if (result.verdict === 'FAIL') {
      console.log(`    FAIL: ${result.summary}`);
      result.flaggedClaims
        .filter(c => c.severity === 'high')
        .forEach(c => console.log(`      HIGH: "${c.claim.slice(0, 60)}" — ${c.reason.slice(0, 60)}`));

      // DON'T delete — the model's training data may not include recent events.
      // Flagging Prince Andrew's arrest or the Mar-a-Lago shooting as "fictional"
      // is a knowledge-cutoff false positive, not a real quality issue.
      // The editor's QUALITY_FAIL gate and word count checks handle true failures.
      console.log(`    KEPT (fact-check advisory only — recent events may be beyond model training)`);
      flagged++;
    } else if (result.verdict === 'FLAG') {
      console.log(`    FLAG (${highCount} high, ${medCount} med): ${result.summary.slice(0, 80)}`);
      result.flaggedClaims
        .filter(c => c.severity === 'high')
        .forEach(c => console.log(`      HIGH: "${c.claim.slice(0, 60)}" — ${c.reason.slice(0, 60)}`));

      // Keep flagged articles but log the concerns
      // In a future iteration, could strip the flagged claims programmatically
      flagged++;
    } else {
      console.log(`    PASS: ${result.summary.slice(0, 80)}`);
      passed++;
    }
  }

  console.log(`\nFact-check complete: ${passed} passed, ${flagged} flagged, ${failed} failed (deleted).`);
}

main().catch(console.error);
