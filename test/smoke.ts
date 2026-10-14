/**
 * Load smoke test: constructs the real plugin class from src/main.ts against the stubbed
 * Obsidian API and runs onload(). This is the closest thing to "does it load in Obsidian?"
 * that can run without a GUI — it catches import-time errors and bad registrations.
 *
 * Run: node test/smoke.cjs
 */
import SNotePlugin from '../src/main';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  const app = {
    vault: {
      adapter: { exists: async () => false },
      getMarkdownFiles: () => [],
      getAbstractFileByPath: () => null,
    },
    workspace: {
      onLayoutReady: () => {},
      getActiveFile: () => null,
      getLeavesOfType: () => [],
      getLeaf: () => ({}),
      revealLeaf: () => {},
    },
    metadataCache: { getFileCache: () => null },
  };

  let plugin: SNotePlugin | null = null;
  let threw: string | null = null;
  try {
    plugin = new SNotePlugin(app as never, { id: 'samsung-notes-lite' } as never);
    await plugin.onload();
  } catch (e) {
    threw = (e as Error).message + '\n' + (e as Error).stack;
  }

  check('plugin onload() runs without throwing', threw === null, threw ?? '');
  if (!plugin) {
    console.log('\n1 CHECK(S) FAILED');
    process.exit(1);
  }

  const reg = (plugin as unknown as { registry: { views: Array<{ type: string; creator: (l: unknown) => unknown }>; commands: Array<{ id: string; name: string }>; ribbons: Array<{ icon: string; title: string }>; codeBlocks: Array<{ language: string }>; settingTabs: unknown[] } }).registry;

  const viewTypes = reg.views.map((v) => v.type);
  check('registers the editor view', viewTypes.includes('snl-editor'), viewTypes.join(', '));
  check('registers the home view', viewTypes.includes('snl-home'));
  check('adds a ribbon icon labelled 创建三星笔记', reg.ribbons.some((r) => r.title === '创建三星笔记'), JSON.stringify(reg.ribbons));
  check('registers 3 commands', reg.commands.length === 3, reg.commands.map((c) => c.id).join(', '));
  check('has a 创建三星笔记 command', reg.commands.some((c) => c.name === '创建三星笔记'));
  check('registers the snote-button code block', reg.codeBlocks.some((c) => c.language === 'snote-button'));
  check('adds a settings tab', reg.settingTabs.length === 1);

  // The creator must hand back a view whose type matches — the plugin/view wiring contract.
  const editorCreator = reg.views.find((v) => v.type === 'snl-editor')!;
  const view = editorCreator.creator({}) as { getViewType: () => string; getIcon: () => string };
  check('editor view creator returns the right view type', view.getViewType() === 'snl-editor', view.getViewType());
  check('editor view declares an icon', typeof view.getIcon() === 'string', view.getIcon());

  const homeCreator = reg.views.find((v) => v.type === 'snl-home')!;
  const home = homeCreator.creator({}) as { getViewType: () => string };
  check('home view creator returns the right view type', home.getViewType() === 'snl-home');

  const tab = reg.settingTabs[0] as { display?: () => void };
  let tabThrew: string | null = null;
  try {
    tab.display?.();
  } catch (e) {
    tabThrew = (e as Error).message;
  }
  check('settings tab renders without throwing', tabThrew === null, tabThrew ?? '');

  check('default folder setting is applied', (plugin as unknown as { settings: { folder: string } }).settings.folder === '三星笔记');

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();