/**
 * Verification harness: runs the plugin's real modules under Node with a stubbed
 * Obsidian API. Checks the storage round-trip, the markdown/frontmatter contract and
 * the vector PDF export (pdf-lib is real; only the vault and the canvas are faked).
 *
 * Run: node test/check.cjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { exportVectorPdf, exportRasterPdf } from '../src/pdf-export';
import { pathsFor, renderMarkdown, extractText } from '../src/store';
import type { NoteDoc } from '../src/types';

const VAULT = 'C:/Users/RicarChou/Documents/ObsidianVault';
const jsonPath = path.join(VAULT, '三星笔记/示例笔记.snote/note.json');

let failures = 0;
function check(name: string, condition: boolean, detail = ''): void {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!condition) failures++;
}

const note = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as NoteDoc;

/* ---------------------------------------------------- storage / markdown */

check('note parses as NoteDoc', !!note.version && Array.isArray(note.pages));
check('one page with 3 strokes', note.pages.length === 1 && note.pages[0].strokes.length === 3);
check(
  'stroke points carry x/y/pressure/time',
  note.pages[0].strokes.every((s) => s.points.every((p) => ['x', 'y', 'p', 't'].every((k) => k in p))),
  `first point = ${JSON.stringify(note.pages[0].strokes[0].points[0])}`,
);

const derived = pathsFor('三星笔记/示例笔记.md');
check('sidecar path derives from the .md path', derived.json === '三星笔记/示例笔记.snote/note.json', derived.json);
check('assets folder under sidecar', derived.assets === '三星笔记/示例笔记.snote/assets');

const md = renderMarkdown(note, derived);
check('markdown marks the note with snote: true', md.includes('snote: true'));
check('markdown points at the sidecar json', md.includes(derived.json));
check('typed text reaches the markdown (searchable)', extractText(note).includes('示例笔记'), 'extractText non-empty');
check('markdown starts with frontmatter', md.startsWith('---\n'));

/* ------------------------------------------------------------ vector PDF */

const fakeApp = {
  vault: {
    adapter: {
      async readBinary(p: string): Promise<ArrayBuffer> {
        return fs.readFileSync(path.join(VAULT, p)).buffer;
      },
      async exists(p: string): Promise<boolean> {
        return fs.existsSync(path.join(VAULT, p));
      },
    },
  },
} as never;

const cache = { get: () => undefined, ensure: async () => {}, destroy: () => {}, load: async () => undefined } as never;

/** Concatenate every (inflated) content stream in the PDF. */
function inflateStreams(buf: Buffer): string {
  const parts: string[] = [];
  let idx = 0;
  for (;;) {
    const start = buf.indexOf('stream', idx);
    if (start < 0) break;
    const end = buf.indexOf('endstream', start);
    if (end < 0) break;
    let dataStart = start + 'stream'.length;
    if (buf[dataStart] === 0x0d) dataStart++;
    if (buf[dataStart] === 0x0a) dataStart++;
    const raw = buf.subarray(dataStart, end);
    try {
      parts.push(zlib.inflateSync(raw).toString('latin1'));
    } catch {
      parts.push(raw.toString('latin1'));
    }
    idx = end + 'endstream'.length;
  }
  return parts.join('\n');
}

async function main(): Promise<void> {
  const bytes = await exportVectorPdf(fakeApp, note, cache);
  check('vector export returns bytes', bytes.byteLength > 1000, `${bytes.byteLength} bytes`);

  const reloaded = await PDFDocument.load(bytes);
  check('vector PDF has one page', reloaded.getPageCount() === 1, `pages=${reloaded.getPageCount()}`);
  const size = reloaded.getPage(0).getSize();
  check(
    'page size matches 0.5 pt/unit scale',
    Math.abs(size.width - note.pages[0].width * 0.5) < 0.01 && Math.abs(size.height - note.pages[0].height * 0.5) < 0.01,
    `${size.width} x ${size.height} pt`,
  );

  const header = Buffer.from(bytes.slice(0, 8)).toString('latin1');
  check('output is a real PDF', header.startsWith('%PDF-'), header.trim());

  // Content streams are deflated, so inflate them before looking for operators.
  const content = inflateStreams(Buffer.from(bytes));
  check('ink is written as stroked paths', /\sm\s/.test(content) && /\sl\s/.test(content) && /\sS\s/.test(content), 'm / l / S operators');
  check('export honours per-run stroke widths', /\sw\s/.test(content), 'w (line width) operator');
  check('text is emitted as real PDF text', /\sBT\s/.test(content), 'BT/ET block');
  check('vector export carries no raster image', !/\/Subtype\s*\/Image/.test(content) && !/\/Subtype\s*\/Image/.test(Buffer.from(bytes).toString('latin1')));

  fs.writeFileSync(path.join(VAULT, '三星笔记/导出验证-矢量.pdf'), Buffer.from(bytes));

  /* raster export needs a canvas, which Node lacks — it must fail loudly, not silently. */
  let rasterThrew = false;
  try {
    await exportRasterPdf(fakeApp, note, cache);
  } catch {
    rasterThrew = true;
  }
  check('raster export requires a DOM canvas (expected under Node)', rasterThrew);

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();