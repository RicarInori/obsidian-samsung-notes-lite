import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore - the worker subpath ships no type declaration
import * as pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs';
import { Page, PlacedImage, newId, DEFAULT_PAGE_WIDTH } from './types';

/**
 * PDF import (pdf.js).
 *
 * pdf.js normally runs in a Web Worker, but a plugin cannot serve a worker URL from a
 * real origin, so it falls back to its in-process "fake worker". v5 looks for exactly
 * this global — see `globalThis.pdfjsWorker?.WorkerMessageHandler` in build/pdf.mjs.
 */
(globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = pdfjsWorker;

export interface ImportedPdfPage {
  png: ArrayBuffer;
  width: number;
  height: number;
  sourcePage: number;
}

export interface ImportedPdf {
  pageCount: number;
  pages: ImportedPdfPage[];
}

/** Render every page of a PDF to a PNG at the target width. */
export async function importPdf(data: ArrayBuffer, targetWidth = DEFAULT_PAGE_WIDTH): Promise<ImportedPdf> {
  const doc = await pdfjsLib.getDocument({
    // A copy: pdf.js transfers/detaches the buffer it is given.
    data: new Uint8Array(data),
    useSystemFonts: true,
  }).promise;

  const pageCount = doc.numPages;
  const out: ImportedPdfPage[] = [];
  try {
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = targetWidth / base.width;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法创建 2D 画布上下文');

      // pdf.js types differ between minors; these two fields are the stable contract.
      await (page.render as unknown as (p: unknown) => { promise: Promise<void> })({
        canvasContext: ctx,
        viewport,
      }).promise;

      out.push({
        png: await canvasToPngBuffer(canvas),
        width: canvas.width,
        height: canvas.height,
        sourcePage: i - 1,
      });
    }
  } finally {
    await doc.destroy();
  }
  return { pageCount, pages: out };
}

/** One PDF page becomes one note page, the page image placed full bleed. */
export function pdfPagesToNotePages(imported: ImportedPdf): Page[] {
  return imported.pages.map((p) => {
    const placed: PlacedImage = {
      id: newId('i'),
      asset: '', // filled in once written to the vault
      x: 0,
      y: 0,
      w: p.width,
      h: p.height,
      sourcePage: p.sourcePage,
    };
    return {
      id: newId('p'),
      width: p.width,
      height: p.height,
      canvasType: 'finite' as const,
      background: { pattern: 'none' as const, spacing: 48, color: '' },
      strokes: [],
      images: [placed],
      texts: [],
    };
  });
}

function canvasToPngBuffer(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) reject(new Error('画布导出失败'));
      else resolve(await blob.arrayBuffer());
    }, 'image/png');
  });
}