import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
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
  existingArticles: string
): Promise<string | null> {
  const wordCountGuidance = item.isFeature ? '1200-2000 words' : '400-800 words';

  const prompt = EDITOR_PROMPT
    .replace('{headline}', headline)
    .replace('{sourceTitle}', item.title)
    .replace('{sourceContent}', item.description)
    .replace('{source}', item.source)
    .replace('{sourceUrl}', item.link)
    .replace('{existingArticles}', existingArticles)
    .replace('{draftArticle}', draftBody)
    .replace('{wordCount}', wordCountGuidance);

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

    // Extract key takeaways from editor output if present
    let finalBody = editedBody;
    let keyTakeaways: string[] = [];
    const takeawaysMatch = editedBody.match(/KEY_TAKEAWAYS_START\n([\s\S]*?)KEY_TAKEAWAYS_END/);
    if (takeawaysMatch) {
      const rawTakeaways = takeawaysMatch[1].trim();
      keyTakeaways = rawTakeaways
        .split('\n')
        .map((line: string) => line.replace(/^-\s*/, '').trim())
        .filter((line: string) => line.length > 0);
      // Remove the takeaways block from the body
      finalBody = editedBody.replace(/KEY_TAKEAWAYS_START\n[\s\S]*?KEY_TAKEAWAYS_END\n*/, '').trim();
    }

    // Strip any DOJ Document Image notes the AI may have left in the output
    finalBody = finalBody.replace(/---\s*\n\s*\*\*DOJ Document Image[\s\S]*$/m, '').trim();

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

    // Write back with (possibly updated) frontmatter + edited body
    const newContent = `${finalFrontmatter}\n\n${finalBody.trim()}\n`;
    writeFileSync(filePath, newContent);
    console.log(`  EDITED: ${slug}`);
    edited++;
  }

  console.log(`\nDone. Edited ${edited} articles.`);
}

main().catch(console.error);
