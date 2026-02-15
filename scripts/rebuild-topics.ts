import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTICLES_DIR = join(__dirname, '..', 'src', 'content', 'articles');
const OUTPUT_FILE = join(__dirname, 'config', 'article-topics.json');

interface ArticleTopic {
  slug: string;
  title: string;
  summary: string;
  topic: string;
  people: string[];
  tags: string[];
}

function parseFrontmatter(content: string): { frontmatter: Record<string, any>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const fmLines = match[1].split('\n');
  const fm: Record<string, any> = {};
  let currentKey = '';
  let currentArray: string[] | null = null;
  let inMultilineString = false;
  let multilineValue = '';

  for (const line of fmLines) {
    // Handle multiline string continuation
    if (inMultilineString) {
      if (line.match(/^\w+:/)) {
        // New key found, end multiline string
        fm[currentKey] = multilineValue.trim();
        inMultilineString = false;
        multilineValue = '';
        // Process this line as a new key
      } else {
        // Continue multiline string
        multilineValue += ' ' + line.trim();
        continue;
      }
    }

    if (line.match(/^\s+-\s+/)) {
      // Array item
      const val = line.replace(/^\s+-\s+/, '').replace(/^"|"$/g, '');
      if (currentArray) currentArray.push(val);
    } else if (line.includes(':')) {
      if (currentArray && currentKey) {
        fm[currentKey] = currentArray;
        currentArray = null;
      }
      const [key, ...rest] = line.split(':');
      const value = rest.join(':').trim();
      currentKey = key.trim();

      if (value === '' || value === '[]') {
        currentArray = [];
      } else if (value === '>-' || value === '>' || value === '|') {
        // Start of multiline string
        inMultilineString = true;
        multilineValue = '';
      } else {
        fm[currentKey] = value.replace(/^"|"$/g, '');
      }
    } else if (inMultilineString && line.trim()) {
      // Continuation of multiline string
      multilineValue += ' ' + line.trim();
    }
  }

  // Handle final multiline string or array
  if (inMultilineString && currentKey) {
    fm[currentKey] = multilineValue.trim();
  }
  if (currentArray && currentKey) {
    fm[currentKey] = currentArray;
  }

  return { frontmatter: fm, body: match[2] };
}

function extractArticleTopics(): ArticleTopic[] {
  const articles: ArticleTopic[] = [];
  const articleFiles = readdirSync(ARTICLES_DIR).filter((f) => f.endsWith('.md'));

  console.log(`Processing ${articleFiles.length} articles...`);

  for (const file of articleFiles) {
    const filePath = join(ARTICLES_DIR, file);
    const content = readFileSync(filePath, 'utf-8');
    const { frontmatter } = parseFrontmatter(content);

    const slug = file.replace('.md', '');
    const title = frontmatter.title || '';
    const summary = frontmatter.summary || '';
    const topic = summary || title;
    const people = Array.isArray(frontmatter.people) ? frontmatter.people : [];
    const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [];

    articles.push({
      slug,
      title,
      summary,
      topic,
      people,
      tags,
    });
  }

  // Sort by slug for consistent output
  articles.sort((a, b) => a.slug.localeCompare(b.slug));

  return articles;
}

function main() {
  console.log('Rebuilding article-topics.json...\n');

  const topics = extractArticleTopics();

  console.log(`\nExtracted ${topics.length} article topics`);
  console.log(`Writing to ${OUTPUT_FILE}...`);

  writeFileSync(OUTPUT_FILE, JSON.stringify(topics, null, 2) + '\n');

  console.log('\nDone! article-topics.json has been rebuilt.');
}

main();
