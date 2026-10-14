# Samsung Notes Lite (Obsidian plugin)

手写笔记插件，参照我们从三星笔记 APK 逆向出来的模型实现：**逐点墨迹（含压力/倾角）、页面与背景、
PDF 导入导出、仓库原生存储**，界面沿用三星笔记的**排布**但配色全部走 Obsidian 主题变量，因此风格随主题统一。

```
src/
├── main.ts        插件入口：ribbon 图标、命令、首页看板、```snote-button``` 代码块按钮、设置
├── home.ts        「三星笔记」首页看板（大按钮 + 最近笔记）
├── view.ts        编辑器 ItemView：工具栏 / 笔设置行 / 页面栏 / 画布 / 状态栏
├── ink.ts         墨迹渲染（压力驱动变宽）、命中测试、背景纹样
├── render.ts      页面合成（纸 + 背景 + 图片 + 笔迹 + 文本）、缩略图、PNG 渲染
├── store.ts       仓库存储：.md + .snote/ sidecar
├── pdf-import.ts  pdf.js 导入（渲染 PDF 页为 PNG）
├── pdf-export.ts  pdf-lib 导出（栅格 / 矢量）
└── types.ts       数据模型（NoteDoc / Page / Stroke / StrokePoint …）
```

## 构建与安装

```bash
npm install
npm run build          # -> main.js
npm run typecheck      # tsc --noEmit
npm test               # 在 Node 里跑真实模块（stub 掉 Obsidian API）
```

安装到仓库：

```bash
cp main.js manifest.json styles.css "<vault>/.obsidian/plugins/samsung-notes-lite/"
# 然后在 Obsidian → 设置 → 第三方插件 里启用（本仓库已写入 community-plugins.json 自动启用）
```

## 移动端（Android / iOS）

`manifest.json` 里 `isDesktopOnly` 为 `false`，插件只使用仓库适配器与标准 DOM/Canvas API，
**没有任何 Node/Electron 依赖**（可用 `grep -oE 'require\("(electron|fs|node:[a-z]+)"\)' main.js` 复核，
结果为 0 条），因此手机版 Obsidian 也能加载。

### 用命令行安装（adb，已验证）

整条链路除了"创建仓库"和一次信任确认，**不需要文件管理器、不需要在手机上打字**：

```bash
ADB=~/Android/Sdk/platform-tools/adb.exe
VAULT='/storage/emulated/0/Android/data/md.obsidian/files/<你的仓库名>'   # 见下方说明

adb install -r -g Obsidian-<version>.apk          # 装 Obsidian
# 首次需要在界面上建一次仓库（Obsidian 把仓库注册表放在应用私有目录，非 debuggable，无法脚本化）
#   建仓库时选 "App storage"：路径即 /storage/emulated/0/Android/data/md.obsidian/files/<名字>

adb shell am force-stop md.obsidian                # 先停掉，避免它回写配置
adb shell "mkdir -p '$VAULT/.obsidian/plugins/samsung-notes-lite'"
adb push main.js manifest.json styles.css "$VAULT/.obsidian/plugins/samsung-notes-lite/"
printf '[ "samsung-notes-lite" ]' > community-plugins.json
adb push community-plugins.json "$VAULT/.obsidian/community-plugins.json"
```

重新打开 Obsidian 后会出现一次 **"Do you trust the author of this vault?"** 提示
（因为仓库里已经预装了插件）——点 **"Trust author and enable plugins"** 即完成。
之后 设置 → 第三方插件 会显示 "You currently have 1 plugin installed"，且受限模式为关。

注意两点坑：
- **仓库名带空格**时，`adb shell` 的引号会被二次拆分，必须把整条命令作为一个字符串传给 `adb shell "..."`，
  并在里面用单引号包住路径（否则会报 `Read-only file system`）。
- 本机 `adb push` 的**本地路径要用 Windows 形式**（`C:/...`）；若设置了 `MSYS_NO_PATHCONV=1`，
  MSYS 不会再帮你转换 `/c/...`。

### 其它安装方式

1. **BRAT**：手机 Obsidian 装 BRAT → Add beta plugin → `RicarInori/obsidian-samsung-notes-lite`
2. **手动**：把三个文件放进 `<vault>/.obsidian/plugins/samsung-notes-lite/`
3. **同步**：桌面装好后同步整个仓库（官方 Sync 默认不同步插件目录，需在同步设置里勾选）

S Pen / 手写笔在 Android 上会提供真实 `PointerEvent.pressure`，压感变宽在手写笔上是有效的。

## S Pen 侧键橡皮（Android）

在 Android WebView 里笔杆侧键**不在** Pointer Events 规范定义的橡皮键位上（`button === 5` / `buttons & 32` 实测**完全没有**）。
Android/Chromium 把它映射成**主键位**，且只在**笔悬停（`pressure === 0`）**时可见：

| 状态 | 实测事件形态 |
|---|---|
| 悬停，未按侧键 | `pointermove` → `buttons = 0` |
| 悬停，按住侧键 | `pointermove` → `buttons = 1` |
| 按下瞬间 | 额外触发一次 `contextmenu` |

（Galaxy Tab S9+ / Android 16 实测；方法：window 级事件记录器 + 状态变化时间线，而非猜测。）

**实现**：悬停阶段跟踪 `buttons & 1` → 落笔时若已按住 → 本次手势走橡皮；抬起恢复原工具。
那次 `contextmenu` 被 `preventDefault` 掉，避免弹出系统菜单。

**已知限制**：笔尖接触时 `buttons` 本来就是 1，与"接触 + 按侧键"无法区分，因此
**"先落笔、再按侧键"不会切换为橡皮**——正常路径是"先悬停按住侧键、再落笔"。
三星笔记自身是纯原生读 `MotionEvent.getButtonState()`，不受此限制（其 dex 内有 `getButtonState`×9、`getMetaState`×6、`onGenericMotionEvent`×6）。

## 存储格式

每篇笔记 = 一个 `.md` + 一个同名 sidecar 文件夹，笔记本体留在仓库里，Obsidian 的搜索/双链/图谱/Git 都能用：

```
三星笔记/
├── 示例笔记.md            ← frontmatter(snote: true) + 正文文本（可全文搜索）
└── 示例笔记.snote/
    ├── note.json          ← pages[] → strokes[] / images[] / texts[]
    └── assets/            ← 导入的 PDF 页与图片（PNG）
```

`note.json` 的结构直接对应三星笔记的对象模型：

```jsonc
{ "version": 1, "pages": [ {
  "width": 1080, "height": 1527,          // 与三星 PDF 导入默认页一致
  "canvasType": "finite",                  // 对应 CANVAS_TYPE_FINITE / INFINITE
  "background": { "pattern": "lines", "spacing": 64 },
  "strokes": [ { "tool": "pen", "color": "#2f6fed", "size": 6,
                 "points": [ { "x": 120, "y": 420, "p": 0.15, "t": 0, "tiltX": 0, "tiltY": 0 } ] } ],
  "images": [ { "asset": "….snote/assets/pdf-….png", "x": 0, "y": 0, "w": 1080, "h": 1527, "sourcePage": 0 } ],
  "texts":  [ { "x": 120, "y": 120, "w": 820, "text": "…", "size": 28, "color": "#1f1f1f" } ]
} ] }
```

## 与三星笔记的对应关系

| 三星笔记能力 | 本插件 | 说明 |
|---|---|---|
| `SpenObjectStroke` 的 x,y + pressure + tilt + time | ✅ | `PointerEvent.pressure/tiltX/tiltY` + `getCoalescedEvents()`；鼠标 pressure 恒 0.5 |
| 有限/无限画布、行距/网格背景 | ✅（有限画布 + 四种背景） | `CANVAS_TYPE_*` 命名保留在 `canvasType` |
| PDF 导入（按宽度渲染、密码/权限） | ⚠️ 部分 | 可渲染页面为 PNG；**未**处理加密 PDF 与权限标志 |
| PDF 导出 RASTER / VECTOR | ✅ | `pdf-lib`：栅格=整页 PNG；矢量=描边路径 + 真实文本 |
| 图片/PNG 导出、Markdown | ✅ | `.md` 本身即文本版 |
| DOCX/PPTX 导出（三星用 Apache POI） | ❌ 未做 | MVP 范围外 |
| 原生笔刷（水彩/油画/涂抹） | ❌ | 只能用 Canvas 近似 |
| 手写识别 / 手写搜索（`libSPenRecognizer*`） | ❌ 未做 | 原生栈无法移植；见下方"限制" |
| `.sdoc` 读写 | ❌ | 闭源原生格式（`libSPenXmlSerializer`+`libSPenZlib`），改用自描述 JSON |

## 首页按钮

Obsidian 没有固定"首页"，所以四处都提供，任选：

1. 左侧栏 ribbon 铅笔图标
2. 命令面板 `Samsung Notes Lite: 创建三星笔记`
3. 首页看板视图（命令 `打开三星笔记首页`，或设置里开启"启动时打开"）
4. 任意笔记里插入代码块 —— 设置页有一键复制：

   ````
   ```snote-button
   创建三星笔记
   ```
   ````

## 已验证 / 未验证

**已验证（可复现）**

- `npm run typecheck` 通过（`tsc --noEmit`，0 error）。
- `npm test` 两套都通过（共 31 项）：
  - `test:export`（18 项）：真实模块（stub 掉 Obsidian API）下校验存储往返、`.md` frontmatter 契约、
    文本抽取，以及**矢量导出产物**——重新读回 PDF 确认 1 页、页面 540×763.5pt、内容流含
    `m`/`l`/`S`/`w` 描边操作符与 `BT/ET` 文本块、且不含任何光栅图像。
  - `test:load`（13 项）：**加载冒烟测试**——用 stub 的 Obsidian API 构造真实插件类并跑 `onload()`，
    断言注册了编辑器/首页视图、ribbon 图标「创建三星笔记」、3 条命令、`snote-button` 代码块、
    设置页，且视图工厂返回的 view type 正确、设置页 `display()` 不抛错。

**未验证**

- 画布绘制、指针取样、工具栏交互、PDF 导入在**桌面端**的实际渲染：需要 GUI 里手点，我无法代做。
- iOS：只做了代码层面的排除，没有真机/模拟器验证。
- 笔感：需要压感硬件（数位笔/笔屏）；鼠标只能得到恒定 pressure。

**移动端已在真机级环境验证过（Android 16 / API 36 / x86_64 模拟器）**

用上面的 adb 流程装好后实测：插件加载成功 → ` ```snote-button ` 代码块渲染成真实按钮 →
点按钮弹出创建对话框 → 点「创建」后**在设备上写出** `<vault>/三星笔记/未命名笔记.md` 与
`…/未命名笔记.snote/note.json`（内容为合法模型：1080×1527、`canvasType: finite`）→ 并打开插件的编辑器视图。
即"命令行安装 → 插件在 Android 上真正运行"整链已打通。