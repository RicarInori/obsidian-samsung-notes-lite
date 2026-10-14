import { App } from 'obsidian';
import { PDFDocument, StandardFonts, PDFFont, rgb } from 'pdf-lib';
import { NoteDoc } from './types';
import { ImageCache, ThemeColors, renderPageToPng } from './render';
import { readAsset } from './store';

/**
 * PDF export (pdf-lib). Kept separate from `pdf-import.ts` so the export path carries
 * no pdf.js dependency — pdf.js needs DOM globals at module load, pdf-lib does not.
 *
 * Page units -> PDF points: 1080 x 1527 becomes 540 x 763.5 pt (~A4-ish).
 */
export const EXPORT_SCALE = 0.5;

function hexToRgb(hex: string) {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = Number.parseInt(full, 16);
  if (Number.isNaN(num)) return rgb(0, 0, 0);
  return rgb(((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255);
}

/** pdf-lib's standard fonts are WinAnsi; drop anything they cannot encode. */
function sanitizeWinAnsi(text: string): string {
  let out = '';
  for (const ch of text) {
    if (ch === '\n') {
      out += '\n';
      continue;
    }
    const code = ch.codePointAt(0) ?? 0;
    out += code >= 32 && code <= 126 ? ch : '?';
  }
  return out;
}

function pressure(p: number): number {
  const c = p < 0 ? 0 : p > 1 ? 1 : p;
  return 0.35 + 0.65 * c;
}

function widthOf(a: { p: number }, b: { p: number }, base: number): number {
  return Math.max(0.5, base * ((pressure(a.p) + pressure(b.p)) / 2));
}

function strokePath(
  page: ReturnType<PDFDocument['addPage']>,
  pathData: string,
  height: number,
  width: number,
  color: ReturnType<typeof rgb>,
  opacity: number,
): void {
  page.drawSvgPath(pathData, {
    x: 0,
    y: height,
    borderColor: color,
    borderWidth: Math.max(0.3, width * EXPORT_SCALE),
    borderOpacity: opacity,
  });
}

/** Raster export: each page as it renders, one PNG per PDF page. */
export async function exportRasterPdf(
  app: App,
  note: NoteDoc,
  cache: ImageCache,
  theme: ThemeColors,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (const page of note.pages) {
    const png = await renderPageToPng(app, page, cache, theme, 2);
    const image = await pdf.embedPng(png);
    const width = page.width * EXPORT_SCALE;
    const height = page.height * EXPORT_SCALE;
    const pdfPage = pdf.addPage([width, height]);
    pdfPage.drawImage(image, { x: 0, y: 0, width, height });
  }
  return await pdf.save();
}

/**
 * Vector export: strokes become stroked SVG paths, text becomes real text.
 * Width is held constant per run (pressure changes split the run) — the Android SDK's
 * PDF_EXPORT_TYPE_VECTOR has no equivalent here because its ink engine is native.
 */
export async function exportVectorPdf(app: App, note: NoteDoc, cache: ImageCache): Promise<Uint8Array> {
  void cache;
  const pdf = await PDFDocument.create();
  const font: PDFFont = await pdf.embedFont(StandardFonts.Helvetica);

  for (const page of note.pages) {
    const width = page.width * EXPORT_SCALE;
    const height = page.height * EXPORT_SCALE;
    const pdfPage = pdf.addPage([width, height]);

    for (const placed of page.images) {
      try {
        const bytes = await readAsset(app, placed.asset);
        const image = await pdf.embedPng(bytes);
        pdfPage.drawImage(image, {
          x: placed.x * EXPORT_SCALE,
          y: height - (placed.y + placed.h) * EXPORT_SCALE,
          width: placed.w * EXPORT_SCALE,
          height: placed.h * EXPORT_SCALE,
        });
      } catch {
        /* skip an unreadable asset rather than failing the whole export */
      }
    }

    for (const stroke of page.strokes) {
      if (stroke.erased || stroke.points.length === 0) continue;
      const color = hexToRgb(stroke.color);
      const opacity = stroke.tool === 'highlighter' ? 0.32 : 1;
      const points = stroke.points;

      if (points.length === 1) {
        const r = (stroke.size * pressure(points[0].p)) / 2;
        pdfPage.drawCircle({
          x: points[0].x * EXPORT_SCALE,
          y: height - points[0].y * EXPORT_SCALE,
          size: Math.max(0.3, r * EXPORT_SCALE),
          color,
          opacity,
        });
        continue;
      }

      let runPath = `M ${points[0].x} ${points[0].y}`;
      let runWidth = widthOf(points[0], points[1], stroke.size);
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        const segmentWidth = widthOf(a, b, stroke.size);
        if (Math.abs(segmentWidth - runWidth) > 0.35 && runPath.length > 2) {
          strokePath(pdfPage, runPath, height, runWidth, color, opacity);
          runPath = `M ${a.x} ${a.y}`;
          runWidth = segmentWidth;
        }
        runPath += ` L ${b.x} ${b.y}`;
      }
      strokePath(pdfPage, runPath, height, runWidth, color, opacity);
    }

    for (const box of page.texts) {
      const size = box.size * EXPORT_SCALE * 1.2;
      sanitizeWinAnsi(box.text)
        .split('\n')
        .forEach((line, index) => {
          pdfPage.drawText(line || ' ', {
            x: box.x * EXPORT_SCALE,
            y: height - (box.y + index * box.size * 1.35) * EXPORT_SCALE - size,
            size,
            font,
            color: hexToRgb(box.color || '#000000'),
          });
        });
    }
  }
  return await pdf.save();
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}