import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PEOPLE_DIR = join(__dirname, '..', 'src', 'content', 'people');
const ARTICLES_DIR = join(__dirname, '..', 'src', 'content', 'articles');

interface PersonEntry {
  slug: string;
  name: string;
  aliases: string[];
}

function parseFrontmatter(content: string): { frontmatter: Record<string, any>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const fmLines = match[1].split('\n');
  const fm: Record<string, any> = {};
  let currentKey = '';
  let currentArray: string[] | null = null;

  for (const line of fmLines) {
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
      } else {
        fm[currentKey] = value.replace(/^"|"$/g, '');
      }
    }
  }
  if (currentArray && currentKey) {
    fm[currentKey] = currentArray;
  }

  return { frontmatter: fm, body: match[2] };
}

function loadPeople(): PersonEntry[] {
  const files = readdirSync(PEOPLE_DIR).filter((f) => f.endsWith('.md'));
  return files.map((file) => {
    const content = readFileSync(join(PEOPLE_DIR, file), 'utf-8');
    const { frontmatter } = parseFrontmatter(content);
    return {
      slug: file.replace('.md', ''),
      name: frontmatter.name || '',
      aliases: Array.isArray(frontmatter.aliases) ? frontmatter.aliases : [],
    };
  });
}

const MAX_PEOPLE_PER_ARTICLE = 10;

function findMentionedPeople(body: string, people: PersonEntry[]): string[] {
  const lowerBody = body.toLowerCase();
  const matches: { slug: string; position: number }[] = [];

  for (const person of people) {
    const namesToCheck = [person.name, ...person.aliases];
    let earliestPos = Infinity;
    for (const name of namesToCheck) {
      if (name) {
        const pos = lowerBody.indexOf(name.toLowerCase());
        if (pos !== -1 && pos < earliestPos) {
          earliestPos = pos;
        }
      }
    }
    if (earliestPos !== Infinity) {
      matches.push({ slug: person.slug, position: earliestPos });
    }
  }

  // Sort by order of first appearance, cap at MAX_PEOPLE_PER_ARTICLE
  matches.sort((a, b) => a.position - b.position);
  return matches.slice(0, MAX_PEOPLE_PER_ARTICLE).map((m) => m.slug);
}

const MAX_RELATED_ARTICLES = 5;

function findLinkedArticles(body: string, existingFiles: Set<string>): string[] {
  const linkPattern = /\/news\/([\w-]+)/g;
  const slugs: string[] = [];
  const seen = new Set<string>();
  let match;
  while ((match = linkPattern.exec(body)) !== null) {
    const slug = match[1];
    // Only include if the article file actually exists, preserve order of appearance
    if (existingFiles.has(`${slug}.md`) && !seen.has(slug)) {
      seen.add(slug);
      slugs.push(slug);
    }
  }
  // Cap at MAX_RELATED_ARTICLES — keep only the first (most relevant, appear earliest in body)
  return slugs.slice(0, MAX_RELATED_ARTICLES);
}

function updateArticleFrontmatter(
  filePath: string,
  peopleSlugs: string[],
  articleSlugs: string[]
): boolean {
  const content = readFileSync(filePath, 'utf-8');
  const { frontmatter } = parseFrontmatter(content);

  const existingPeople: string[] = Array.isArray(frontmatter.people) ? frontmatter.people : [];
  const mergedPeople = [...new Set([...existingPeople, ...peopleSlugs])];

  const existingRelated: string[] = Array.isArray(frontmatter.relatedArticles) ? frontmatter.relatedArticles : [];
  const mergedRelated = [...new Set([...existingRelated, ...articleSlugs])];

  const peopleChanged = mergedPeople.length !== existingPeople.length || !mergedPeople.every((p) => existingPeople.includes(p));
  const relatedChanged = mergedRelated.length !== existingRelated.length || !mergedRelated.every((r) => existingRelated.includes(r));

  if (!peopleChanged && !relatedChanged) return false;

  // Rebuild frontmatter with updated arrays
  const lines = content.split('\n');
  const fmStart = lines.indexOf('---');
  const fmEnd = lines.indexOf('---', fmStart + 1);

  if (fmStart === -1 || fmEnd === -1) return false;

  const fmLines = lines.slice(fmStart + 1, fmEnd);
  const newFmLines: string[] = [];
  let skipArrayItems = false;
  let hasRelatedArticles = false;

  for (const line of fmLines) {
    if (line.startsWith('people:')) {
      newFmLines.push('people:');
      for (const slug of mergedPeople) {
        newFmLines.push(`  - ${slug}`);
      }
      skipArrayItems = true;
      continue;
    }
    if (line.startsWith('relatedArticles:')) {
      hasRelatedArticles = true;
      newFmLines.push('relatedArticles:');
      if (mergedRelated.length > 0) {
        for (const slug of mergedRelated) {
          newFmLines.push(`  - ${slug}`);
        }
      } else {
        newFmLines.push('  []');
      }
      skipArrayItems = true;
      continue;
    }
    if (skipArrayItems && (line.match(/^\s+-\s+/) || line.trim() === '[]')) {
      continue;
    }
    skipArrayItems = false;
    newFmLines.push(line);
  }

  // If relatedArticles wasn't in frontmatter yet, add it after people
  if (!hasRelatedArticles && mergedRelated.length > 0) {
    const peopleIdx = newFmLines.findIndex((l) => l.startsWith('people:'));
    // Find end of people array
    let insertIdx = peopleIdx + 1;
    while (insertIdx < newFmLines.length && newFmLines[insertIdx].match(/^\s+-\s+/)) {
      insertIdx++;
    }
    const relatedLines = ['relatedArticles:', ...mergedRelated.map((s) => `  - ${s}`)];
    newFmLines.splice(insertIdx, 0, ...relatedLines);
  }

  const newContent = ['---', ...newFmLines, '---', ...lines.slice(fmEnd + 1)].join('\n');
  writeFileSync(filePath, newContent);
  return true;
}

function main() {
  const people = loadPeople();
  console.log(`Loaded ${people.length} people entries.`);

  const articleFiles = readdirSync(ARTICLES_DIR).filter((f) => f.endsWith('.md'));
  const existingFiles = new Set(articleFiles);
  console.log(`Scanning ${articleFiles.length} articles for people & article mentions...\n`);

  let updated = 0;
  for (const file of articleFiles) {
    const filePath = join(ARTICLES_DIR, file);
    const content = readFileSync(filePath, 'utf-8');
    const { body } = parseFrontmatter(content);

    const mentionedPeople = findMentionedPeople(body, people);
    const linkedArticles = findLinkedArticles(body, existingFiles);

    if (mentionedPeople.length > 0 || linkedArticles.length > 0) {
      const changed = updateArticleFrontmatter(filePath, mentionedPeople, linkedArticles);
      if (changed) {
        const parts = [];
        if (mentionedPeople.length) parts.push(`people: ${mentionedPeople.join(', ')}`);
        if (linkedArticles.length) parts.push(`articles: ${linkedArticles.join(', ')}`);
        console.log(`  UPDATED: ${file} — ${parts.join(' | ')}`);
        updated++;
      }
    }
  }

  console.log(`\nDone. Updated ${updated} articles.`);
}

main();
