/**
 * Build-time connection graph layer. Computes, from article co-mentions and
 * curated `notableConnections`, the relationship data that powers:
 *   - the "Connections" section on each profile (PersonConnections.astro)
 *   - the global network page (/connections)
 *   - the "frequently appears with" stat (PersonStats.astro)
 *
 * All slug resolution goes through a people index, so any edge whose target
 * has no profile yet (e.g. just-named, profile pending) is silently dropped —
 * the build never errors and the graph never links to a 404.
 */
import type { CollectionEntry } from 'astro:content';

/** Near-universal hubs — excluded from co-mention edges so the graph isn't a hairball. */
export const HUB_SLUGS = ['jeffrey-epstein', 'ghislaine-maxwell'];

export interface PersonRef {
  slug: string;
  name: string;
  category: string;
  image?: string;
}

export interface ConnectionEdge {
  slug: string;
  name: string;
  category: string;
  articleCount: number; // co-mention weight (0 if manual-only)
  manual: boolean; // present in this person's curated notableConnections
  weight: number; // ranking score
}

export interface GraphNode {
  id: string;
  name: string;
  category: string;
  degree: number;
  articleTotal: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  manual: boolean;
}

const MANUAL_BONUS = 2;

/** Map slug -> {name, category, image}; the single resolver for all edges. */
export function getPeopleIndex(people: CollectionEntry<'people'>[]): Map<string, PersonRef> {
  const idx = new Map<string, PersonRef>();
  for (const p of people) {
    idx.set(p.id, {
      slug: p.id,
      name: p.data.name,
      category: p.data.category,
      image: p.data.image || undefined,
    });
  }
  return idx;
}

/**
 * Unified, ranked connection set for one person: article co-mentions (hubs
 * excluded) merged with curated notableConnections (kept even if a hub).
 */
export function getConnectionsFor(
  slug: string,
  peopleIndex: Map<string, PersonRef>,
  articles: CollectionEntry<'articles'>[],
  notableConnections: string[] = [],
): ConnectionEdge[] {
  const coMentions: Record<string, number> = {};
  for (const a of articles) {
    if (!a.data.people.includes(slug)) continue;
    for (const other of a.data.people) {
      if (other === slug || HUB_SLUGS.includes(other)) continue;
      coMentions[other] = (coMentions[other] || 0) + 1;
    }
  }

  const edges = new Map<string, ConnectionEdge>();
  for (const [s, count] of Object.entries(coMentions)) {
    const ref = peopleIndex.get(s);
    if (!ref) continue; // drop dangling
    edges.set(s, {
      slug: s,
      name: ref.name,
      category: ref.category,
      articleCount: count,
      manual: false,
      weight: count,
    });
  }

  for (const s of notableConnections) {
    if (s === slug) continue;
    const ref = peopleIndex.get(s);
    if (!ref) continue; // drop dangling
    const existing = edges.get(s);
    if (existing) {
      existing.manual = true;
      existing.weight += MANUAL_BONUS;
    } else {
      edges.set(s, {
        slug: s,
        name: ref.name,
        category: ref.category,
        articleCount: 0,
        manual: true,
        weight: MANUAL_BONUS,
      });
    }
  }

  return [...edges.values()].sort(
    (a, b) => b.weight - a.weight || a.name.localeCompare(b.name),
  );
}

/**
 * Whole-graph nodes + undirected edges for the network page.
 * Hubs are excluded as nodes by default to keep the layout legible.
 */
export function buildGlobalGraph(
  people: CollectionEntry<'people'>[],
  articles: CollectionEntry<'articles'>[],
  opts: { excludeHubs?: boolean; minWeight?: number } = {},
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const { excludeHubs = true, minWeight = 1 } = opts;
  const peopleIndex = getPeopleIndex(people);
  const included = (slug: string) =>
    peopleIndex.has(slug) && (!excludeHubs || !HUB_SLUGS.includes(slug));

  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const edgeMap = new Map<string, GraphEdge>();

  // Co-mention edges (undirected, weighted by shared articles).
  for (const a of articles) {
    const ppl = [...new Set(a.data.people.filter(included))];
    for (let i = 0; i < ppl.length; i++) {
      for (let j = i + 1; j < ppl.length; j++) {
        const k = key(ppl[i], ppl[j]);
        const e = edgeMap.get(k);
        if (e) e.weight += 1;
        else {
          const [source, target] = k.split('|');
          edgeMap.set(k, { source, target, weight: 1, manual: false });
        }
      }
    }
  }

  // Curated manual edges.
  for (const p of people) {
    if (!included(p.id)) continue;
    for (const other of p.data.notableConnections || []) {
      if (other === p.id || !included(other)) continue;
      const k = key(p.id, other);
      const e = edgeMap.get(k);
      if (e) e.manual = true;
      else {
        const [source, target] = k.split('|');
        edgeMap.set(k, { source, target, weight: 1, manual: true });
      }
    }
  }

  const edges = [...edgeMap.values()].filter((e) => e.manual || e.weight >= minWeight);

  const degree: Record<string, number> = {};
  for (const e of edges) {
    degree[e.source] = (degree[e.source] || 0) + 1;
    degree[e.target] = (degree[e.target] || 0) + 1;
  }
  const articleTotal: Record<string, number> = {};
  for (const a of articles) {
    for (const s of a.data.people) {
      if (included(s)) articleTotal[s] = (articleTotal[s] || 0) + 1;
    }
  }

  const nodes: GraphNode[] = [];
  for (const p of people) {
    if (!included(p.id)) continue;
    nodes.push({
      id: p.id,
      name: p.data.name,
      category: p.data.category,
      degree: degree[p.id] || 0,
      articleTotal: articleTotal[p.id] || 0,
    });
  }

  return { nodes, edges };
}
