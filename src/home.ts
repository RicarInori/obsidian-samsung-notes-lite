import { ItemView, WorkspaceLeaf, setIcon, TFile } from 'obsidian';
import type SNotePlugin from './main';
import { listNotes } from './store';

export const SNL_HOME_TYPE = 'snl-home';

/**
 * The plugin's dashboard. Obsidian has no built-in "home page", so this view is what the
 * ribbon icon / command / homepage-plugin can point at; the "创建三星笔记" button lives
 * here as well as on the ribbon and in the command palette.
 */
export class HomeView extends ItemView {
  plugin: SNotePlugin;

  constructor(leaf: WorkspaceLeaf, plugin: SNotePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return SNL_HOME_TYPE;
  }

  getDisplayText(): string {
    return '三星笔记';
  }

  getIcon(): string {
    return 'pencil';
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('snl-home');

    const header = document.createElement('div');
    header.className = 'snl-home-header';
    const title = document.createElement('h2');
    title.textContent = '三星笔记';
    header.appendChild(title);
    root.appendChild(header);

    const primary = document.createElement('button');
    primary.className = 'snl-primary';
    const icon = document.createElement('span');
    icon.className = 'snl-primary-icon';
    try {
      setIcon(icon, 'plus');
    } catch {
      /* icon is optional */
    }
    const label = document.createElement('span');
    label.textContent = '创建三星笔记';
    primary.appendChild(icon);
    primary.appendChild(label);
    primary.addEventListener('click', () => {
      void this.plugin.createNote();
    });
    root.appendChild(primary);

    const notes = listNotes(this.app);
    const listTitle = document.createElement('div');
    listTitle.className = 'snl-home-subtitle';
    listTitle.textContent = notes.length ? `最近的笔记（${notes.length}）` : '还没有笔记';
    root.appendChild(listTitle);

    const list = document.createElement('div');
    list.className = 'snl-home-list';
    for (const file of notes.slice(0, 20)) {
      list.appendChild(this.noteRow(file));
    }
    root.appendChild(list);
  }

  private noteRow(file: TFile): HTMLElement {
    const row = document.createElement('button');
    row.className = 'snl-home-row';
    const name = document.createElement('span');
    name.className = 'snl-home-row-name';
    name.textContent = file.basename;
    const meta = document.createElement('span');
    meta.className = 'snl-home-row-meta';
    meta.textContent = new Date(file.stat.mtime).toLocaleString();
    row.appendChild(name);
    row.appendChild(meta);
    row.addEventListener('click', () => {
      void this.plugin.openNote(file.path);
    });
    return row;
  }
}