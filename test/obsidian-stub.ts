/**
 * Minimal stand-in for the `obsidian` runtime, so the plugin's real modules can be
 * exercised under plain Node (esbuild aliases `obsidian` to this file).
 *
 * Only the surface the plugin actually touches is implemented.
 */

export function normalizePath(p: string): string {
  return String(p).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

export class Notice {
  static seen: string[] = [];
  constructor(message: string) {
    Notice.seen.push(message);
  }
}

export class TFile {
  path = '';
  basename = '';
  parent: unknown = null;
  stat = { mtime: 0 };
}

export class TFolder {
  path = '';
}

export class App {}

export const Platform = { isDesktopApp: true, isMobileApp: false };

/** Records what the plugin registers, so a test can assert on it. */
export interface Registry {
  views: Array<{ type: string; creator: (leaf: unknown) => unknown }>;
  commands: Array<{ id: string; name: string }>;
  ribbons: Array<{ icon: string; title: string }>;
  codeBlocks: Array<{ language: string }>;
  settingTabs: unknown[];
}

export class Plugin {
  app: unknown;
  manifest: unknown;
  registry: Registry = { views: [], commands: [], ribbons: [], codeBlocks: [], settingTabs: [] };

  constructor(app: unknown, manifest: unknown) {
    this.app = app;
    this.manifest = manifest;
  }

  registerView(type: string, creator: (leaf: unknown) => unknown): void {
    this.registry.views.push({ type, creator });
  }

  addRibbonIcon(icon: string, title: string, _cb: unknown): unknown {
    this.registry.ribbons.push({ icon, title });
    return {};
  }

  addCommand(command: { id: string; name: string }): unknown {
    this.registry.commands.push(command);
    return command;
  }

  registerMarkdownCodeBlockProcessor(language: string, _cb: unknown): void {
    this.registry.codeBlocks.push({ language });
  }

  addSettingTab(tab: unknown): void {
    this.registry.settingTabs.push(tab);
  }

  register(): void {}
  registerInterval(id: number): number {
    return id;
  }

  async loadData(): Promise<unknown> {
    return null;
  }

  async saveData(_data: unknown): Promise<void> {}
}

class StubElement {
  children: StubElement[] = [];
  textContent = '';
  empty(): void {
    this.children = [];
  }
  addClass(): void {}
  createEl(tag: string, opts?: { text?: string }): StubElement {
    const el = new StubElement();
    if (opts?.text) el.textContent = opts.text;
    this.children.push(el);
    void tag;
    return el;
  }
}

export class Component {
  load(): void {}
}

export abstract class View extends Component {
  leaf: unknown;
  app: unknown;
  containerEl = new StubElement();
  contentEl = new StubElement();
  constructor(leaf: unknown) {
    super();
    this.leaf = leaf;
  }
  abstract getViewType(): string;
  abstract getDisplayText(): string;
}

export abstract class ItemView extends View {
  constructor(leaf: unknown) {
    super(leaf);
  }
}

export class WorkspaceLeaf {}

export class PluginSettingTab {
  app: unknown;
  plugin: unknown;
  containerEl = new StubElement();
  constructor(app: unknown, plugin: unknown) {
    this.app = app;
    this.plugin = plugin;
  }
  display(): void {}
}

export class Setting {
  constructor(_containerEl: unknown) {}
  setName(): this {
    return this;
  }
  setDesc(): this {
    return this;
  }
  addText(cb: (t: unknown) => unknown): this {
    const t = {
      setPlaceholder: () => t,
      setValue: () => t,
      onChange: () => t,
    };
    cb(t);
    return this;
  }
  addToggle(cb: (t: unknown) => unknown): this {
    const t = { setValue: () => t, onChange: () => t };
    cb(t);
    return this;
  }
  addButton(cb: (b: unknown) => unknown): this {
    const b = { setButtonText: () => b, onClick: () => b };
    cb(b);
    return this;
  }
}

export class Modal {
  app: unknown;
  containerEl = new StubElement();
  contentEl = new StubElement();
  constructor(app: unknown) {
    this.app = app;
  }
  open(): void {
    (this as unknown as { onOpen: () => void }).onOpen();
  }
  close(): void {}
}

export class MarkdownView {}

export function setIcon(_el: unknown, _icon: string): void {}