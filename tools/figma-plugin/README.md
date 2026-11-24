# NarraLeaf Studio Export (Figma plugin)

Exports Figma frames to a single `.narraleaf-figma.json` file that the interface editor in
NarraLeaf Studio imports as pages (Interfaces panel, **Import design** button).

## Install

1. In the Figma desktop app: **Plugins → Development → Import plugin from manifest…**
2. Choose `tools/figma-plugin/manifest.json` from this repository.

The plugin requests no network access. Everything it writes goes into the downloaded file.

The Figma Community listing (icon, cover, copy and the questionnaire answers) is in
`listing/LISTING.md`. Publishing is only possible from the Figma desktop app.

## Use

1. Select the frames to export (or any layer inside them), or select nothing to list every
   top-level frame on the page.
2. Run **Plugins → Development → NarraLeaf Studio Export → 导出并检查… / Export and check…**, tick the frames
   and press **Export**.
3. In Studio, open the interface editor and import the downloaded file.

## What arrives how

| Figma | Studio |
|---|---|
| Frame, component, instance, section, group | Container (fill, stroke, corners, shadows, clipping) |
| Auto layout | Stack container, or exact positions when a stack cannot express it |
| Rectangle filled with an image | Image |
| Rectangle, circle | Container without children |
| Text | Text (first style run; letter spacing is dropped) |
| Vector, boolean, star, polygon, line, non-circular ellipse, masked group, multi-fill shape, blend modes | PNG at 2x, placed exactly over the layer |
| Hidden layers | Left out |
| Instance of a component set with a state property (`State=Default / Hover / Pressed / Disabled`) | Button, each state a look |
| Group or frame whose layers are named `normal`, `hover`, `pressed`, `disabled` (or 普通, 悬停, 按下, 禁用), plus at most one text | Button, each state a look |

Add `[raster]` to a layer's name to export it as a picture regardless.

## Game screens

A frame drawn as the running game imports as Game UI rather than a page when its top-level groups
are named for the Game UI they are: `dialog`, `choice`, `quick menu`, `notification` (or 对话框,
选项, 快捷菜单, 通知). A quick menu group inside the dialogue group is the quick menu. Everything
else in the frame, such as the background and sprites, is left out.

| Layer | Becomes |
|---|---|
| Text named `line` / 台词 in the dialogue group | The dialogue sentence |
| Text named `name` / 名字 | The speaker's name; a group it sits in shows only while someone speaks |
| Layer named `avatar` / 头像 | The speaker's avatar |
| First option in the choice group | The row of the choice list, its text bound to the option |
| Buttons named `auto`, `skip`, `log`, `save`, `load`, `config`, `hide` | Wired to those jobs; a state named `on` is Auto's and Skip's lit look |
| First message in the notification group | The row of the notification list |

Studio replaces the project's Game UI in those slots, as one undo step, after showing which.

### Marking layers

Instead of renaming layers by hand, mark them. Select layers on the canvas, right-click, and pick
one of the plugin's commands:

- **Mark as Game UI** → Dialogue box, Choices, Quick menu, Notifications
- **Mark dialogue part** → Line, Speaker name, Avatar
- **Mark quick-menu button** → Auto, Skip, Log, Save, Load, Config, Hide
- **Clear mark**

A manifest can't be localized, so each menu entry reads in Chinese and English
(`标为游戏界面 / Mark as Game UI`).

The panel's **Mark as…** list does the same for the current selection without closing the panel.
A mark is stored on the layer (shared plugin data, namespace `narraleaf`, so it survives the plugin
being republished) and exported as the node's `role`; Studio follows it over the layer's name. A
layer Figma named (`Group 12`, a text named after its words) is renamed for its job; a name you
chose is kept with the job in front (`Dialogue box · Bottom panel`). Clearing a mark gives the old
name back if nobody renamed the layer since. A frame holds one of each Game UI part and one line,
name and avatar: marking a second layer takes the mark off the first. Marked layers get a
**Check in NarraLeaf** button in the properties panel.

### Checklist

The panel shows, under each frame, what Studio will make of it: which part fills which slot, which
text is the line and the name and whether that was marked, named or guessed by position, whether
Auto and Skip have an `on` look, how many options a list found, which layers are left out. Click a
line to select its layer. The checklist is Studio's own reading, bundled into the plugin, so it
says what the import does. Whether the project has a Log, Save, Load or Config page is only known
in Studio, which reports it after the import.

## Building

Figma runs `code.js`, which is generated: `src/main.js` bundled with Studio's design reading
(`src/renderer/lib/ui-editor/figma-import/gameUiChecklist.ts` and what it imports). After changing
either, regenerate it from the repository root:

```bash
node node_modules/vitest/vitest.mjs run src/renderer/lib/ui-editor/figma-import/figmaPlugin.test.ts -u
```

The same test runs the bundle against a stand-in for Figma's plugin API and fails while `code.js`
is out of date.

Frames are scaled to fit the project's resolution. Fonts are matched against the project's font
assets by family name; a family with no match falls back to the default font and is listed in the
import report.

The export format is defined in
`src/renderer/lib/ui-editor/figma-import/figmaExportFormat.ts`. The plugin only collects data and
draws pictures; all mapping is done by Studio.
