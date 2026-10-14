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

- 画布绘制、指针取样、工具栏交互、PDF 导入的**实际渲染**：需要 GUI 里手点，我无法代做。
- 笔感：需要压感硬件（数位笔/笔屏）；鼠标只能得到恒定 pressure。