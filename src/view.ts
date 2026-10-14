import { ItemView, WorkspaceLeaf, Notice, setIcon, ViewStateResult, Modal, App } from 'obsidian';
import type SNotePlugin from './main';
import {
  NoteDoc,
  Page,
  Stroke,
  StrokePoint,
  ToolId,
  BackgroundPattern,
  createPage,
  newId,
  DEFAULT_PAGE_WIDTH,
} from './types';
import { NotePaths, loadNote, saveNote, writeAsset } from './store';
import { drawPage, ImageCache, ThemeColors, renderPageToPng } from './render';
import { hitTest, translateStroke, drawStroke } from './ink';
import { importPdf } from './pdf-import';
import { exportRasterPdf, exportVectorPdf, toArrayBuffer } from './pdf-export';

export const SNL_VIEW_TYPE = 'snl-editor';

const PEN_COLORS = ['#1f1f1f', '#2f6fed', '#e5484d', '#f5a524', '#30a46c', '#8e4ec6', '#ffffff'];
const HIGHLIGHT_COLORS = ['#ffe066', '#8ce99a', '#99e9f2', '#ffc9c9', '#d0bfff', '#ffd8a8'];

interface Snapshot {
  json: string;
}

export class SNoteView extends ItemView {
  plugin: SNotePlugin;

  private note: NoteDoc | null = null;
  private paths: NotePaths | null = null;
  private pendingPath: string | null = null;

  private cache = new ImageCache();
  private tool: ToolId = 'pen';
  private color = PEN_COLORS[0];
  private penSize = 4;
  private zoom = 1;
  private pageIndex = 0;

  private baseCanvas!: HTMLCanvasElement;
  private liveCanvas!: HTMLCanvasElement;
  private paperEl!: HTMLElement;
  private scrollEl!: HTMLElement;
  private pagesPanel!: HTMLElement;
  private optionsRow!: HTMLElement;
  private titleEl!: HTMLInputElement;
  private statusEl!: HTMLElement;
  private pageLabel!: HTMLElement;

  private active: Stroke | null = null;
  private selected: Stroke | null = null;
  private dragging = false;
  private lastPointer: { x: number; y: number } | null = null;
  private frameQueued = false;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private saveTimer: number | null = null;
  private showPages = true;

  constructor(leaf: WorkspaceLeaf, plugin: SNotePlugin) {
    super(leaf);
    this.plugin = plugin;
    // Obsidian's view base class runs `this.titleEl.setText(this.getDisplayText())` during
    // load(), before onOpen(). A registered ItemView is not always given a titleEl, and when
    // it is missing the whole view silently fails to open (onOpen never runs). Provide one.
    const base = this as unknown as { titleEl?: HTMLElement };
    if (!base.titleEl) base.titleEl = document.createElement('div');
  }

  getViewType(): string {
    return SNL_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.note?.title ? `三星笔记：${this.note.title}` : '三星笔记';
  }

  getIcon(): string {
    return 'pencil';
  }

  getState(): Record<string, unknown> {
    return { path: this.paths?.md ?? null };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const path = (state as { path?: string } | undefined)?.path ?? null;
    this.pendingPath = path;
    await super.setState(state, result);
  }

  async onOpen(): Promise<void> {
    // A blank view on mobile told us nothing, so failures are rendered in place.
    try {
      this.buildLayout();
      // setState is not guaranteed to have run before onOpen, so fall back to the
      // leaf's own requested state (and to our own persisted state last).
      const leafState = (this.leaf as unknown as { getViewState?: () => { state?: { path?: string } } })
        .getViewState?.()?.state;
      const path =
        this.pendingPath ??
        leafState?.path ??
        ((this.getState().path as string | null) ?? null);
      if (path) {
        await this.openPath(path);
      } else {
        this.renderEmptyState();
      }
    } catch (e) {
      const message = (e as Error)?.message ?? String(e);
      const box = document.createElement('div');
      box.className = 'snl-empty';
      const title = document.createElement('div');
      title.className = 'snl-empty-title';
      title.textContent = '三星笔记视图启动失败';
      const detail = document.createElement('div');
      detail.className = 'snl-empty-sub';
      detail.textContent = message;
      box.appendChild(title);
      box.appendChild(detail);
      this.contentEl.appendChild(box);
      new Notice(`三星笔记视图失败：${message}`);
    }
  }

  async onClose(): Promise<void> {
    this.flushSave();
    this.cache.destroy();
    this.contentEl.empty();
  }

  /* ------------------------------------------------------------ public API */

  async openPath(path: string): Promise<void> {
    try {
      const { note, paths } = await loadNote(this.app, path);
      this.note = note;
      this.paths = paths;
      this.pageIndex = 0;
      this.undoStack = [];
      this.redoStack = [];
      await this.cache.ensure(this.app, note.pages);
      this.titleEl.value = note.title;
      this.renderAll();
      this.setStatus(`已打开 ${paths.md}`);
    } catch (e) {
      new Notice(`无法打开笔记：${(e as Error).message}`);
      this.renderEmptyState();
    }
  }

  /* --------------------------------------------------------------- layout */

  private buildLayout(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('snl-root');

    // --- title / app bar
    const appbar = document.createElement('div');
    appbar.className = 'snl-appbar';
    const pagesToggle = this.iconButton('list', '页面缩略图', () => {
      this.showPages = !this.showPages;
      this.pagesPanel.toggleClass('snl-hidden', !this.showPages);
    });
    appbar.appendChild(pagesToggle);

    this.titleEl = document.createElement('input');
    this.titleEl.className = 'snl-title';
    this.titleEl.placeholder = '未命名笔记';
    this.titleEl.addEventListener('change', () => {
      if (!this.note) return;
      this.pushUndo();
      this.note.title = this.titleEl.value.trim() || '未命名笔记';
      this.scheduleSave();
      this.renderPagesPanel();
    });
    appbar.appendChild(this.titleEl);

    this.pageLabel = document.createElement('span');
    this.pageLabel.className = 'snl-pagelabel';
    appbar.appendChild(this.pageLabel);

    appbar.appendChild(this.iconButton('zoom-out', '缩小', () => this.setZoom(this.zoom - 0.15)));
    appbar.appendChild(this.iconButton('zoom-in', '放大', () => this.setZoom(this.zoom + 0.15)));
    appbar.appendChild(this.iconButton('file-up', '导入 PDF', () => this.pickPdf()));
    appbar.appendChild(this.iconButton('download', '导出', (evt) => this.showExportMenu(evt)));
    root.appendChild(appbar);

    // --- tool row
    const toolbar = document.createElement('div');
    toolbar.className = 'snl-toolbar';
    const tools: Array<[ToolId, string, string]> = [
      ['pen', 'pencil', '钢笔'],
      ['highlighter', 'highlighter', '荧光笔'],
      ['eraser', 'eraser', '橡皮'],
      ['select', 'mouse-pointer-2', '选择'],
      ['text', 'type', '文本'],
    ];
    this.toolButtons = new Map();
    for (const [id, icon, label] of tools) {
      const btn = this.iconButton(icon, label, () => this.setTool(id));
      btn.addClass('snl-tool');
      this.toolButtons.set(id, btn);
      toolbar.appendChild(btn);
    }
    const spacer = document.createElement('div');
    spacer.className = 'snl-spacer';
    toolbar.appendChild(spacer);
    toolbar.appendChild(this.iconButton('undo-2', '撤销', () => this.undo()));
    toolbar.appendChild(this.iconButton('redo-2', '重做', () => this.redo()));
    toolbar.appendChild(this.iconButton('file-plus', '新增页', () => this.addPage()));
    toolbar.appendChild(this.iconButton('trash-2', '删除当前页', () => this.deletePage()));
    root.appendChild(toolbar);

    // --- pen options row
    this.optionsRow = document.createElement('div');
    this.optionsRow.className = 'snl-options';
    root.appendChild(this.optionsRow);

    // --- body: page list + canvas
    const body = document.createElement('div');
    body.className = 'snl-body';

    this.pagesPanel = document.createElement('div');
    this.pagesPanel.className = 'snl-pages';
    body.appendChild(this.pagesPanel);

    this.scrollEl = document.createElement('div');
    this.scrollEl.className = 'snl-scroll';
    this.paperEl = document.createElement('div');
    this.paperEl.className = 'snl-paper';

    this.baseCanvas = document.createElement('canvas');
    this.baseCanvas.className = 'snl-canvas';
    this.liveCanvas = document.createElement('canvas');
    this.liveCanvas.className = 'snl-canvas snl-canvas-live';
    this.paperEl.appendChild(this.baseCanvas);
    this.paperEl.appendChild(this.liveCanvas);
    this.scrollEl.appendChild(this.paperEl);
    body.appendChild(this.scrollEl);
    root.appendChild(body);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'snl-status';
    root.appendChild(this.statusEl);

    this.bindPointer();
    this.setTool('pen');
    this.renderOptions();
  }

  private toolButtons!: Map<ToolId, HTMLElement>;

  private iconButton(icon: string, label: string, onClick: (evt: MouseEvent) => void): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'snl-btn clickable-icon';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    try {
      setIcon(btn, icon);
    } catch {
      /* fall through to the text fallback below */
    }
    if (!btn.querySelector('svg')) btn.textContent = label.slice(0, 2);
    btn.addEventListener('click', (evt) => onClick(evt));
    return btn;
  }

  /* ------------------------------------------------------------- rendering */

  private theme(): ThemeColors {
    const styles = getComputedStyle(document.body);
    return {
      pageBackground: styles.getPropertyValue('--background-primary').trim() || '#ffffff',
      ruleLine: styles.getPropertyValue('--background-modifier-border').trim() || '#cccccc',
      text: styles.getPropertyValue('--text-normal').trim() || '#1f1f1f',
    };
  }

  private currentPage(): Page | null {
    if (!this.note) return null;
    return this.note.pages[Math.min(this.pageIndex, this.note.pages.length - 1)] ?? null;
  }

  private renderAll(): void {
    // a previous empty-state (or error) placeholder must not sit on top of the pages
    this.paperEl?.querySelector('.snl-empty')?.remove();
    this.renderOptions();
    this.renderPagesPanel();
    this.layoutCanvases();
    this.redrawBase();
    this.renderLive();
    this.updateChrome();
  }

  private layoutCanvases(): void {
    const page = this.currentPage();
    if (!page) return;
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = page.width * this.zoom;
    const cssHeight = page.height * this.zoom;
    this.paperEl.style.width = `${cssWidth}px`;
    this.paperEl.style.height = `${cssHeight}px`;
    for (const canvas of [this.baseCanvas, this.liveCanvas]) {
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
    }
  }

  private ctxOf(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建 2D 画布上下文');
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  private redrawBase(): void {
    const page = this.currentPage();
    if (!page) return;
    const ctx = this.ctxOf(this.baseCanvas);
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, this.baseCanvas.width / dpr, this.baseCanvas.height / dpr);
    ctx.save();
    ctx.scale(this.zoom, this.zoom);
    drawPage(ctx, page, 1, this.cache, this.theme());
    ctx.restore();
  }

  private queueLive(): void {
    if (this.frameQueued) return;
    this.frameQueued = true;
    window.requestAnimationFrame(() => {
      this.frameQueued = false;
      this.renderLive();
    });
  }

  private renderLive(): void {
    const page = this.currentPage();
    if (!page || !this.liveCanvas) return;
    const ctx = this.ctxOf(this.liveCanvas);
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, this.liveCanvas.width / dpr, this.liveCanvas.height / dpr);
    ctx.save();
    ctx.scale(this.zoom, this.zoom);
    if (this.active) drawStroke(ctx, this.active);
    if (this.selected) {
      ctx.save();
      ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--interactive-accent').trim() || '#7c5cff';
      ctx.setLineDash([6 / this.zoom, 5 / this.zoom]);
      ctx.lineWidth = 1.5 / this.zoom;
      for (const p of this.selected.points) ctx.strokeRect(p.x - 2, p.y - 2, 4, 4);
      ctx.restore();
    }
    ctx.restore();
  }

  private renderEmptyState(): void {
    if (!this.paperEl) return;
    // The canvases live inside .snl-paper. Emptying it detaches them permanently, and a
    // detached canvas can never be drawn on or receive events — drawing stayed dead even
    // after a note was opened. Keep the canvas stack; add the hint as an overlay.
    this.paperEl.querySelector('.snl-empty')?.remove();
    const box = document.createElement('div');
    box.className = 'snl-empty';
    const title = document.createElement('div');
    title.className = 'snl-empty-title';
    title.textContent = '还没有打开笔记';
    const sub = document.createElement('div');
    sub.className = 'snl-empty-sub';
    sub.textContent = '点击左侧栏图标，或用命令面板「Samsung Notes Lite: 创建三星笔记」开始。';
    box.appendChild(title);
    box.appendChild(sub);
    this.paperEl.appendChild(box);
  }

  private renderOptions(): void {
    if (!this.optionsRow) return;
    this.optionsRow.empty();
    const isInk = this.tool === 'pen' || this.tool === 'highlighter';
    this.optionsRow.toggleClass('snl-hidden', !isInk);

    const palette = this.tool === 'highlighter' ? HIGHLIGHT_COLORS : PEN_COLORS;
    for (const hex of palette) {
      const swatch = document.createElement('button');
      swatch.className = 'snl-swatch';
      swatch.style.background = hex;
      swatch.title = hex;
      swatch.toggleClass('is-active', this.color.toLowerCase() === hex.toLowerCase());
      swatch.addEventListener('click', () => {
        this.color = hex;
        this.renderOptions();
      });
      this.optionsRow.appendChild(swatch);
    }

    const sizeWrap = document.createElement('label');
    sizeWrap.className = 'snl-size';
    sizeWrap.textContent = '粗细';

    const preview = document.createElement('canvas');
    preview.className = 'snl-preview';
    preview.width = 96;
    preview.height = 24;
    const drawPreview = () => {
      const pctx = preview.getContext('2d');
      if (!pctx) return;
      pctx.clearRect(0, 0, preview.width, preview.height);
      pctx.strokeStyle = this.color;
      pctx.lineCap = 'round';
      pctx.lineWidth = Math.max(1, Math.min(this.penSize, 22));
      pctx.beginPath();
      pctx.moveTo(6, 16);
      pctx.quadraticCurveTo(48, 2, 90, 16);
      pctx.stroke();
    };
    drawPreview();

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '1';
    slider.max = '40';
    slider.value = String(this.penSize);
    slider.addEventListener('input', () => {
      this.penSize = Number(slider.value);
      drawPreview();
    });
    sizeWrap.appendChild(slider);
    sizeWrap.appendChild(preview);

    const bgWrap = document.createElement('label');
    bgWrap.className = 'snl-size';
    bgWrap.textContent = '背景';
    const select = document.createElement('select');
    const patterns: Array<[BackgroundPattern, string]> = [
      ['none', '无'],
      ['lines', '横线'],
      ['grid', '网格'],
      ['dots', '点阵'],
    ];
    for (const [value, label] of patterns) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      if (this.currentPage()?.background.pattern === value) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      const page = this.currentPage();
      if (!page) return;
      this.pushUndo();
      page.background.pattern = select.value as BackgroundPattern;
      this.scheduleSave();
      this.redrawBase();
      this.renderPagesPanel();
    });
    bgWrap.appendChild(select);

    this.optionsRow.appendChild(sizeWrap);
    this.optionsRow.appendChild(bgWrap);
  }

  private renderPagesPanel(): void {
    if (!this.pagesPanel || !this.note) return;
    this.pagesPanel.empty();
    const theme = this.theme();
    const targetWidth = 108;
    this.note.pages.forEach((page, index) => {
      const item = document.createElement('button');
      item.className = 'snl-pageitem';
      item.toggleClass('is-active', index === this.pageIndex);
      const canvas = document.createElement('canvas');
      const scale = targetWidth / page.width;
      canvas.width = Math.max(1, Math.round(page.width * scale));
      canvas.height = Math.max(1, Math.round(page.height * scale));
      const ctx = canvas.getContext('2d');
      if (ctx) drawPage(ctx, page, scale, this.cache, theme);
      const label = document.createElement('span');
      label.textContent = String(index + 1);
      item.appendChild(canvas);
      item.appendChild(label);
      item.addEventListener('click', () => this.gotoPage(index));
      this.pagesPanel.appendChild(item);
    });
  }

  private updateChrome(): void {
    if (!this.note) return;
    this.pageLabel.textContent = `${this.pageIndex + 1} / ${this.note.pages.length}`;
    for (const [id, btn] of this.toolButtons) btn.toggleClass('is-active', id === this.tool);
  }

  /* ---------------------------------------------------------- interaction */

  private setTool(tool: ToolId): void {
    this.tool = tool;
    this.selected = null;
    if (tool === 'pen' && HIGHLIGHT_COLORS.includes(this.color)) this.color = PEN_COLORS[0];
    if (tool === 'highlighter' && PEN_COLORS.includes(this.color)) this.color = HIGHLIGHT_COLORS[0];
    this.renderOptions();
    this.updateChrome();
    this.renderLive();
  }

  private setZoom(next: number): void {
    this.zoom = Math.min(3, Math.max(0.3, Number(next.toFixed(2))));
    this.layoutCanvases();
    this.redrawBase();
    this.renderLive();
  }

  private gotoPage(index: number): void {
    if (!this.note) return;
    if (index < 0 || index >= this.note.pages.length) return;
    this.flushSave();
    this.pageIndex = index;
    this.selected = null;
    this.renderAll();
    this.scrollEl.scrollTop = 0;
  }

  private toPageCoords(evt: PointerEvent): { x: number; y: number } {
    const rect = this.liveCanvas.getBoundingClientRect();
    return {
      x: (evt.clientX - rect.left) / this.zoom,
      y: (evt.clientY - rect.top) / this.zoom,
    };
  }

  private bindPointer(): void {
    const canvas = this.liveCanvas;
    canvas.addEventListener('pointerdown', (evt) => {
      if (!this.note) return;
      const page = this.currentPage();
      if (!page) return;
      const pt = this.toPageCoords(evt);

      if (this.tool === 'pen' || this.tool === 'highlighter') {
        canvas.setPointerCapture(evt.pointerId);
        this.pushUndo();
        this.active = {
          id: newId('s'),
          tool: this.tool,
          color: this.color,
          size: this.penSize * (this.tool === 'highlighter' ? 4 : 1),
          points: [this.pointFrom(evt, pt)],
        };
        this.queueLive();
        return;
      }

      if (this.tool === 'eraser') {
        const hit = hitTest(page.strokes, pt.x, pt.y, 6 / this.zoom);
        if (hit) {
          this.pushUndo();
          page.strokes = page.strokes.filter((s) => s !== hit);
          this.scheduleSave();
          this.redrawBase();
          this.renderPagesPanel();
        }
        return;
      }

      if (this.tool === 'select') {
        const hit = hitTest(page.strokes, pt.x, pt.y, 6 / this.zoom);
        this.selected = hit;
        this.dragging = !!hit;
        this.lastPointer = pt;
        if (hit) canvas.setPointerCapture(evt.pointerId);
        this.queueLive();
        return;
      }

      if (this.tool === 'text') {
        // A modal, not window.prompt: Android WebView (Obsidian mobile) does not
        // reliably implement the blocking dialog APIs.
        new TextInputModal(this.app, (text) => {
          const target = this.currentPage();
          if (!target || !text.trim()) return;
          this.pushUndo();
          target.texts.push({
            id: newId('t'),
            x: pt.x,
            y: pt.y,
            w: Math.min(600, Math.max(160, target.width - pt.x)),
            text: text.trim(),
            size: 28,
            color: this.color,
          });
          this.scheduleSave();
          this.redrawBase();
          this.renderPagesPanel();
        }).open();
      }
    });

    canvas.addEventListener('pointermove', (evt) => {
      const page = this.currentPage();
      if (!page) return;

      if (this.active) {
        const events = this.coalesced(evt);
        for (const e of events) this.active.points.push(this.pointFrom(e, this.toPageCoords(e)));
        this.queueLive();
        return;
      }

      if (this.tool === 'select' && this.dragging && this.selected && this.lastPointer) {
        const pt = this.toPageCoords(evt);
        translateStroke(this.selected, pt.x - this.lastPointer.x, pt.y - this.lastPointer.y);
        this.lastPointer = pt;
        this.queueLive();
      }
    });

    const finish = () => {
      if (this.active) {
        const page = this.currentPage();
        if (page && this.active.points.length > 0) {
          page.strokes.push(this.active);
          this.scheduleSave();
          this.renderPagesPanel();
        }
        this.active = null;
        this.redrawBase();
        this.renderLive();
      }
      if (this.dragging) {
        this.dragging = false;
        this.scheduleSave();
        this.redrawBase();
      }
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
  }

  private coalesced(evt: PointerEvent): PointerEvent[] {
    const anyEvt = evt as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] };
    try {
      const list = anyEvt.getCoalescedEvents?.();
      if (list && list.length) return list;
    } catch {
      /* older engines */
    }
    return [evt];
  }

  private pointFrom(evt: PointerEvent, pt: { x: number; y: number }): StrokePoint {
    // In Chromium, mouse/touch give 0.5; a digitiser pen gives the real value.
    const rawPressure = typeof evt.pressure === 'number' && evt.pressure > 0 ? evt.pressure : 0.5;
    return {
      x: pt.x,
      y: pt.y,
      p: rawPressure,
      t: performance.now(),
      tiltX: evt.tiltX,
      tiltY: evt.tiltY,
    };
  }

  /* -------------------------------------------------------------- history */

  private pushUndo(): void {
    if (!this.note) return;
    this.undoStack.push({ json: JSON.stringify(this.note) });
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
  }

  private undo(): void {
    const snapshot = this.undoStack.pop();
    if (!snapshot || !this.note) return;
    this.redoStack.push({ json: JSON.stringify(this.note) });
    this.note = JSON.parse(snapshot.json) as NoteDoc;
    this.applyReload();
  }

  private redo(): void {
    const snapshot = this.redoStack.pop();
    if (!snapshot || !this.note) return;
    this.undoStack.push({ json: JSON.stringify(this.note) });
    this.note = JSON.parse(snapshot.json) as NoteDoc;
    this.applyReload();
  }

  private applyReload(): void {
    if (this.pageIndex >= (this.note?.pages.length ?? 0)) this.pageIndex = Math.max(0, (this.note?.pages.length ?? 1) - 1);
    this.selected = null;
    void this.cache.ensure(this.app, this.note?.pages ?? []).then(() => {
      this.renderAll();
      this.scheduleSave();
    });
  }

  /* ----------------------------------------------------------------- page */

  private addPage(): void {
    if (!this.note) return;
    this.pushUndo();
    const page = createPage(
      this.note.pageDefaults?.width ?? DEFAULT_PAGE_WIDTH,
      this.note.pageDefaults?.height ?? 1527,
    );
    this.note.pages.splice(this.pageIndex + 1, 0, page);
    this.pageIndex += 1;
    this.renderAll();
    this.scheduleSave();
  }

  private deletePage(): void {
    if (!this.note) return;
    if (this.note.pages.length <= 1) {
      new Notice('至少保留一页');
      return;
    }
    this.pushUndo();
    this.note.pages.splice(this.pageIndex, 1);
    this.pageIndex = Math.max(0, this.pageIndex - 1);
    this.renderAll();
    this.scheduleSave();
  }

  /* ------------------------------------------------------------------- IO */

  private pickPdf(): void {
    if (!this.paths) {
      new Notice('请先创建或打开一个三星笔记');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,.pdf';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) void this.importPdfFile(file);
    });
    input.click();
  }

  private async importPdfFile(file: File): Promise<void> {
    if (!this.paths || !this.note) return;
    this.setStatus(`正在导入 ${file.name}…`);
    try {
      const data = await file.arrayBuffer();
      const imported = await importPdf(data);
      this.pushUndo();
      for (const p of imported.pages) {
        const assetName = `pdf-${Date.now()}-p${p.sourcePage + 1}.png`;
        const assetPath = await writeAsset(this.app, this.paths, assetName, p.png);
        const page = createPage(p.width, p.height);
        page.images.push({
          id: newId('i'),
          asset: assetPath,
          x: 0,
          y: 0,
          w: p.width,
          h: p.height,
          sourcePage: p.sourcePage,
        });
        this.note.pages.push(page);
        await this.cache.ensure(this.app, [page]);
      }
      this.renderAll();
      this.scheduleSave();
      this.setStatus(`已导入 ${imported.pageCount} 页 PDF`);
      new Notice(`已导入 ${imported.pageCount} 页 PDF`);
    } catch (e) {
      this.setStatus('PDF 导入失败');
      new Notice(`PDF 导入失败：${(e as Error).message}`);
    }
  }

  private showExportMenu(evt: MouseEvent): void {
    if (!this.note) return;
    const menu = document.createElement('div');
    menu.className = 'snl-menu';
    const items: Array<[string, () => void]> = [
      ['导出 PDF（栅格）', () => void this.exportPdf('raster')],
      ['导出 PDF（矢量）', () => void this.exportPdf('vector')],
      ['导出当前页 PNG', () => void this.exportPagePng()],
    ];
    for (const [label, action] of items) {
      const item = document.createElement('button');
      item.className = 'snl-menuitem';
      item.textContent = label;
      item.addEventListener('click', () => {
        menu.remove();
        action();
      });
      menu.appendChild(item);
    }
    document.body.appendChild(menu);
    const rect = (evt.currentTarget as HTMLElement).getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    const close = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        menu.remove();
        document.removeEventListener('mousedown', close);
      }
    };
    window.setTimeout(() => document.addEventListener('mousedown', close), 0);
  }

  private async exportPdf(kind: 'raster' | 'vector'): Promise<void> {
    if (!this.paths || !this.note) return;
    this.setStatus(`正在导出 PDF（${kind === 'raster' ? '栅格' : '矢量'}）…`);
    try {
      await this.cache.ensure(this.app, this.note.pages);
      const bytes =
        kind === 'raster'
          ? await exportRasterPdf(this.app, this.note, this.cache, this.theme())
          : await exportVectorPdf(this.app, this.note, this.cache);
      const target = await this.uniqueExportPath('.pdf');
      await this.app.vault.adapter.writeBinary(target, toArrayBuffer(bytes));
      this.setStatus(`已导出 ${target}`);
      new Notice(`已导出：${target}`);
    } catch (e) {
      this.setStatus('导出失败');
      new Notice(`导出失败：${(e as Error).message}`);
    }
  }

  private async exportPagePng(): Promise<void> {
    const page = this.currentPage();
    if (!this.paths || !page) return;
    try {
      const png = await renderPageToPng(this.app, page, this.cache, this.theme(), 2);
      const target = await this.uniqueExportPath('.png');
      await this.app.vault.adapter.writeBinary(target, png);
      new Notice(`已导出：${target}`);
    } catch (e) {
      new Notice(`导出失败：${(e as Error).message}`);
    }
  }

  private async uniqueExportPath(extension: string): Promise<string> {
    const base = this.paths!.md.replace(/\.md$/i, '');
    for (let i = 1; i < 200; i++) {
      const candidate = i === 1 ? `${base}${extension}` : `${base} ${i}${extension}`;
      if (!(await this.app.vault.adapter.exists(candidate))) return candidate;
    }
    return `${base} ${Date.now()}${extension}`;
  }

  /* ---------------------------------------------------------------- saving */

  private scheduleSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.flushSave();
    }, 700);
  }

  private async flushSave(): Promise<void> {
    if (!this.note || !this.paths) return;
    try {
      await saveNote(this.app, this.note, this.paths);
      this.setStatus(`已保存 ${new Date().toLocaleTimeString()}`);
    } catch (e) {
      this.setStatus(`保存失败：${(e as Error).message}`);
    }
  }

  private setStatus(text: string): void {
    if (this.statusEl) this.statusEl.textContent = text;
  }
}

/** Text-entry dialog used by the text tool (works identically on desktop and mobile). */
class TextInputModal extends Modal {
  private onSubmit: (text: string) => void;

  constructor(app: App, onSubmit: (text: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: '输入文本' });

    const area = contentEl.createEl('textarea', { cls: 'snl-modal-textarea' });
    area.rows = 4;
    area.focus();

    const submit = () => {
      const value = area.value;
      this.close();
      this.onSubmit(value);
    };

    area.addEventListener('keydown', (evt) => {
      // Enter inserts a newline; Ctrl/Cmd+Enter commits.
      if (evt.key === 'Enter' && (evt.ctrlKey || evt.metaKey)) {
        evt.preventDefault();
        submit();
      }
    });

    const row = contentEl.createEl('div', { cls: 'snl-modal-row' });
    const cancel = row.createEl('button', { text: '取消' });
    cancel.addEventListener('click', () => this.close());
    const ok = row.createEl('button', { text: '插入', cls: 'mod-cta' });
    ok.addEventListener('click', submit);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}