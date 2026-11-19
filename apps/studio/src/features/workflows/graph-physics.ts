import type { NodeKind, RawGraph, RawGraphEdge } from "@/types";

export type GraphLayoutMode = "physics" | "flow";

export interface PhysicsParams {
  repelStrength: number;
  linkDistance: number;
  linkStrength: number;
  centerStrength: number;
  damping: number;
  layoutMode: GraphLayoutMode;
}

export const DEFAULT_PHYSICS_PARAMS: PhysicsParams = {
  repelStrength: 6200,
  linkDistance: 230,
  linkStrength: 0.06,
  centerStrength: 0.012,
  damping: 0.85,
  layoutMode: "flow",
};

export interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  degree: number;
  scale: number;
  scaleVel: number;
  alpha: number;
  glow: number;
  level: number;
  anchorX: number;
  anchorY: number;
  flowAnchorX: number;
  flowAnchorY: number;
}

export interface CanvasRipple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
  color: string;
}

export interface BezierGeometry {
  sx: number;
  sy: number;
  cx: number;
  cy: number;
  tx: number;
  ty: number;
  midX: number;
  midY: number;
  endAngle: number;
  isLoop: boolean;
}

/**
 * Compute BFS topological depth levels from entryNode and compute
 * balanced left-to-right flow anchor coordinates for each node.
 */
export function computeTopologicalAnchors(graph: RawGraph): Map<string, { level: number; x: number; y: number }> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    const list = adj.get(e.source) ?? [];
    list.push(e.target);
    adj.set(e.source, list);
  }

  const levelMap = new Map<string, number>();
  const levels: string[][] = [];
  let frontier: string[] = [];

  if (graph.entryNode && byId.has(graph.entryNode)) {
    frontier.push(graph.entryNode);
  } else if (graph.nodes.length > 0) {
    frontier.push(graph.nodes[0].id);
  }

  let depth = 0;
  while (frontier.length > 0) {
    const current: string[] = [];
    const next: string[] = [];
    for (const id of frontier) {
      if (levelMap.has(id)) continue;
      levelMap.set(id, depth);
      current.push(id);
      for (const target of adj.get(id) ?? []) {
        if (!levelMap.has(target)) next.push(target);
      }
    }
    if (current.length > 0) {
      levels.push(current);
      depth += 1;
    }
    frontier = next;
  }

  const orphans = graph.nodes.filter((n) => !levelMap.has(n.id)).map((n) => n.id);
  if (orphans.length > 0) {
    for (const id of orphans) levelMap.set(id, depth);
    levels.push(orphans);
  }

  const colSpacing = 255;
  const rowSpacing = 175;
  const totalWidth = Math.max(0, levels.length - 1) * colSpacing;
  const anchors = new Map<string, { level: number; x: number; y: number }>();

  levels.forEach((ids, colIdx) => {
    const colHeight = Math.max(0, ids.length - 1) * rowSpacing;
    ids.forEach((id, rowIdx) => {
      anchors.set(id, {
        level: colIdx,
        x: colIdx * colSpacing - totalWidth / 2,
        y: rowIdx * rowSpacing - colHeight / 2,
      });
    });
  });

  return anchors;
}

/**
 * Sync simulation nodes with the current graph without resetting existing velocities
 * or positions. New nodes spawn with an underdamped spring-pop scale.
 */
export function syncSimNodes(prevNodes: Map<string, SimNode>, graph: RawGraph): Map<string, SimNode> {
  const anchors = computeTopologicalAnchors(graph);
  const degreeMap = new Map<string, number>();
  for (const n of graph.nodes) degreeMap.set(n.id, 0);
  for (const e of graph.edges) {
    degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
    degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
  }

  const next = new Map<string, SimNode>();
  const isFreshGraph = prevNodes.size === 0;

  for (const n of graph.nodes) {
    const existing = prevNodes.get(n.id);
    const degree = degreeMap.get(n.id) ?? 0;
    const radius = Math.min(27, 19 + Math.min(degree, 5) * 1.4);
    const anchor = anchors.get(n.id) ?? { level: 0, x: 0, y: 0 };

    if (existing) {
      existing.degree = degree;
      existing.radius = radius;
      existing.level = anchor.level;
      existing.flowAnchorX = anchor.x;
      existing.flowAnchorY = anchor.y;
      next.set(n.id, existing);
    } else {
      const spawnX = !isFreshGraph && n.position ? n.position.x : anchor.x;
      const spawnY = !isFreshGraph && n.position ? n.position.y : anchor.y;

      next.set(n.id, {
        id: n.id,
        x: spawnX,
        y: spawnY,
        vx: 0,
        vy: 0,
        radius,
        degree,
        scale: isFreshGraph ? 0.92 : 0.35,
        scaleVel: isFreshGraph ? 0.03 : 0.14,
        alpha: 1,
        glow: isFreshGraph ? 0 : 1,
        level: anchor.level,
        anchorX: spawnX,
        anchorY: spawnY,
        flowAnchorX: anchor.x,
        flowAnchorY: anchor.y,
      });
    }
  }

  return next;
}

/**
 * Advance one physics frame with dt clamped for stability.
 */
export function stepPhysics(
  nodesMap: Map<string, SimNode>,
  edges: RawGraphEdge[],
  params: PhysicsParams,
  dtSec: number,
  options: {
    draggedNodeId: string | null;
    hoveredNodeId: string | null;
    selectedNodeId: string | null;
    focusedIds: Set<string> | null;
    activeNodeIds: Set<string>;
  },
): void {
  const dt = Math.min(0.032, Math.max(0.004, dtSec));
  const stepScale = dt * 60;
  const nodes = Array.from(nodesMap.values());
  const count = nodes.length;

  // 1 & 2. Pairwise Coulomb repulsion + Hooke spring edges (physics mode only; flow mode uses clean topological anchors)
  if (params.layoutMode === "physics") {
    for (let i = 0; i < count; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < count; j++) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 1) {
          dx = (Math.random() - 0.5) * 2;
          dy = (Math.random() - 0.5) * 2;
          distSq = dx * dx + dy * dy;
        }
        const dist = Math.sqrt(distSq);
        const nx = dx / dist;
        const ny = dy / dist;

        // Smooth repulsion force
        const repel = (params.repelStrength / (distSq + 900)) * stepScale;
        const fx = nx * repel;
        const fy = ny * repel;

        if (a.id !== options.draggedNodeId) {
          a.vx -= fx;
          a.vy -= fy;
        }
        if (b.id !== options.draggedNodeId) {
          b.vx += fx;
          b.vy += fy;
        }

        // Soft personal-space boundary so orbs and labels never overlap
        const minDist = a.radius + b.radius + 115;
        if (dist < minDist) {
          const push = (minDist - dist) * 0.095 * stepScale;
          if (a.id !== options.draggedNodeId) {
            a.vx -= nx * push;
            a.vy -= ny * push;
          }
          if (b.id !== options.draggedNodeId) {
            b.vx += nx * push;
            b.vy += ny * push;
          }
        }
      }
    }

    // 2. Hooke spring edges (pulling a node naturally tugs its neighbors)
    for (const edge of edges) {
      const src = nodesMap.get(edge.source);
      const tgt = nodesMap.get(edge.target);
      if (!src || !tgt || src === tgt) continue;

      const dx = tgt.x - src.x;
      const dy = tgt.y - src.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const isLoop = tgt.level <= src.level;
      const restLength = isLoop ? params.linkDistance * 1.45 : params.linkDistance;
      const strength = isLoop ? params.linkStrength * 0.35 : params.linkStrength;
      const displacement = dist - restLength;
      const force = displacement * strength * stepScale;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      if (src.id !== options.draggedNodeId) {
        src.vx += fx;
        src.vy += fy;
      }
      if (tgt.id !== options.draggedNodeId) {
        tgt.vx -= fx;
        tgt.vy -= fy;
      }

      // Gentle forward directional hint in physics mode so flow reads left-to-right
      if (!isLoop) {
        const desiredDx = restLength * 0.55;
        if (dx < desiredDx) {
          const nudge = (desiredDx - dx) * 0.0045 * stepScale;
          if (src.id !== options.draggedNodeId) src.vx -= nudge;
          if (tgt.id !== options.draggedNodeId) tgt.vx += nudge;
        }
      }
    }
  }

  // 3. Elastic anchor springs (with subtle Obsidian neighbor lean when dragging a node)
  const draggedSim = options.draggedNodeId ? (nodesMap.get(options.draggedNodeId) ?? null) : null;
  const draggedNeighbors = new Set<string>();
  if (draggedSim) {
    for (const edge of edges) {
      if (edge.source === draggedSim.id) draggedNeighbors.add(edge.target);
      if (edge.target === draggedSim.id) draggedNeighbors.add(edge.source);
    }
  }

  const dampingFactor = (params.layoutMode === "flow" ? 0.72 : params.damping) ** stepScale;
  for (const n of nodes) {
    if (n.id !== options.draggedNodeId) {
      if (params.layoutMode === "flow") {
        let targetX = n.anchorX;
        let targetY = n.anchorY;
        if (draggedSim && draggedNeighbors.has(n.id)) {
          // Subtle elastic lean toward the dragged neighbor (capped to 18px)
          const pullDx = draggedSim.x - draggedSim.anchorX;
          const pullDy = draggedSim.y - draggedSim.anchorY;
          const pullLen = Math.hypot(pullDx, pullDy);
          const scale = pullLen > 1 ? Math.min(18, pullLen * 0.12) / pullLen : 0;
          targetX += pullDx * scale;
          targetY += pullDy * scale;
        }
        n.vx += (targetX - n.x) * 0.14 * stepScale;
        n.vy += (targetY - n.y) * 0.14 * stepScale;
      } else {
        n.vx += -n.x * params.centerStrength * stepScale;
        n.vy += -n.y * params.centerStrength * stepScale;
      }

      n.vx *= dampingFactor;
      n.vy *= dampingFactor;

      // Clamp peak velocity for tactile stability
      const speed = Math.hypot(n.vx, n.vy);
      if (speed > 28) {
        n.vx = (n.vx / speed) * 28;
        n.vy = (n.vy / speed) * 28;
      }

      n.x += n.vx * stepScale;
      n.y += n.vy * stepScale;
    }

    // Tactile underdamped spring for node scale
    const isDragged = n.id === options.draggedNodeId;
    const isHovered = n.id === options.hoveredNodeId;
    const isSelected = n.id === options.selectedNodeId;
    const targetScale = isDragged ? 1.22 : isSelected ? 1.14 : isHovered ? 1.12 : 1.0;
    const scaleForce = (targetScale - n.scale) * 0.24;
    n.scaleVel = (n.scaleVel + scaleForce * stepScale) * 0.68 ** stepScale;
    n.scale += n.scaleVel * stepScale;

    // Smooth Obsidian spotlight alpha interpolation
    const targetAlpha = !options.focusedIds || options.focusedIds.has(n.id) ? 1 : 0.16;
    n.alpha += (targetAlpha - n.alpha) * Math.min(1, 0.22 * stepScale);

    // Smooth glow interpolation
    const targetGlow = isDragged || isHovered || isSelected || options.activeNodeIds.has(n.id) ? 1 : 0;
    n.glow += (targetGlow - n.glow) * Math.min(1, 0.18 * stepScale);
  }
}

/**
 * Compute quadratic Bezier curve geometry between two nodes, trimming endpoints
 * to node perimeters and bowing loop-back or bidirectional edges cleanly.
 */
export function computeEdgeBezier(
  src: SimNode,
  tgt: SimNode,
  hasReverseEdge: boolean,
  graphCenterY = 0,
): BezierGeometry {
  const dx = tgt.x - src.x;
  const dy = tgt.y - src.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;

  // Normal vector perpendicular to edge
  let nx = -uy;
  let ny = ux;

  const isLoop = tgt.level <= src.level;
  let curveOffset = 0;
  if (isLoop) {
    // Sweep loop-back edges consistently below the centerline so they never flip when nodes sit near y = 0
    const avgY = (src.y + tgt.y) / 2;
    const preferDown = avgY >= graphCenterY - 24;
    if ((preferDown && ny < 0) || (!preferDown && ny > 0)) {
      nx = -nx;
      ny = -ny;
    }
    curveOffset = Math.max(195, Math.min(280, dist * 0.48));
  } else if (hasReverseEdge) {
    curveOffset = 38;
  } else {
    // Subtle organic curve so parallel edges feel crafted
    curveOffset = Math.min(18, dist * 0.045);
  }

  const cx = (src.x + tgt.x) / 2 + nx * curveOffset;
  const cy = (src.y + tgt.y) / 2 + ny * curveOffset;

  // Trim start and end to perimeter of source/target orbs
  const startAngle = Math.atan2(cy - src.y, cx - src.x);
  const endDirAngle = Math.atan2(tgt.y - cy, tgt.x - cx);
  const srcTrim = src.radius * src.scale + 4;
  const tgtTrim = tgt.radius * tgt.scale + 7;

  const sx = src.x + Math.cos(startAngle) * srcTrim;
  const sy = src.y + Math.sin(startAngle) * srcTrim;
  const tx = tgt.x - Math.cos(endDirAngle) * tgtTrim;
  const ty = tgt.y - Math.sin(endDirAngle) * tgtTrim;

  // Midpoint at t = 0.5 on quadratic Bezier
  const midX = 0.25 * sx + 0.5 * cx + 0.25 * tx;
  const midY = 0.25 * sy + 0.5 * cy + 0.25 * ty;

  return { sx, sy, cx, cy, tx, ty, midX, midY, endAngle: endDirAngle, isLoop };
}

/**
 * Evaluate a point on a quadratic Bezier at t in [0, 1].
 */
export function pointOnQuadraticBezier(g: BezierGeometry, t: number): { x: number; y: number } {
  const mt = 1 - t;
  return {
    x: mt * mt * g.sx + 2 * mt * t * g.cx + t * t * g.tx,
    y: mt * mt * g.sy + 2 * mt * t * g.cy + t * t * g.ty,
  };
}

/**
 * Approximate minimum distance from point (px, py) to a quadratic Bezier curve.
 */
export function distanceToBezier(px: number, py: number, g: BezierGeometry): number {
  let minDist = Infinity;
  const samples = 14;
  for (let i = 0; i <= samples; i++) {
    const pt = pointOnQuadraticBezier(g, i / samples);
    const d = Math.hypot(px - pt.x, py - pt.y);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/**
 * Draw crisp geometric vector glyphs inside each canvas node orb, matching
 * Lucide icon weight without relying on emoji or bitmap sprites.
 */
export function drawNodeGlyph(
  ctx: CanvasRenderingContext2D,
  kind: NodeKind,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.65;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const s = size * 0.45;

  switch (kind) {
    case "agent": {
      // Minimal bot head + antenna
      ctx.beginPath();
      ctx.roundRect(-s, -s * 0.65, s * 2, s * 1.45, s * 0.35);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.65);
      ctx.lineTo(0, -s * 1.15);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-s * 0.38, s * 0.05, 1.3, 0, Math.PI * 2);
      ctx.arc(s * 0.38, s * 0.05, 1.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "subagent": {
      // Dual overlapping orbits / users
      ctx.beginPath();
      ctx.arc(-s * 0.3, -s * 0.32, s * 0.36, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s * 0.42, -s * 0.25, s * 0.28, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-s * 0.3, s * 0.85, s * 0.72, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s * 0.42, s * 0.85, s * 0.56, Math.PI * 1.25, Math.PI * 1.85);
      ctx.stroke();
      break;
    }
    case "decision": {
      // Crisp fork diamond/branch
      ctx.beginPath();
      ctx.moveTo(-s * 0.6, s * 0.7);
      ctx.lineTo(-s * 0.6, -s * 0.1);
      ctx.quadraticCurveTo(-s * 0.6, -s * 0.65, 0, -s * 0.65);
      ctx.lineTo(s * 0.6, -s * 0.65);
      ctx.moveTo(-s * 0.6, -s * 0.1);
      ctx.quadraticCurveTo(-s * 0.6, s * 0.35, 0, s * 0.35);
      ctx.lineTo(s * 0.6, s * 0.35);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s * 0.65, -s * 0.65, 1.6, 0, Math.PI * 2);
      ctx.arc(s * 0.65, s * 0.35, 1.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "tool": {
      // Diagonal wrench / precision bolt
      ctx.beginPath();
      ctx.moveTo(-s * 0.7, s * 0.7);
      ctx.lineTo(s * 0.25, -s * 0.25);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s * 0.48, -s * 0.48, s * 0.42, Math.PI * 0.35, Math.PI * 1.65);
      ctx.stroke();
      break;
    }
    case "skill": {
      // Four-point precision spark
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.quadraticCurveTo(0, 0, s, 0);
      ctx.quadraticCurveTo(0, 0, 0, s);
      ctx.quadraticCurveTo(0, 0, -s, 0);
      ctx.quadraticCurveTo(0, 0, 0, -s);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case "checkpoint": {
      // Pause bars inside ring
      ctx.beginPath();
      ctx.moveTo(-s * 0.32, -s * 0.55);
      ctx.lineTo(-s * 0.32, s * 0.55);
      ctx.moveTo(s * 0.32, -s * 0.55);
      ctx.lineTo(s * 0.32, s * 0.55);
      ctx.stroke();
      break;
    }
    case "memory": {
      // Connected knowledge triad
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.7);
      ctx.lineTo(-s * 0.65, s * 0.45);
      ctx.lineTo(s * 0.65, s * 0.45);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -s * 0.7, 1.8, 0, Math.PI * 2);
      ctx.arc(-s * 0.65, s * 0.45, 1.8, 0, Math.PI * 2);
      ctx.arc(s * 0.65, s * 0.45, 1.8, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }

  ctx.restore();
}
