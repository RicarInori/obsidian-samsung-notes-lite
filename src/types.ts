/**
 * Data model — deliberately mirrors what the Samsung Notes APK exposes
 * (SpenObject* / SpenContentHandWriting / SpenWPage), so the storage format and the
 * editor share one vocabulary.
 *
 * Ink is stored per point: x, y, pressure, tilt and time — exactly the fields the
 * Android SDK's SpenObjectStroke stores (getXPoints/getYPoints/getPressures/
 * getTilts/getTimeStamps). Pressure+tilt are available in Chromium via PointerEvent.
 */

export type ToolId = 'pen' | 'highlighter' | 'eraser' | 'select' | 'text';

export interface StrokePoint {
  x: number;
  y: number;
  /** 0..1 — 0.5 for a mouse, real pressure for a digitiser pen. */
  p: number;
  /** ms since note open. */
  t: number;
  tiltX?: number;
  tiltY?: number;
}

export interface Stroke {
  id: string;
  tool: 'pen' | 'highlighter';
  color: string;
  /** Base width in page units (px at 100% zoom). */
  size: number;
  /** True for eraser-produced strokes (kept so a future version can soft-erase). */
  erased?: boolean;
  points: StrokePoint[];
}

export type BackgroundPattern = 'none' | 'lines' | 'grid' | 'dots';

export interface PageBackground {
  pattern: BackgroundPattern;
  /** Spacing in page units. */
  spacing: number;
  color: string;
}

export interface PlacedImage {
  id: string;
  /** Vault-relative asset path. */
  asset: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Source PDF page index, when imported from a PDF. */
  sourcePage?: number;
}

export interface TextBox {
  id: string;
  x: number;
  y: number;
  w: number;
  text: string;
  size: number;
  color: string;
}

export interface Page {
  id: string;
  width: number;
  height: number;
  /** finite = fixed page; infinite = endless scroll canvas (Samsung CANVAS_TYPE_*). */
  canvasType: 'finite' | 'infinite';
  background: PageBackground;
  strokes: Stroke[];
  images: PlacedImage[];
  texts: TextBox[];
}

export interface NoteDoc {
  /** Bumped when the on-disk shape changes. */
  version: number;
  title: string;
  created: string;
  modified: string;
  /** Default page size for new pages. */
  pageDefaults: { width: number; height: number };
  pages: Page[];
}

export const NOTE_FORMAT_VERSION = 1;

/** Samsung Notes' default portrait page (1080 x 1527, as used for PDF-created notes). */
export const DEFAULT_PAGE_WIDTH = 1080;
export const DEFAULT_PAGE_HEIGHT = 1527;

export function newId(prefix = 'o'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createPage(width = DEFAULT_PAGE_WIDTH, height = DEFAULT_PAGE_HEIGHT): Page {
  return {
    id: newId('p'),
    width,
    height,
    canvasType: 'finite',
    background: { pattern: 'none', spacing: 48, color: '' },
    strokes: [],
    images: [],
    texts: [],
  };
}

export function createNote(title: string): NoteDoc {
  const now = new Date().toISOString();
  return {
    version: NOTE_FORMAT_VERSION,
    title,
    created: now,
    modified: now,
    pageDefaults: { width: DEFAULT_PAGE_WIDTH, height: DEFAULT_PAGE_HEIGHT },
    pages: [createPage()],
  };
}