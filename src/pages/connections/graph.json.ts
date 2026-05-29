import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { buildGlobalGraph } from '../../utils/connections';
import { categoryColorHex } from '../../utils/categories';

/**
 * Static endpoint: emits the people-network graph as JSON with a ForceAtlas2
 * layout baked in at build time (x,y per node), so the client renders instantly
 * without running a layout simulation. Regenerated on every build.
 */
export const GET: APIRoute = async () => {
  const people = await getCollection('people');
  const articles = await getCollection('articles', (a) => a.data.status === 'published');
  const { nodes, edges } = buildGlobalGraph(people, articles, { excludeHubs: true, minWeight: 1 });

  const g = new Graph({ type: 'undirected' });
  for (const n of nodes) {
    g.addNode(n.id, {
      label: n.name,
      category: n.category,
      degree: n.degree,
      articleTotal: n.articleTotal,
    });
  }
  for (const e of edges) {
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
    if (g.hasEdge(e.source, e.target)) continue;
    g.addEdge(e.source, e.target, { weight: e.weight, manual: e.manual });
  }

  // Seed deterministic circular positions so ForceAtlas2 has room to spread.
  const N = Math.max(1, g.order);
  let i = 0;
  g.forEachNode((node) => {
    const angle = (2 * Math.PI * i) / N;
    g.setNodeAttribute(node, 'x', Math.cos(angle) * 100);
    g.setNodeAttribute(node, 'y', Math.sin(angle) * 100);
    i++;
  });

  if (g.size > 0) {
    forceAtlas2.assign(g, {
      iterations: 300,
      settings: {
        ...forceAtlas2.inferSettings(g),
        gravity: 1.2,
        scalingRatio: 12,
        barnesHutOptimize: g.order > 200,
        adjustSizes: true,
      },
    });
  }

  const outNodes = g.mapNodes((node, attrs) => ({
    id: node,
    label: attrs.label,
    category: attrs.category,
    x: attrs.x,
    y: attrs.y,
    size: Math.max(3, Math.min(20, 3 + Math.sqrt(attrs.degree || 0) * 2.2)),
    color: categoryColorHex[attrs.category] || categoryColorHex.other,
    degree: attrs.degree,
    articleTotal: attrs.articleTotal,
  }));

  const outEdges = g.mapEdges((edge, attrs, source, target) => ({
    source,
    target,
    weight: attrs.weight,
    manual: attrs.manual,
  }));

  return new Response(JSON.stringify({ nodes: outNodes, edges: outEdges }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
