import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf } from 'obsidian';
import { SNoteView, SNL_VIEW_TYPE } from './view';
import { HomeView, SNL_HOME_TYPE } from './home';
import { createNoteOnDisk, isSNote } from './store';

interface SNLSettings {
  /** Vault folder that new notes are created in. */
  folder: string;
  /** Open the dashboard at startup. */
  openHomeOnStart: boolean;
}

const DEFAULT_SETTINGS: SNLSettings = {
  folder: '三星笔记',
  openHomeOnStart: false,
};

export default class SNotePlugin extends Plugin {
  settings: SNLSettings = { ...DEFAULT_SETTINGS };

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(SNL_VIEW_TYPE, (leaf: WorkspaceLeaf) => new SNoteView(leaf, this));
    this.registerView(SNL_HOME_TYPE, (leaf: WorkspaceLeaf) => new HomeView(leaf, this));

    this.addRibbonIcon('pencil', '创建三星笔记', () => {
      void this.createNote();
    });

    this.addCommand({
      id: 'create-note',
      name: '创建三星笔记',
      callback: () => {
        void this.createNote();
      },
    });

    this.addCommand({
      id: 'open-home',
      name: '打开三星笔记首页',
      callback: () => {
        void this.openHome();
      },
    });

    this.addCommand({
      id: 'open-current-as-note',
      name: '在三星笔记编辑器中打开当前笔记',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !isSNote(this.app, file)) return false;
        if (!checking) void this.openNote(file.path);
        return true;
      },
    });

    // A real, clickable button that can live in any note — e.g. your Home.md.
    this.registerMarkdownCodeBlockProcessor('snote-button', (source, el) => {
      const button = document.createElement('button');
      button.className = 'snl-primary snl-blockbutton';
      button.textContent = source.trim() || '创建三星笔记';
      button.addEventListener('click', () => {
        void this.createNote();
      });
      el.appendChild(button);
    });

    this.addSettingTab(new SNLSettingTab(this.app, this));

    if (this.settings.openHomeOnStart) {
      this.app.workspace.onLayoutReady(() => {
        void this.openHome();
      });
    }
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(SNL_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(SNL_HOME_TYPE);
  }

  /* ------------------------------------------------------------------ API */

  /** Ribbon / command / block-button entry point: ask for a title, then open the editor. */
  async createNote(): Promise<void> {
    const defaultTitle = await this.suggestTitle();
    new TitleModal(this.app, defaultTitle, async (title) => {
      try {
        const { paths } = await createNoteOnDisk(this.app, this.settings.folder, title);
        await this.openNote(paths.md);
        new Notice(`已创建：${paths.md}`);
      } catch (e) {
        new Notice(`创建失败：${(e as Error).message}`);
      }
    }).open();
  }

  private async suggestTitle(): Promise<string> {
    const base = '未命名笔记';
    for (let i = 1; i < 500; i++) {
      const candidate = i === 1 ? base : `${base} ${i}`;
      const path = this.settings.folder ? `${this.settings.folder}/${candidate}.md` : `${candidate}.md`;
      const exists = await this.app.vault.adapter.exists(path);
      if (!exists) return candidate;
    }
    return `${base} ${Date.now()}`;
  }

  async openNote(mdPath: string): Promise<void> {
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({
      type: SNL_VIEW_TYPE,
      active: true,
      state: { path: mdPath },
    });
    this.app.workspace.revealLeaf(leaf);
  }

  async openHome(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(SNL_HOME_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: SNL_HOME_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  /* -------------------------------------------------------------- settings */

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

/** Small "name your note" dialog. */
class TitleModal extends Modal {
  private title: string;
  private onSubmit: (title: string) => Promise<void> | void;

  constructor(app: App, initial: string, onSubmit: (title: string) => Promise<void> | void) {
    super(app);
    this.title = initial;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: '创建三星笔记' });

    const input = contentEl.createEl('input', { type: 'text', value: this.title });
    input.addClass('snl-modal-input');
    input.focus();
    input.select();

    const submit = async () => {
      const value = input.value.trim() || '未命名笔记';
      this.close();
      await this.onSubmit(value);
    };

    input.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter') {
        evt.preventDefault();
        void submit();
      }
    });

    const row = contentEl.createEl('div', { cls: 'snl-modal-row' });
    const cancel = row.createEl('button', { text: '取消' });
    cancel.addEventListener('click', () => this.close());
    const ok = row.createEl('button', { text: '创建', cls: 'mod-cta' });
    ok.addEventListener('click', () => void submit());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class SNLSettingTab extends PluginSettingTab {
  plugin: SNotePlugin;

  constructor(app: App, plugin: SNotePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('笔记存放文件夹')
      .setDesc('新建的三星笔记放在仓库的这个文件夹里；墨迹数据放在同名的 .snote 子文件夹中。')
      .addText((text) =>
        text
          .setPlaceholder('三星笔记')
          .setValue(this.plugin.settings.folder)
          .onChange(async (value) => {
            this.plugin.settings.folder = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('启动时打开三星笔记首页')
      .setDesc('Obsidian 启动后自动打开本插件的首页看板。')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.openHomeOnStart).onChange(async (value) => {
          this.plugin.settings.openHomeOnStart = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('首页按钮')
      .setDesc('在任意笔记里插入下面这段代码块，就会渲染出「创建三星笔记」按钮。')
      .addButton((button) =>
        button.setButtonText('复制代码块').onClick(async () => {
          await navigator.clipboard.writeText('```snote-button\n创建三星笔记\n```');
          new Notice('已复制');
        }),
      );
  }
}