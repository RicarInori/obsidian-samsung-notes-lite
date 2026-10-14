import { App } from 'obsidian';
import { Page } from './types';
import { renderStrokes, drawBackground } from './ink';
import { readAsset } from './store';

export interface ThemeColors {
  /** Paper colour. */
  pageBackground: string;
  /** Ruled/grid line colour. */
  ruleLine: string;
  /** Default text colour. */
  text: string;
}

export class ImageCache {
  private images = new Map<string, HTMLImageElement>();
  private urls = new Map<string, string>();

  get(path: string): HTMLImageElement | undefined {
    return this.images.get(path);
  }

  async load(app: App, path: string): Promise<HTMLImageElement> {
    const cached = this.images.get(path);
    if (cached) return cached;
    const data = await readAsset(app, path);
    const url = URL.createObjectURL(new Blob([data]));
    this.urls.set(path, url);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`无法加载图片：${path}`));
      img.src = url;
    });
    this.images.set(path, img);
    return img;
  }

  async ensure(app: App, pages: Page[]): Promise<void> {
    const wanted = new Set<string>();
    for (const page of pages) for (const img of page.images) wanted.add(img.asset);
    for (const path of wanted) {
      if (this.images.has(path)) continue;
      try {
        await this.load(app, path);
      } catch {
        /* a missing asset must not break rendering */
      }
    }
  }

  destroy(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.images.clear();
  }
}

/**
 * Draw one note page: paper + background pattern + placed images + strokes + text boxes.
 * Coordinates are page units; `scale` maps them to device pixels.
 */
export function drawPage(
  ctx: CanvasRenderingContext2D,
  page: Page,
  scale: number,
  cache: ImageCache,
  theme: ThemeColors,
): void {
  const width = page.width * scale;
  const height = page.height * scale;

  ctx.save();
  ctx.fillStyle = theme.pageBackground;
  ctx.fillRect(0, 0, width, height);

  // images sit under the ink (imported PDF pages act as the paper)
  for (const placed of page.images) {
    const img = cache.get(placed.asset);
    if (!img) continue;
    ctx.drawImage(img, placed.x * scale, placed.y * scale, placed.w * scale, placed.h * scale);
  }

  drawBackground(ctx, page, width, height, page.background.color || theme.ruleLine);

  ctx.save();
  ctx.scale(scale, scale);
  renderStrokes(ctx, page.strokes);
  ctx.restore();

  // text boxes on top of ink, matching the editor's layering
  for (const box of page.texts) {
    ctx.fillStyle = box.color || theme.text;
    ctx.font = `${box.size}px var(--font-text), -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif`;
    ctx.textBaseline = 'top';
    const maxWidth = box.w;
    wrapText(ctx, box.text, box.x, box.y, maxWidth, box.size * 1.35);
  }

  ctx.restore();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): void {
  let cursorY = y;
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const ch of Array.from(paragraph)) {
      const next = line + ch;
      if (ctx.measureText(next).width > maxWidth && line) {
        ctx.fillText(line, x, cursorY);
        cursorY += lineHeight;
        line = ch;
      } else {
        line = next;
      }
    }
    ctx.fillText(line, x, cursorY);
    cursorY += lineHeight;
  }
}

/** Render a page to a PNG buffer (used by PDF/PNG export and thumbnails). */
export async function renderPageToPng(
  app: App,
  page: Page,
  cache: ImageCache,
  theme: ThemeColors,
  scale = 2,
): Promise<ArrayBuffer> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(page.width * scale);
  canvas.height = Math.round(page.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 2D 画布上下文');
  drawPage(ctx, page, scale, cache, theme);
  return await canvasToArrayBuffer(canvas);
}

export function canvasToArrayBuffer(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error('画布导出失败'));
        return;
      }
      resolve(await blob.arrayBuffer());
    }, 'image/png');
  });
}