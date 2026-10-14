import { App, TFile, TFolder, normalizePath, Notice } from 'obsidian';
import { NoteDoc, createNote, NOTE_FORMAT_VERSION } from './types';

/**
 * Vault-native storage.
 *
 *   Notes/Foo.md                  <- markdown: frontmatter + extracted text (so Obsidian's
 *                                    own search, backlinks and graph all work)
 *   Notes/Foo.snote/note.json     <- the ink document (pages / strokes / images / text)
 *   Notes/Foo.snote/assets/*.png  <- imported PDF pages and images
 *
 * The sidecar path is derived from the markdown path by convention, so nothing has to be
 * parsed to find it.
 */

export interface NotePaths {
  md: string;
  dir: string;
  json: string;
  assets: string;
}

export function pathsFor(mdPath: string): NotePaths {
  const normalized = normalizePath(mdPath);
  const dir = normalized.replace(/\.md$/i, '.snote');
  return { md: normalized, dir, json: `${dir}/note.json`, assets: `${dir}/assets` };
}

async function ensureFolder(app: App, folder: string): Promise<void> {
  const parts = normalizePath(folder).split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!(await app.vault.adapter.exists(current))) {
      try {
        await app.vault.adapter.mkdir(current);
      } catch (e) {
        if (!(await app.vault.adapter.exists(current))) throw e;
      }
    }
  }
}

/** Unique vault path for a new note (adds " 2", " 3", … like Obsidian does). */
export async function uniqueNotePath(app: App, folder: string, title: string): Promise<string> {
  const base = normalizePath(folder ? `${folder}/${title}` : title);
  for (let i = 1; i < 500; i++) {
    const candidate = i === 1 ? `${base}.md` : `${base} ${i}.md`;
    if (!(await app.vault.adapter.exists(candidate))) return candidate;
  }
  return `${base} ${Date.now()}.md`;
}

export function extractText(note: NoteDoc): string {
  const out: string[] = [];
  note.pages.forEach((page, index) => {
    const texts = page.texts.map((t) => t.text.trim()).filter(Boolean);
    if (texts.length) out.push(`### 第 ${index + 1} 页\n\n${texts.join('\n\n')}`);
  });
  return out.join('\n\n');
}

export function renderMarkdown(note: NoteDoc, paths: NotePaths): string {
  const text = extractText(note);
  const front = [
    '---',
    'snote: true',
    `snote_json: "${paths.json}"`,
    `created: ${note.created}`,
    `modified: ${note.modified}`,
    `pages: ${note.pages.length}`,
    '---',
    '',
  ].join('\n');
  const body = [
    `# ${note.title}`,
    '',
    `> [!note] 三星笔记（手写）`,
    `> 该笔记由 **Samsung Notes Lite** 打开编辑：${note.pages.length} 页。`,
    `> 墨迹数据：\`${paths.json}\``,
    '',
    text || '_（暂无文字内容；手写笔迹不会进入全文搜索。）_',
    '',
  ].join('\n');
  return front + body;
}

export async function createNoteOnDisk(
  app: App,
  folder: string,
  title: string,
): Promise<{ note: NoteDoc; paths: NotePaths }> {
  const mdPath = await uniqueNotePath(app, folder, title);
  const paths = pathsFor(mdPath);
  const note = createNote(title);

  await ensureFolder(app, paths.dir);
  await ensureFolder(app, paths.assets);
  await app.vault.adapter.write(paths.json, JSON.stringify(note, null, 2));
  await app.vault.create(paths.md, renderMarkdown(note, paths));

  return { note, paths };
}

export async function loadNote(app: App, mdPath: string): Promise<{ note: NoteDoc; paths: NotePaths }> {
  const paths = pathsFor(mdPath);
  if (!(await app.vault.adapter.exists(paths.json))) {
    throw new Error(`找不到墨迹数据：${paths.json}`);
  }
  const raw = await app.vault.adapter.read(paths.json);
  const note = JSON.parse(raw) as NoteDoc;
  note.version ??= NOTE_FORMAT_VERSION;
  note.pages ??= [];
  return { note, paths };
}

export async function saveNote(app: App, note: NoteDoc, paths: NotePaths): Promise<void> {
  note.modified = new Date().toISOString();
  await ensureFolder(app, paths.dir);
  await app.vault.adapter.write(paths.json, JSON.stringify(note, null, 2));

  const md = app.vault.getAbstractFileByPath(paths.md);
  const content = renderMarkdown(note, paths);
  if (md instanceof TFile) {
    await app.vault.modify(md, content);
  } else if (!(await app.vault.adapter.exists(paths.md))) {
    await app.vault.create(paths.md, content);
  } else {
    await app.vault.adapter.write(paths.md, content);
  }
}

export async function writeAsset(app: App, paths: NotePaths, name: string, data: ArrayBuffer): Promise<string> {
  await ensureFolder(app, paths.assets);
  const asset = `${paths.assets}/${name}`;
  await app.vault.adapter.writeBinary(asset, data);
  return asset;
}

export async function readAsset(app: App, assetPath: string): Promise<ArrayBuffer> {
  return await app.vault.adapter.readBinary(assetPath);
}

/** All notes created by this plugin, newest first. */
export function listNotes(app: App): TFile[] {
  return app.vault
    .getMarkdownFiles()
    .filter((f) => f.path.toLowerCase().endsWith('.md') && isSNote(app, f))
    .sort((a, b) => b.stat.mtime - a.stat.mtime);
}

export function isSNote(app: App, file: TFile): boolean {
  const cache = app.metadataCache.getFileCache(file);
  return !!cache?.frontmatter?.snote;
}

export function noteFolder(app: App, file: TFile): string {
  const parent = file.parent;
  if (!parent || parent instanceof TFolder === false) return '';
  return parent.path === '/' ? '' : parent.path;
}

export async function openOrCreate(
  app: App,
  folder: string,
  title: string,
): Promise<{ note: NoteDoc; paths: NotePaths }> {
  const trimmed = title.trim() || '未命名笔记';
  try {
    return await createNoteOnDisk(app, folder, trimmed);
  } catch (e) {
    new Notice(`创建笔记失败：${(e as Error).message}`);
    throw e;
  }
}