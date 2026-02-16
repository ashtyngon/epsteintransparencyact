/**
 * GitHub API helpers for reading/writing content files.
 * All content CRUD goes through the GitHub API to keep git as source of truth.
 */

const API_BASE = 'https://api.github.com';

interface GitHubFileResponse {
  name: string;
  path: string;
  sha: string;
  size: number;
  content: string; // base64 encoded
  encoding: string;
}

interface GitHubTreeItem {
  path: string;
  type: string;
  sha: string;
  size?: number;
}

export interface ContentFile {
  slug: string;
  path: string;
  sha: string;
  frontmatter: Record<string, any>;
  body: string;
  raw: string;
}

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/**
 * List all markdown files in a content directory.
 */
export async function listContentFiles(
  token: string,
  repo: string,
  collection: string
): Promise<{ slug: string; path: string; sha: string }[]> {
  const path = `src/content/${collection}`;
  const res = await fetch(
    `${API_BASE}/repos/${repo}/contents/${path}`,
    { headers: headers(token) }
  );

  if (!res.ok) return [];
  const items = (await res.json()) as any[];

  return items
    .filter((item: any) => item.name.endsWith('.md'))
    .map((item: any) => ({
      slug: item.name.replace('.md', ''),
      path: item.path,
      sha: item.sha,
    }));
}

/**
 * Parse YAML frontmatter from markdown content.
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, any>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const yamlStr = match[1];
  const body = match[2].trim();

  // Simple YAML parser for our known frontmatter fields
  const frontmatter: Record<string, any> = {};
  let currentKey = '';
  let currentArray: string[] | null = null;

  for (const line of yamlStr.split('\n')) {
    // Array item
    if (line.match(/^  - /)) {
      const val = line.replace(/^  - /, '').replace(/^["']|["']$/g, '').trim();
      if (currentArray) {
        currentArray.push(val);
      }
      continue;
    }

    // Close any open array
    if (currentArray && currentKey) {
      frontmatter[currentKey] = currentArray;
      currentArray = null;
    }

    // Key: value pair
    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      let value: any = kvMatch[2].trim();

      if (value === '' || value === undefined) {
        // Could be start of array or empty value
        currentKey = key;
        currentArray = [];
        continue;
      }

      // Remove quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      // Parse booleans
      if (value === 'true') value = true;
      else if (value === 'false') value = false;

      // Parse numbers (but not dates)
      else if (/^\d+\.\d+$/.test(value)) value = parseFloat(value);
      else if (/^\d+$/.test(value) && !value.includes('-')) value = parseInt(value, 10);

      frontmatter[key] = value;
      currentKey = key;
      currentArray = null;
    }
  }

  // Close last array
  if (currentArray && currentKey) {
    frontmatter[currentKey] = currentArray;
  }

  return { frontmatter, body };
}

/**
 * Get a single content file with parsed frontmatter.
 */
export async function getContentFile(
  token: string,
  repo: string,
  collection: string,
  slug: string
): Promise<ContentFile | null> {
  const path = `src/content/${collection}/${slug}.md`;
  const res = await fetch(
    `${API_BASE}/repos/${repo}/contents/${path}`,
    { headers: headers(token) }
  );

  if (!res.ok) return null;
  const data = (await res.json()) as GitHubFileResponse;

  const raw = atob(data.content.replace(/\n/g, ''));
  const { frontmatter, body } = parseFrontmatter(raw);

  return { slug, path: data.path, sha: data.sha, frontmatter, body, raw };
}

/**
 * Build YAML frontmatter string from an object.
 */
function buildFrontmatter(fm: Record<string, any>): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(fm)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}:`);
        lines.push('  []');
      } else if (typeof value[0] === 'object') {
        // Array of objects (like sources)
        lines.push(`${key}:`);
        for (const item of value) {
          const entries = Object.entries(item);
          if (entries.length > 0) {
            lines.push(`  - ${entries[0][0]}: "${String(entries[0][1]).replace(/"/g, '\\"')}"`);
            for (let i = 1; i < entries.length; i++) {
              lines.push(`    ${entries[i][0]}: "${String(entries[i][1]).replace(/"/g, '\\"')}"`);
            }
          }
        }
      } else {
        lines.push(`${key}:`);
        for (const item of value) {
          const str = String(item);
          if (str.includes(':') || str.includes('"') || str.includes("'")) {
            lines.push(`  - "${str.replace(/"/g, '\\"')}"`);
          } else {
            lines.push(`  - ${str}`);
          }
        }
      }
    } else if (typeof value === 'string') {
      if (value.includes('\n') || value.includes('"')) {
        lines.push(`${key}: "${value.replace(/"/g, '\\"')}"`);
      } else {
        lines.push(`${key}: "${value}"`);
      }
    } else if (typeof value === 'boolean') {
      lines.push(`${key}: ${value}`);
    } else if (typeof value === 'number') {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }

  return lines.join('\n');
}

/**
 * Build full markdown content from frontmatter + body.
 */
export function buildMarkdownContent(fm: Record<string, any>, body: string): string {
  return `---\n${buildFrontmatter(fm)}\n---\n\n${body.trim()}\n`;
}

/**
 * Update an existing file via GitHub API.
 */
export async function updateFile(
  token: string,
  repo: string,
  path: string,
  content: string,
  sha: string,
  message: string
): Promise<boolean> {
  const res = await fetch(
    `${API_BASE}/repos/${repo}/contents/${path}`,
    {
      method: 'PUT',
      headers: headers(token),
      body: JSON.stringify({
        message,
        content: btoa(unescape(encodeURIComponent(content))),
        sha,
      }),
    }
  );

  return res.ok;
}

/**
 * Create a new file via GitHub API.
 */
export async function createFile(
  token: string,
  repo: string,
  path: string,
  content: string,
  message: string
): Promise<boolean> {
  const res = await fetch(
    `${API_BASE}/repos/${repo}/contents/${path}`,
    {
      method: 'PUT',
      headers: headers(token),
      body: JSON.stringify({
        message,
        content: btoa(unescape(encodeURIComponent(content))),
      }),
    }
  );

  return res.ok;
}

/**
 * Delete a file via GitHub API.
 */
export async function deleteFile(
  token: string,
  repo: string,
  path: string,
  sha: string,
  message: string
): Promise<boolean> {
  const res = await fetch(
    `${API_BASE}/repos/${repo}/contents/${path}`,
    {
      method: 'DELETE',
      headers: headers(token),
      body: JSON.stringify({ message, sha }),
    }
  );

  return res.ok;
}

/**
 * Get latest GitHub Actions workflow runs.
 */
export async function getWorkflowRuns(
  token: string,
  repo: string,
  limit: number = 5
): Promise<any[]> {
  const res = await fetch(
    `${API_BASE}/repos/${repo}/actions/runs?per_page=${limit}`,
    { headers: headers(token) }
  );

  if (!res.ok) return [];
  const data = (await res.json()) as any;
  return data.workflow_runs || [];
}

/**
 * Trigger a workflow dispatch.
 */
export async function triggerWorkflow(
  token: string,
  repo: string,
  workflowFile: string = 'fetch-articles.yml'
): Promise<boolean> {
  const res = await fetch(
    `${API_BASE}/repos/${repo}/actions/workflows/${workflowFile}/dispatches`,
    {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({ ref: 'main' }),
    }
  );

  return res.ok;
}
