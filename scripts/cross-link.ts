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

function findMentionedPeople(body: string, people: PersonEntry[]): string[] {
  const mentioned: Set<string> = new Set();
  const lowerBody = body.toLowerCase();

  for (const person of people) {
    const namesToCheck = [person.name, ...person.aliases];
    for (const name of namesToCheck) {
      if (name && lowerBody.includes(name.toLowerCase())) {
        mentioned.add(person.slug);
        break;
      }
    }
  }

  return [...mentioned];
}

function updateArticlePeople(filePath: string, peopleSlugs: string[]): boolean {
  const content = readFileSync(filePath, 'utf-8');
  const { frontmatter, body } = parseFrontmatter(content);

  const existingPeople: string[] = Array.isArray(frontmatter.people) ? frontmatter.people : [];
  const merged = [...new Set([...existingPeople, ...peopleSlugs])];

  if (merged.length === existingPeople.length && merged.every((p) => existingPeople.includes(p))) {
    return false; // No changes
  }

  // Rebuild frontmatter with updated people
  const lines = content.split('\n');
  const fmStart = lines.indexOf('---');
  const fmEnd = lines.indexOf('---', fmStart + 1);

  if (fmStart === -1 || fmEnd === -1) return false;

  const fmLines = lines.slice(fmStart + 1, fmEnd);
  const newFmLines: string[] = [];
  let skipArrayItems = false;

  for (const line of fmLines) {
    if (line.startsWith('people:')) {
      newFmLines.push('people:');
      for (const slug of merged) {
        newFmLines.push(`  - ${slug}`);
      }
      skipArrayItems = true;
      continue;
    }
    if (skipArrayItems && line.match(/^\s+-\s+/)) {
      continue; // Skip old people array items
    }
    skipArrayItems = false;
    newFmLines.push(line);
  }

  const newContent = ['---', ...newFmLines, '---', ...lines.slice(fmEnd + 1)].join('\n');
  writeFileSync(filePath, newContent);
  return true;
}

function main() {
  const people = loadPeople();
  console.log(`Loaded ${people.length} people entries.`);

  const articleFiles = readdirSync(ARTICLES_DIR).filter((f) => f.endsWith('.md'));
  console.log(`Scanning ${articleFiles.length} articles for people mentions...\n`);

  let updated = 0;
  for (const file of articleFiles) {
    const filePath = join(ARTICLES_DIR, file);
    const content = readFileSync(filePath, 'utf-8');
    const { body } = parseFrontmatter(content);

    const mentioned = findMentionedPeople(body, people);
    if (mentioned.length > 0) {
      const changed = updateArticlePeople(filePath, mentioned);
      if (changed) {
        console.log(`  UPDATED: ${file} — added: ${mentioned.join(', ')}`);
        updated++;
      }
    }
  }

  console.log(`\nDone. Updated ${updated} articles.`);
}

main();
