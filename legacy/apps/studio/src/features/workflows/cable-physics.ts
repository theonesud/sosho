export interface RopePoint {
  x: number;
  y: number;
  oldX: number;
  oldY: number;
  pinned?: boolean;
}

export interface CableRopeState {
  points: RopePoint[];
  restLength: number;
  lastSx: number;
  lastSy: number;
  lastTx: number;
  lastTy: number;
  energy: number;
}

const SEGMENT_COUNT = 8;
const GRAVITY = 0.55;
const DAMPING = 0.88;
const ITERATIONS = 5;

export function createCableRope(sx: number, sy: number, tx: number, ty: number): CableRopeState {
  const dist = Math.hypot(tx - sx, ty - sy);
  const sag = Math.min(95, Math.max(22, dist * 0.18));
  const points: RopePoint[] = [];

  for (let i = 0; i <= SEGMENT_COUNT; i++) {
    const t = i / SEGMENT_COUNT;
    const x = sx + (tx - sx) * t;
    const arch = Math.sin(t * Math.PI) * sag;
    const y = sy + (ty - sy) * t + arch;
    points.push({
      x,
      y,
      oldX: x,
      oldY: y,
      pinned: i === 0 || i === SEGMENT_COUNT,
    });
  }

  const totalLen = Math.max(40, dist * 1.12 + sag * 0.45);
  return {
    points,
    restLength: totalLen / SEGMENT_COUNT,
    lastSx: sx,
    lastSy: sy,
    lastTx: tx,
    lastTy: ty,
    energy: 0.4,
  };
}

export function stepCableRope(
  state: CableRopeState,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  zipPoints: Array<{ x: number; y: number }> = [],
): boolean {
  const moved = Math.hypot(sx - state.lastSx, sy - state.lastSy) + Math.hypot(tx - state.lastTx, ty - state.lastTy);

  if (moved > 0.25) {
    state.energy = Math.min(4.0, state.energy + moved * 0.08);
    const dist = Math.hypot(tx - sx, ty - sy);
    const sag = Math.min(100, Math.max(24, dist * 0.16));
    state.restLength = Math.max(24, (dist * 1.12 + sag * 0.45) / SEGMENT_COUNT);
    state.lastSx = sx;
    state.lastSy = sy;
    state.lastTx = tx;
    state.lastTy = ty;
  }

  const pts = state.points;
  const lastIdx = pts.length - 1;

  // Pin endpoints with slight horizontal plug lead-out
  pts[0].x = sx;
  pts[0].y = sy;
  pts[0].oldX = sx;
  pts[0].oldY = sy;

  pts[lastIdx].x = tx;
  pts[lastIdx].y = ty;
  pts[lastIdx].oldX = tx;
  pts[lastIdx].oldY = ty;

  // Map zip-tie anchors to nearest interior points
  const pinnedZipIndices = new Map<number, { x: number; y: number }>();
  if (zipPoints.length > 0) {
    for (const zp of zipPoints) {
      let bestIdx = Math.floor(pts.length / 2);
      let bestDist = Number.POSITIVE_INFINITY;
      for (let i = 1; i < lastIdx; i++) {
        const d = Math.hypot(pts[i].x - zp.x, pts[i].y - zp.y);
        if (d < bestDist && !pinnedZipIndices.has(i)) {
          bestDist = d;
          bestIdx = i;
        }
      }
      pinnedZipIndices.set(bestIdx, zp);
    }
  }

  let maxVel = 0;
  for (let i = 1; i < lastIdx; i++) {
    const p = pts[i];
    const zp = pinnedZipIndices.get(i);
    if (zp) {
      p.x = zp.x;
      p.y = zp.y;
      p.oldX = zp.x;
      p.oldY = zp.y;
      continue;
    }

    const vx = (p.x - p.oldX) * DAMPING;
    const vy = (p.y - p.oldY) * DAMPING;
    maxVel = Math.max(maxVel, Math.abs(vx) + Math.abs(vy));

    p.oldX = p.x;
    p.oldY = p.y;
    p.x += vx;
    p.y += vy + GRAVITY;
  }

  // Distance constraints
  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (let i = 0; i < lastIdx; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.0001;
      const diff = (state.restLength - dist) / dist;

      const aPinned = i === 0 || pinnedZipIndices.has(i);
      const bPinned = i + 1 === lastIdx || pinnedZipIndices.has(i + 1);

      if (!aPinned && !bPinned) {
        a.x -= dx * diff * 0.5;
        a.y -= dy * diff * 0.5;
        b.x += dx * diff * 0.5;
        b.y += dy * diff * 0.5;
      } else if (aPinned && !bPinned) {
        b.x += dx * diff;
        b.y += dy * diff;
      } else if (!aPinned && bPinned) {
        a.x -= dx * diff;
        a.y -= dy * diff;
      }
    }

    // Gentle horizontal plug exit force so cables leave jacks cleanly
    if (lastIdx >= 2) {
      pts[1].x += Math.min(18, Math.max(-18, sx + 22 - pts[1].x)) * 0.14;
      pts[lastIdx - 1].x += Math.min(18, Math.max(-18, tx - 22 - pts[lastIdx - 1].x)) * 0.14;
    }
  }

  state.energy = Math.max(0, state.energy * 0.92);
  return moved > 0.25 || maxVel > 0.08 || state.energy > 0.05;
}

export function ropePointsToSvgPath(points: RopePoint[]): string {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)} L ${points[1].x.toFixed(1)} ${points[1].y.toFixed(1)}`;
  }
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const xc = (points[i].x + points[i + 1].x) * 0.5;
    const yc = (points[i].y + points[i + 1].y) * 0.5;
    d += ` Q ${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)}, ${xc.toFixed(1)} ${yc.toFixed(1)}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
  return d;
}
