import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { EDITOR_PROMPT } from './config/prompt-templates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RELEVANT_PATH = join(__dirname, 'config', 'relevant.json');
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

// Known aggregator sources — same list as generate-article.ts
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

/**
 * If the frontmatter source is an aggregator, try to extract the real reporter
 * from the article body (which the editor should have fixed to credit properly).
 */
function fixFrontmatterSource(frontmatter: string, body: string): string {
  const sourceMatch = frontmatter.match(/^source:\s*"(.+?)"/m);
  if (!sourceMatch) return frontmatter;

  const currentSource = sourceMatch[1];
  if (!isAggregatorSource(currentSource)) return frontmatter;

  // Look for the real source in the article body
  const leadText = body.slice(0, 600);
  const patterns = [
    /\*\*([A-Z][A-Za-z\s]+?)\*\*\s+(?:reported|first reported)/,
    /according to\s+\*\*([A-Z][A-Za-z\s]+?)\*\*/,
    /according to\s+([A-Z][A-Za-z\s]+?)(?:[.,;<]|\s+report)/,
    /([A-Z][A-Za-z\s]+?)\s+first reported/,
    /([A-Z][A-Za-z\s]+?)\s+reported\s+(?:that|on|this)/,
  ];

  for (const pattern of patterns) {
    const match = leadText.match(pattern);
    if (match && match[1]) {
      const outlet = match[1].trim();
      if (outlet.length > 3 && outlet.length < 40 && !isAggregatorSource(outlet)) {
        console.log(`  SOURCE FIX (editor): "${currentSource}" → "${outlet}"`);
        return frontmatter.replace(
          /^source:\s*".+?"/m,
          `source: "${outlet}"`
        );
      }
    }
  }

  // Also check References section
  const refMatch = body.match(/## References[\s\S]*?\[([A-Z][A-Za-z\s]+?)\s+[—–-]\s+/);
  if (refMatch && refMatch[1] && !isAggregatorSource(refMatch[1].trim())) {
    const outlet = refMatch[1].trim();
    console.log(`  SOURCE FIX (editor/refs): "${currentSource}" → "${outlet}"`);
    return frontmatter.replace(
      /^source:\s*".+?"/m,
      `source: "${outlet}"`
    );
  }

  return frontmatter;
}

/**
 * Count words in the article body, excluding frontmatter and the ## References section.
 * This gives an accurate measure of editorial content length.
 */
function countArticleWords(body: string): number {
  // Strip the references section (## References and everything after it)
  let contentBody = body.replace(/## References[\s\S]*$/i, '').trim();
  // Strip markdown formatting artifacts but keep the text
  contentBody = contentBody
    .replace(/^#{1,6}\s+/gm, '')       // headings
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → text only
    .replace(/[*_~`]/g, '')             // bold/italic/strikethrough/code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .trim();
  // Count words (split on whitespace, filter empties)
  const words = contentBody.split(/\s+/).filter((w) => w.length > 0);
  return words.length;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

function formatDateForSlug(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toISOString().split('T')[0];
}

function splitMarkdown(content: string): { frontmatter: string; body: string } | null {
  const match = content.match(/^(---\n[\s\S]*?\n---)\n([\s\S]*)$/);
  if (!match) return null;
  return { frontmatter: match[1], body: match[2].trim() };
}

function loadExistingArticlesManifest(excludeSlug?: string): string {
  try {
    const files = readdirSync(ARTICLES_DIR).filter((f) => f.endsWith('.md'));
    const entries: string[] = [];

    for (const file of files) {
      const slug = file.replace('.md', '');
      if (slug === excludeSlug) continue; // Don't reference self
      const content = readFileSync(join(ARTICLES_DIR, file), 'utf-8');
      const titleMatch = content.match(/^title:\s*"(.+?)"/m);
      const title = titleMatch ? titleMatch[1] : slug;
      entries.push(`- "${title}" → /news/${slug}`);
    }

    return entries.length > 0 ? entries.join('\n') : '(No other articles on site)';
  } catch {
    return '(No other articles on site)';
  }
}

async function editArticle(
  client: Anthropic,
  headline: string,
  draftBody: string,
  item: RelevantArticle,
  existingArticles: string,
  retryInstruction?: string
): Promise<string | null> {
  const wordCountGuidance = item.isFeature ? '1200-2000 words' : '400-800 words';

  let prompt = EDITOR_PROMPT
    .replace('{headline}', headline)
    .replace('{sourceTitle}', item.title)
    .replace('{sourceContent}', item.description)
    .replace('{source}', item.source)
    .replace('{sourceUrl}', item.link)
    .replace('{existingArticles}', existingArticles)
    .replace('{draftArticle}', draftBody)
    .replace('{wordCount}', wordCountGuidance);

  // Append retry instruction if this is a word-count retry
  if (retryInstruction) {
    prompt += `\n\n${retryInstruction}`;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    const maxTokens = item.isFeature ? 24000 : 16000;
    const thinkingBudget = item.isFeature ? 15000 : 10000;

    const response = await client.messages.create(
      {
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: maxTokens,
        thinking: {
          type: 'enabled',
          budget_tokens: thinkingBudget,
        },
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: controller.signal as any }
    );

    clearTimeout(timeout);

    // Extract text from response (skip thinking blocks)
    for (const block of response.content) {
      if (block.type === 'text') return block.text;
    }
    return null;
  } catch (error) {
    console.error(`  ERR: Editor failed for "${headline.slice(0, 50)}": ${(error as Error).message?.slice(0, 80)}`);
    return null;
  }
}

async function main() {
  if (!existsSync(RELEVANT_PATH)) {
    console.log('No relevant articles file found. Nothing to edit.');
    return;
  }

  const relevant: RelevantArticle[] = JSON.parse(readFileSync(RELEVANT_PATH, 'utf-8'));
  if (relevant.length === 0) {
    console.log('No articles to edit.');
    return;
  }

  const client = new Anthropic();

  console.log(`Editing ${relevant.length} articles with Claude Editor (Sonnet + thinking)...\n`);

  let edited = 0;
  for (const item of relevant) {
    const headline = item.filterResult.suggestedHeadline || item.title;
    const dateStr = formatDateForSlug(item.pubDate);
    const slug = `${dateStr}-${slugify(headline)}`;
    const filePath = join(ARTICLES_DIR, `${slug}.md`);

    if (!existsSync(filePath)) {
      console.log(`  SKIP (not found): ${slug}`);
      continue;
    }

    const content = readFileSync(filePath, 'utf-8');
    const parts = splitMarkdown(content);
    if (!parts) {
      console.log(`  SKIP (bad format): ${slug}`);
      continue;
    }

    // Load manifest excluding current article
    const existingArticles = loadExistingArticlesManifest(slug);

    const label = item.isFeature ? 'Editing FEATURE' : 'Editing';
    console.log(`  ${label}: ${headline.slice(0, 70)}...`);
    const editedBody = await editArticle(client, headline, parts.body, item, existingArticles);

    if (!editedBody) {
      console.log(`  WARN: Editor returned nothing, keeping original`);
      continue;
    }

    // ── WORD COUNT VERIFICATION — retry once if article is too short ──
    const minWords = item.isFeature ? 1200 : 400;
    let verifiedBody = editedBody;
    const initialWordCount = countArticleWords(editedBody);

    if (initialWordCount < minWords) {
      console.log(`  WORD COUNT: ${initialWordCount} words (min ${minWords}) — retrying editor...`);
      const retryInstruction =
        `CRITICAL: Your previous draft was only ${initialWordCount} words. The minimum is ${minWords} words. ` +
        `Expand the article with factual context from the Epstein case timeline. Do NOT use filler.`;
      const retryBody = await editArticle(client, headline, parts.body, item, existingArticles, retryInstruction);

      if (retryBody) {
        const retryWordCount = countArticleWords(retryBody);
        if (retryWordCount >= minWords) {
          console.log(`  WORD COUNT RETRY: ${retryWordCount} words — passed`);
          verifiedBody = retryBody;
        } else {
          console.log(`  WORD COUNT RETRY: ${retryWordCount} words — still short, publishing anyway`);
          // Use whichever version is longer
          verifiedBody = retryWordCount > initialWordCount ? retryBody : editedBody;
        }
      } else {
        console.log(`  WORD COUNT RETRY: Editor returned nothing on retry, publishing original (${initialWordCount} words)`);
      }
    } else {
      console.log(`  WORD COUNT: ${initialWordCount} words — OK`);
    }

    // Extract key takeaways from editor output if present
    let finalBody = verifiedBody;
    let keyTakeaways: string[] = [];
    const takeawaysMatch = verifiedBody.match(/KEY_TAKEAWAYS_START\n([\s\S]*?)KEY_TAKEAWAYS_END/);
    if (takeawaysMatch) {
      const rawTakeaways = takeawaysMatch[1].trim();
      keyTakeaways = rawTakeaways
        .split('\n')
        .map((line: string) => line.replace(/^-\s*/, '').trim())
        .filter((line: string) => line.length > 0);
      // Remove the takeaways block from the body
      finalBody = verifiedBody.replace(/KEY_TAKEAWAYS_START\n[\s\S]*?KEY_TAKEAWAYS_END\n*/, '').trim();
    }

    // Strip any AI meta-notes that leaked into the article body.
    // The AI sometimes appends image suggestions, editorial notes, or source notes
    // after a "---" separator. Catch all variants aggressively.
    finalBody = finalBody
      .replace(/\n---\s*\n+\*\*[\s\S]*$/i, '')      // --- followed by any bold note block at end
      .replace(/\n+\*\*DOJ[\s\S]*$/i, '')             // **DOJ anything at end
      .replace(/\n+\*\*(?:IMAGE|DOCUMENT|NOTE|SOURCE|EDITOR)[\s\S]*$/i, '') // other bold meta-notes
      .replace(/\n+---\s*$/g, '')                      // trailing ---
      .trim();

    // ── QUALITY GATE: Detect vague collective attribution ──
    // Count sentences where unnamed collectives are the subject of actions.
    // If the article leans heavily on "lawmakers", "officials", "members of Congress"
    // without naming anyone, it's below AP standards.
    const vaguePatterns = [
      /\b(?:lawmakers|members of congress|congressional lawmakers|officials|critics|experts|observers|sources)\b(?:\s+(?:said|called|demanded|urged|argued|warned|expressed|stated|indicated|noted|suggested|questioned))/gi,
      /\bseveral\s+(?:lawmakers|members|officials|people)\b/gi,
      /\bcongress\s+(?:called|demanded|urged|pushed|moved|voted)\b/gi,
    ];
    let vagueCount = 0;
    for (const pattern of vaguePatterns) {
      const matches = finalBody.match(pattern);
      if (matches) vagueCount += matches.length;
    }

    // Count named-person attributions for comparison
    const namedAttribution = finalBody.match(/\b(?:Rep\.|Sen\.|Gov\.|Secretary|Director|Attorney General|President)\s+[A-Z][a-z]+/g);
    const namedCount = namedAttribution ? namedAttribution.length : 0;

    if (vagueCount >= 3 && namedCount < vagueCount) {
      console.log(`  QUALITY WARN: ${vagueCount} vague attributions vs ${namedCount} named sources in "${headline.slice(0, 50)}"`);
      // If the article is dominated by vague attribution and has few named sources,
      // flag it but still publish (the editor prompt should have caught it).
      // In extreme cases (5+ vague, 0 named), reject entirely.
      if (vagueCount >= 5 && namedCount === 0) {
        console.log(`  QUALITY REJECT: Article has ${vagueCount} vague attributions and zero named sources. Deleting.`);
        try { unlinkSync(filePath); } catch {}
        continue;
      }
    }

    // Check for QUALITY_FAIL signal from editor — delete the file so it won't be committed
    if (finalBody.includes('QUALITY_FAIL:')) {
      console.log(`  QUALITY REJECT (editor flagged): ${headline.slice(0, 50)}. Deleting.`);
      try { unlinkSync(filePath); } catch {}
      continue;
    }

    // Inject keyTakeaways into frontmatter if extracted and not already present
    let finalFrontmatter = parts.frontmatter;
    if (keyTakeaways.length > 0 && !parts.frontmatter.includes('keyTakeaways:')) {
      const takeawaysYaml = 'keyTakeaways:\n' + keyTakeaways.map((t: string) => {
        // Strip existing quotes if the AI wrapped them, then always re-quote
        const clean = t.replace(/^["']|["']$/g, '').replace(/"/g, '\\"');
        return `  - "${clean}"`;
      }).join('\n');
      // Insert before "status:" line
      finalFrontmatter = finalFrontmatter.replace(
        /^(status:\s)/m,
        `${takeawaysYaml}\n$1`
      );
      console.log(`  TAKEAWAYS: Added ${keyTakeaways.length} key takeaways`);
    }

    // Fix frontmatter source if it's still an aggregator name
    finalFrontmatter = fixFrontmatterSource(finalFrontmatter, finalBody);

    // Write back with (possibly updated) frontmatter + edited body
    const newContent = `${finalFrontmatter}\n\n${finalBody.trim()}\n`;
    writeFileSync(filePath, newContent);
    console.log(`  EDITED: ${slug}`);
    edited++;
  }

  console.log(`\nDone. Edited ${edited} articles.`);
}

main().catch(console.error);
