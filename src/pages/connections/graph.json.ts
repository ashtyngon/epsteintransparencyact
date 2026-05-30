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
  const { nodes, edges } = buildGlobalGraph(people, articles, {
    excludeHubs: true,
    minWeight: 1,
    dropIsolated: true,
  });

  // Node radius scales with degree (sqrt keeps the biggest hubs from dwarfing
  // everyone). Computed once here so layout (overlap avoidance) and rendering
  // use the exact same size.
  const sizeFor = (degree: number) =>
    Math.max(4, Math.min(22, 4 + Math.sqrt(degree || 0) * 2.4));

  const g = new Graph({ type: 'undirected' });
  for (const n of nodes) {
    g.addNode(n.id, {
      label: n.name,
      category: n.category,
      degree: n.degree,
      articleTotal: n.articleTotal,
      size: sizeFor(n.degree),
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
      iterations: 600,
      settings: {
        ...forceAtlas2.inferSettings(g),
        // LinLog + outbound attraction pull dense co-mention clusters apart so
        // the result reads as communities instead of one hairball; strong
        // gravity keeps loosely-tied nodes from drifting off the canvas.
        linLogMode: true,
        outboundAttractionDistribution: true,
        adjustSizes: true, // honor node `size` → no overlapping discs
        // Lower edge-weight influence so the densely co-mentioned core hubs
        // don't collapse into one tight knot — they spread, and the edges
        // between them span area instead of piling up in the centre.
        edgeWeightInfluence: 0.45,
        gravity: 0.55,
        scalingRatio: 13,
        slowDown: 7,
        barnesHutOptimize: false, // exact forces — this graph is small enough
      },
    });
  }

  // Recenter on the centroid so the network spins around its true middle and
  // frames symmetrically regardless of where the layout drifted.
  if (g.order > 0) {
    let cx = 0;
    let cy = 0;
    g.forEachNode((_n, a) => {
      cx += a.x;
      cy += a.y;
    });
    cx /= g.order;
    cy /= g.order;
    g.forEachNode((n, a) => {
      g.setNodeAttribute(n, 'x', a.x - cx);
      g.setNodeAttribute(n, 'y', a.y - cy);
    });
  }

  const outNodes = g.mapNodes((node, attrs) => ({
    id: node,
    label: attrs.label,
    category: attrs.category,
    x: attrs.x,
    y: attrs.y,
    size: attrs.size,
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
