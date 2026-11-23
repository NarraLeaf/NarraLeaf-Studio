# Figma Community listing

Everything the publish form asks for, ready to paste. The listing itself is in English; the
Chinese and Japanese descriptions below are for the NarraLeaf docs and for sharing elsewhere.

## Images

| File | Size | Field |
|---|---|---|
| `icon.png` | 128 × 128 | Icon |
| `cover.png` | 1920 × 1080 | Thumbnail |

Both are drawn from `icon.html` and `cover.html`, which use the Studio leaf in
`resources/studio-icon/leaf.png`. To redraw them after editing, run from this folder:

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --hide-scrollbars --allow-file-access-from-files --force-device-scale-factor=4 --window-size=128,128 --screenshot=icon-512.png "file://$PWD/icon.html"
sips -z 128 128 icon-512.png --out icon.png && rm icon-512.png
"$CHROME" --headless=new --hide-scrollbars --allow-file-access-from-files --window-size=1920,1080 --screenshot=cover.png "file://$PWD/cover.html"
```

## Name

NarraLeaf Studio Export

## Tagline

Turn Figma frames into game UI pages for NarraLeaf Studio, with working state buttons.

## Description

Design your visual novel's menus in Figma, then bring them into NarraLeaf Studio as editable
interface pages.

**How it works**

1. Select the frames to export, or select nothing to list every top-level frame on the page.
2. Run the plugin, tick the frames and press Export. You get one `.narraleaf-figma.json` file with
   every picture inside it.
3. In NarraLeaf Studio, open the interface editor, press **Import design** next to **Create Page**
   and choose the file. Each frame becomes a page, scaled to your project's resolution.

**What comes across**

- Frames, groups, components and instances become containers, keeping fills, strokes, corner
  radii, shadows and clipping.
- Auto layout becomes a stack container where a stack can express it.
- Text stays editable text. Fonts are matched against the font assets in your project.
- Rectangles filled with an image become image widgets.
- Vectors, boolean shapes, masks and blend modes are exported as 2x pictures and placed exactly
  over the original layer. Add `[raster]` to a layer's name to export any layer as a picture.

**Buttons with states**

Draw a button once per state and it arrives as one interactive button:

- an instance of a component set with a state property (`State = Default / Hover / Pressed /
  Disabled`), or
- a group whose layers are named `normal`, `hover`, `pressed` and `disabled`, with at most one
  text layer as the label.

**Game screens**

Name a frame's top-level groups dialog, choice, quick menu and notification, and the frame imports
as the game's Game UI instead of a page: the line, the speaker's name and avatar, the choice list
and the quick menu's Auto, Skip, Log, Save, Load and Config buttons arrive wired to do their jobs.
The background and sprites are left out.

Rather than renaming layers, right-click them and mark them: Mark as Game UI, Mark dialogue part,
Mark quick-menu button. The panel then shows a checklist of what Studio will make of each frame,
what it guessed and what is missing, and selects a layer when you click its line.

**Good to know**

- Hidden layers are left out.
- Letter spacing is dropped, and mixed text styles take the first run's style.
- Studio lists every simplification in an import report, naming the layers involved.
- The plugin has no network access. Nothing leaves your computer except the file you download.

Requires NarraLeaf Studio 2.0 or later.

## Tags

visual novel, game ui, game design, export, import, buttons, components, auto layout,
interface, narraleaf, galgame, ui kit

## Support contact

https://github.com/NarraLeaf/NarraLeaf-Studio/issues

## Data security questionnaire

- Network access: none (`networkAccess.allowedDomains` is `["none"]`).
- Data collected: none. The plugin reads the selected frames on the current page and writes them
  to a file the user downloads.
- Third parties: none.

---

## 中文介绍

在 Figma 里设计视觉小说的界面，再把它们导入 NarraLeaf Studio，成为可以继续编辑的界面页面。

**使用方法**

1. 选中要导出的画框；不选时会列出当前页面所有顶层画框
2. 运行插件，勾选画框并点「导出」按钮，得到一个 `.narraleaf-figma.json` 文件，图片都打包在里面
3. 在 NarraLeaf Studio 的界面编辑器里，点「新建页面」旁的「导入设计稿」并选择该文件。每个画框成为一个页面，并按项目分辨率等比缩放

**导入后的对应关系**

- 画框、编组、组件和实例成为容器，保留填充、描边、圆角、阴影和裁切
- 自动布局在可以表达时成为堆叠容器
- 文本仍是可编辑的文本，字体按字体族名匹配项目中的字体资产
- 填充了图片的矩形成为图片控件
- 矢量、布尔运算、蒙版和混合模式会导出为 2 倍图片，放在原图层的位置。在图层名中加 `[raster]` 可把任意图层导出为图片

**带状态的按钮**

每个状态各画一份，导入后就是一个可交互的按钮：

- 带「状态」属性的组件集实例（`State = Default / Hover / Pressed / Disabled`）
- 或者一个编组，其中的图层分别命名为 `normal`、`hover`、`pressed`、`disabled`（也可以用普通、悬停、按下、禁用），可再带一个文本图层作为按钮文字

**游戏画面**

将画框的顶层编组命名为对话框、选项、快捷菜单和通知，该画框会导入为游戏界面而不是页面：台词、说话人名字和头像、选项列表，以及快捷菜单的自动、跳过、日志、存档、读档、设置按钮都会接好对应功能。背景和立绘不导入

也可以不改名：选中图层后右键，用插件的 Mark 命令标注（Mark as Game UI、Mark dialogue part、Mark quick-menu button）。插件面板会按画框列出 Studio 将如何识别，标出按位置推测和未找到的部分，点击一项即可选中对应图层

**注意事项**

- 隐藏图层不会导出
- 字间距会丢弃，混排文本取第一段的样式
- Studio 会在导入报告中列出所有简化，并点名涉及的图层
- 插件不联网，除了你下载的文件，没有任何数据离开你的电脑

需要 NarraLeaf Studio 2.0 或更高版本

## 日本語の紹介

Figma でビジュアルノベルの画面をデザインし、NarraLeaf Studio に編集可能なインターフェースページとして取り込めます。

**使い方**

1. 書き出すフレームを選択する。何も選択しなければ、ページ上のすべてのトップレベルフレームが一覧になる
2. プラグインを実行し、フレームにチェックを入れて「Export」を押す（プラグインの画面は英語と中国語のみ）。画像をすべて含む `.narraleaf-figma.json` ファイルが 1 つできる
3. NarraLeaf Studio のインターフェースエディターで「ページを作成」の横にある「デザインを読み込む」を押し、そのファイルを選ぶ。各フレームがページになり、プロジェクトの解像度に合わせて拡大縮小される

**取り込まれる内容**

- フレーム、グループ、コンポーネント、インスタンスはコンテナになり、塗り、線、角丸、影、クリップを保つ
- オートレイアウトは、表現できる場合はスタックコンテナになる
- テキストは編集可能なテキストのまま。フォントはプロジェクトのフォントアセットとファミリー名で照合する
- 画像で塗られた長方形は画像ウィジェットになる
- ベクター、ブーリアン、マスク、描画モードは 2 倍の画像として書き出され、元のレイヤーの位置に置かれる。レイヤー名に `[raster]` を付けると、どのレイヤーも画像として書き出せる

**状態付きボタン**

状態ごとに 1 枚ずつ描けば、1 つの操作可能なボタンとして取り込まれる：

- 状態プロパティを持つコンポーネントセットのインスタンス（`State = Default / Hover / Pressed / Disabled`）
- または、レイヤー名が `normal`、`hover`、`pressed`、`disabled`（通常、ホバー、押下、無効でも可）のグループ。ラベルとしてテキストレイヤーを 1 つまで含められる

**ゲーム画面**

フレームのトップレベルのグループにダイアログ、選択肢、クイックメニュー、通知と名前を付けると、そのフレームはページではなくゲーム UI として読み込まれる。セリフ、話者の名前とアバター、選択肢リスト、クイックメニューのオート、スキップ、ログ、セーブ、ロード、設定ボタンが機能をつないだ状態で取り込まれる。背景と立ち絵は読み込まない

名前を変える代わりに、レイヤーを右クリックしてプラグインの Mark コマンド（Mark as Game UI、Mark dialogue part、Mark quick-menu button）でマークを付けることもできる。プラグインのパネルには、Studio がフレームをどう読み込むかがチェックリストとして表示され、推測した部分と見つからない部分が示される。項目をクリックするとそのレイヤーが選択される

**注意点**

- 非表示のレイヤーは書き出されない
- 文字間隔は失われ、混在したテキストスタイルは最初の部分のスタイルになる
- 簡略化した内容はすべて Studio の読み込みレポートに、該当レイヤー名とともに表示される
- プラグインはネットワークに接続しない。ダウンロードするファイル以外、データがコンピューターの外に出ることはない

NarraLeaf Studio 2.0 以降が必要
