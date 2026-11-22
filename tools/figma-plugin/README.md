# NarraLeaf Studio Export (Figma plugin)

Exports Figma frames to a single `.narraleaf-figma.json` file that the interface editor in
NarraLeaf Studio imports as pages (Interfaces panel, **Import design** button).

## Install

1. In the Figma desktop app: **Plugins → Development → Import plugin from manifest…**
2. Choose `tools/figma-plugin/manifest.json` from this repository.

The plugin requests no network access. Everything it writes goes into the downloaded file.

## Use

1. Select the frames to export, or select nothing to list every top-level frame on the page.
2. Run **Plugins → Development → NarraLeaf Studio Export**, tick the frames and press **Export**.
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

Frames are scaled to fit the project's resolution. Fonts are matched against the project's font
assets by family name; a family with no match falls back to the default font and is listed in the
import report.

The export format is defined in
`src/renderer/lib/ui-editor/figma-import/figmaExportFormat.ts`. The plugin only collects data and
draws pictures; all mapping is done by Studio.
