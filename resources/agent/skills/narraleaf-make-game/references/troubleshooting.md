# Troubleshooting

Every refused call comes back as a tool result with `isError: true`, a `code`, a message, and often a
`hint`. The hint is written for you: do what it says first. This chapter covers each code and the
traps that do not produce a refusal at all.

## Refusal codes

| Code | What happened | What to do |
|---|---|---|
| `invalid_args` | The arguments do not fit the tool's schema | Re-read the tool's input schema; fix names and types |
| `unknown_tool` | No tool by that name | Names use underscores (`story_apply`, not `story.apply`); list tools again |
| `no_workspace` | No Studio window has a project open, or several do and you did not say which | `agent_status`; open one with `project_open`, or pass `project` (the project's absolute path) |
| `writes_disabled` | The author has not allowed changes | Ask them: *Settings -> Agent access -> allow agents to make changes*. Keep reading and planning meanwhile |
| `paused` | The author paused you from the status bar | Stop. Tell them where you are; continue when they resume |
| `frozen` | The project is busy (version control, recovery, reload) | Wait a moment and retry once; if it persists, ask the author |
| `live_session` | A Team live session is running | Writes would race the room; ask the author to end the session or to write themselves |
| `stale_revision` | The page or scene changed since you read it | Read it again (`story_show` / `ui_show`), redo your edit on the new text, write with the new revision. Never re-send the old text |
| `check_failed` | The source had errors; **nothing was written** | Read every finding, fix them all, write again (a `dryRun` is free) |
| `not_found` | A scene, page, element, asset or character name/id does not exist | `story_list`, `ui_surfaces`, `assets_list`, `characters_list`, `story_targets` |
| `path_not_allowed` | A path outside the project and the allowed folders that the author has not allowed (yet) | The hint says which: *asking* - Studio's dialog is still open, call again once the author answers; *declined* - do not ask again, ask the author in chat or have them copy the files into the project; *never opened* (home folder, a drive root, Studio's own folders) - name the specific folder. Use `request_folder_access` up front for big imports |
| `untrusted` | The project is not trusted, so its code cannot run (playtest, build) | Ask the author to trust the project in Studio |
| `unavailable` | Valid call, impossible now (e.g. advancing a playtest that is not running) | Read the message; fix the precondition |
| `internal` | Something broke in Studio | Retry once; if it repeats, `console_read {level:"error"}` and tell the author what you were doing |

## Story traps

- **A row vanished after `story_apply`.** The source left it out. A source describes the whole scene;
  always start from `story_show` and keep the anchors of rows you keep.
- **`story/stage-object-missing` on `/show <image> …` followed by `/hide <name>`.** Write `name=` on the
  `/show`. Without it, `/show sunset` means "reveal the object called sunset", which does not exist yet.
- **Same error on `/hide Aoi` at the top of a scene.** Each scene starts empty; `/show Aoi` earlier in
  that scene.
- **A picture never appears.** `/image` only creates; use `/show <asset> name=…`.
- **Game crashes on start, "stringify is not a function", no row named.** A `/bg` inside an `/if` or a
  menu option. Move it out (`story-format` has the pattern).
- **`compile.expressionError`.** Use `&&`, `||`, `!` and double-quoted strings.
- **A speaker shows as plain text with no colour.** The label does not match a character's name or
  nickname exactly (case, spaces, full-width colon). Fix the label or add a nickname with
  `character_upsert`.
- **Dialogue split oddly.** A `: ` inside narration made it dialogue - escape it as `\: `.
- **A skeleton picture (classroom, corridor) flashes between scenes, or lint never calls it unused.**
  A reused demo scene opens on it: `story_show` prints `#background classroom` in its header. Apply
  the scene with `#background none` (and `#music none`), then `asset_delete` the picture.
- **`story_apply` says the scene "still opens with" a background or music.** Your source left out
  `#background` / `#music`, so the scene's own setting was kept. State it (`none` clears it).
- **Start opens the old demo scene.** The title's Start button names a scene by id; see
  `blueprint-format`.
- **A later row names something created earlier in the same source and is refused.** Apply in two
  passes: first the rows that create it, then `story_show` (which now prints anchors for them) and add
  the rows that address it.

## Interface traps

- **A colour change does nothing.** The element's `appearance` rows override the flat prop. Change the
  palette entry (`brand_set`) or the appearance row (`ui-format`).
- **A new container is a white rectangle.** Copy the props of a transparent container from `ui_show`
  into the `add` op.
- **Words do not change.** The element has a `localizationKey`; the key's text wins.
- **List rows all show the same thing.** Row content must come from field bindings
  (`bind text = field …`), not Set Text.
- **`ui_apply` deleted elements.** A block replaces the page's whole tree. Prefer `ui_patch`; start any
  `ui_apply` from `ui_show`.
- **Buttons on the quick menu stopped responding** after adding a full-screen element to a Game UI:
  something now covers them. Keep added elements clear of the quick menu row.

## Blueprint traps

- **`blueprint_show` by owner key.** `widgetMain:<surfaceId>:<elementId>` works with the ids as
  `ui_show` prints them, the title page's `narraleaf-studio:main-surface` included; the blueprint's name
  works too.
- **A layer disappeared.** `blueprint_apply` replaces every graph of the owner; `compile.graph_dropped`
  warned. Start from `blueprint_show`.
- **A node does nothing, no error.** An Element node pointing at an id the page does not have
  (`compile.element_type_unknown`), or a node from a plugin the project does not load.
- **`compile.unknown_node_type`** - `blueprint_nodes {query}`; plugin nodes need their plugin loaded.

## Assets traps

- **Import refused for a video or audio file.** Unsupported container (AVI, WMV, FLV, MPEG, TS, AIFF,
  MP2) or image (TIFF). Ask the author to convert: video to WebM (VP9) or MP4 (H.264), audio to OGG or
  MP3, images to PNG.
- **Video plays sound over black.** HEVC/H.265 MP4, ProRes MOV or Theora OGV; convert to WebM or H.264
  MP4.
- **A sprite is gigantic, tiny or floating.** A sprite is drawn at its pixel size times its
  character's entrance `zoom`, centred at the `/show` position. `character_upsert {id,
  entranceTransform:"standing"}` puts its feet on the bottom edge at its own size; for a smaller
  figure give `{zoom:z, position:{xalign:0.5, yalign:0.5, yoffset: round(h*z/2 - H/2)}}` (h sprite
  height, H stage height). A reused skeleton character carries the demo's zoom 0.624.
- **A sprite is a rectangle.** The image has no transparency; ask the author for a cut-out.
- **`character_layered_set` refused: "Every layer image must be the same size".** Each layer is drawn
  centred at its own pixels, so parts must be exported at the full canvas size, transparent around
  them. Ask the author for full-canvas exports (or use the PSD: `character_layers_import {psd}` bakes
  every layer to the canvas).
- **A layered character's mouth (or jacket) vanishes for one look.** That layer has `null` for that
  tag - the answer's `scoped` lists every such gap. Give it an image, or move the layer to the axis
  that really drives it. `character_preview` shows the look.
- **"`/char Mei smile`" changes the wrong thing, or a tag is refused as duplicate.** A tag name may
  appear on one axis only; rename one (`no-hat`, `no-glasses`).
- **Refused with "cold switch".** The character is of another kind (preset poses, a Live2D/Spine
  model); switching discards its looks. Show the author the listed rows; pass `confirmSwitch: true`
  only with their agreement.
- **`asset_delete` refused.** Something still uses the asset; the refusal lists each place (a row, a
  scene's `#background`/`#music`, a character pose, a page). Rewrite those, then delete. Lint's
  `assets/unused` warnings are candidates, not a verdict: before deleting one, call `asset_usage
  {asset}`; delete only when both of its lists are empty. It also lists places that write the asset's
  id but that Studio's usage index does not count, and `asset_delete` refuses those too.

## Variable traps

- **`variable_upsert` warns after a retype.** The listed rows still write or test the old type (`/set
  好感 true` on a number, `? 好感` testing it as true/false). Rewrite each with `story_apply` (`? 好感 >
  0`, `/set 好感 1`); blueprints it lists, check with `blueprint_show`.

## When stuck

1. Re-read the tool description and the relevant chapter.
2. Ask the catalogue (`story_command`, `ui_widget`, `ui_usage`, `blueprint_node`).
3. `console_read {level:"error"}`.
4. Tell the author plainly what you tried, what came back, and what you need from them. Do not loop.
