import { Page, Stroke, StrokePoint } from './types';

/**
 * Ink rendering.
 *
 * The Android SDK stores per-point pressure/tilt (SpenObjectStroke.getPressures /
 * getTilts). Chromium exposes the same data on PointerEvent, so we can reproduce
 * pressure-driven variable width with a plain 2D canvas.
 */

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Local width between two samples, driven by pressure. */
function widthFor(a: StrokePoint, b: StrokePoint, base: number): number {
  const pressure = (clamp01(a.p) + clamp01(b.p)) / 2;
  // 0.35 at no pressure -> 1.0 at full pressure. Mouse (p=0.5) gives a steady ~0.68.
  return Math.max(0.5, base * (0.35 + 0.65 * pressure));
}

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const pts = stroke.points;
  if (pts.length === 0) return;

  ctx.save();
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (stroke.tool === 'highlighter') {
    ctx.globalAlpha = 0.32;
    ctx.lineCap = 'butt';
  }

  if (pts.length === 1) {
    const r = widthFor(pts[0], pts[0], stroke.size) / 2;
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  // Quadratic through sample midpoints, one stroke call per segment so the width can vary.
  let prev = pts[0];
  ctx.beginPath();
  ctx.moveTo(prev.x, prev.y);
  for (let i = 1; i < pts.length; i++) {
    const cur = pts[i];
    const mx = (prev.x + cur.x) / 2;
    const my = (prev.y + cur.y) / 2;
    ctx.lineWidth = widthFor(prev, cur, stroke.size);
    ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mx, my);
    prev = cur;
  }
  ctx.lineWidth = widthFor(prev, prev, stroke.size);
  ctx.lineTo(prev.x, prev.y);
  ctx.stroke();

  ctx.restore();
}

export function renderStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[]): void {
  for (const s of strokes) if (!s.erased) drawStroke(ctx, s);
}

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  page: Page,
  cssWidth: number,
  cssHeight: number,
  lineColor: string,
): void {
  const { pattern, spacing } = page.background;
  if (pattern === 'none' || spacing <= 0) return;

  ctx.save();
  ctx.strokeStyle = lineColor;
  ctx.fillStyle = lineColor;
  ctx.lineWidth = 1;

  if (pattern === 'lines' || pattern === 'grid') {
    ctx.beginPath();
    for (let y = spacing; y < cssHeight; y += spacing) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(cssWidth, Math.round(y) + 0.5);
    }
    if (pattern === 'grid') {
      for (let x = spacing; x < cssWidth; x += spacing) {
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, cssHeight);
      }
    }
    ctx.stroke();
  } else if (pattern === 'dots') {
    for (let y = spacing; y < cssHeight; y += spacing) {
      for (let x = spacing; x < cssWidth; x += spacing) {
        ctx.beginPath();
        ctx.arc(x, y, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function strokeBounds(stroke: Stroke): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const pad = stroke.size;
  for (const p of stroke.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

/** Distance from a point to a segment. */
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Topmost stroke under (x, y) within tolerance. */
export function hitTest(strokes: Stroke[], x: number, y: number, tolerance = 6): Stroke | null {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i];
    if (s.erased) continue;
    const tol = Math.max(tolerance, s.size / 2 + 2);
    const pts = s.points;
    if (pts.length === 1) {
      if (Math.hypot(x - pts[0].x, y - pts[0].y) <= tol) return s;
      continue;
    }
    for (let j = 1; j < pts.length; j++) {
      if (distToSegment(x, y, pts[j - 1].x, pts[j - 1].y, pts[j].x, pts[j].y) <= tol) return s;
    }
  }
  return null;
}

export function translateStroke(stroke: Stroke, dx: number, dy: number): void {
  for (const p of stroke.points) {
    p.x += dx;
    p.y += dy;
  }
}

/** Fan-out of the pen "profile": pressure -> width multiplier, for the UI preview. */
export function pressurePreview(curve: StrokePoint[]): number[] {
  return curve.map((p) => 0.35 + 0.65 * clamp01(p.p));
}