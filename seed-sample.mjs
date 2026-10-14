/**
 * Dev helper: seed a vault with a sample note (and its sidecar) so the plugin has
 * something to open on first launch.
 *
 * Usage: node seed-sample.mjs "<vault path>" [folder]
 * Example: node seed-sample.mjs "C:/Users/me/Documents/MyVault" 三星笔记
 */
import fs from 'node:fs';
import path from 'node:path';

const VAULT = process.argv[2];
if (!VAULT) {
  console.error('usage: node seed-sample.mjs "<vault path>" [folder]');
  process.exit(1);
}

const folder = process.argv[3] || '三星笔记';
const title = '示例笔记';
const mdPath = `${folder}/${title}.md`;
const sidecar = `${folder}/${title}.snote`;
const jsonPath = `${sidecar}/note.json`;
const iso = new Date().toISOString();

const pid = (prefix, n) => `${prefix}_seed_${n}`;

// A pressure-modulated wave — what a pen stroke with varying pressure looks like.
const wave = [];
for (let i = 0; i <= 60; i++) {
  const t = i / 60;
  wave.push({
    x: 120 + t * 840,
    y: 420 + Math.sin(t * Math.PI * 3) * 90,
    p: 0.15 + 0.85 * Math.abs(Math.sin(t * Math.PI * 1.5)),
    t: i * 12,
  });
}

// A loop, for a signature-ish flourish.
const loop = [];
for (let i = 0; i <= 48; i++) {
  const a = (i / 48) * Math.PI * 2;
  loop.push({
    x: 540 + Math.cos(a) * 150,
    y: 780 + Math.sin(a) * 90,
    p: 0.4 + 0.5 * Math.sin((i / 48) * Math.PI),
    t: 1000 + i * 12,
  });
}

const note = {
  version: 1,
  title,
  created: iso,
  modified: iso,
  pageDefaults: { width: 1080, height: 1527 },
  pages: [
    {
      id: pid('p', 1),
      width: 1080,
      height: 1527,
      canvasType: 'finite',
      background: { pattern: 'lines', spacing: 64, color: '' },
      strokes: [
        { id: pid('s', 1), tool: 'pen', color: '#2f6fed', size: 6, points: wave },
        {
          id: pid('s', 2),
          tool: 'highlighter',
          color: '#ffe066',
          size: 22,
          points: [
            { x: 150, y: 560, p: 0.5, t: 0 },
            { x: 930, y: 575, p: 0.5, t: 120 },
          ],
        },
        { id: pid('s', 3), tool: 'pen', color: '#1f1f1f', size: 3, points: loop },
      ],
      images: [],
      texts: [
        {
          id: pid('t', 1),
          x: 120,
          y: 120,
          w: 820,
          text: '这是 Samsung Notes Lite 的示例笔记。\n用笔或鼠标在页面上书写；文字内容会写进同名 .md，可被 Obsidian 全文搜索。',
          size: 30,
          color: '#1f1f1f',
        },
      ],
    },
  ],
};

const md = `---
snote: true
snote_json: "${jsonPath}"
created: ${iso}
modified: ${iso}
pages: 1
---

# ${title}

> [!note] 三星笔记（手写）
> 该笔记由 **Samsung Notes Lite** 打开编辑：1 页。
> 墨迹数据：\`${jsonPath}\`

### 第 1 页

这是 Samsung Notes Lite 的示例笔记。
用笔或鼠标在页面上书写；文字内容会写进同名 .md，可被 Obsidian 全文搜索。
`;

fs.mkdirSync(path.join(VAULT, sidecar, 'assets'), { recursive: true });
fs.writeFileSync(path.join(VAULT, sidecar, 'note.json'), JSON.stringify(note, null, 2), 'utf8');
fs.writeFileSync(path.join(VAULT, mdPath), md, 'utf8');
console.log('wrote', path.join(VAULT, mdPath), '+', path.join(VAULT, jsonPath));