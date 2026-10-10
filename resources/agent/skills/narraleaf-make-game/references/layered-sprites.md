# Layered sprites

A character in NarraLeaf is drawn one of three ways. Pick per character, before writing scenes.

| Kind | What the art is | How a row picks a look | Tools |
|---|---|---|---|
| **preset** | one finished image per pose (`aoi_smile.png`) | `/char Aoi smile` swaps the whole picture | `character_upsert` with `poses` |
| **layered** | a stack of same-sized images: body, outfit, eyes, mouth ... | `/char Mei smile` changes one axis and keeps the rest | `character_layered_set`, `character_layers_import`, `character_preview` |
| **live2d / spine / puppet** | an animated model run by a runtime the author installs | `/char`, `/motion`, `/skin`, `/param` with the model's own names | set up in Studio only - see the last section |

Use **preset** when the author hands you one picture per expression. Use **layered** when the art
comes in parts (a PSD, or files like `mei_eyes_smile.png`), or when the cast has outfits *and*
expressions - five expressions in three outfits is fifteen preset pictures but eight layer images.

## Axes, tags and layers

- An **axis** is one independent choice: `expression` (normal, smile, angry), `outfit` (school,
  casual), `pose`, `hair`. Its values are **tags**. One tag per axis is showing at any time; one tag of
  each axis is the **default**.
- A **layer** is one image slot of the stack, listed **bottom to top**. A layer either always draws
  the same image (the body), or **follows one axis** and draws an image per tag of it (the mouth draws
  `mei_mouth_smile` when the expression is smile).
- **One axis can drive several layers.** `expression` moves the brows, the eyes and the mouth
  together: three layers, all following `expression`. That is the point of the model - group the
  layers that change together under one axis.
- A layer that follows an axis must say what it draws for **every** tag of that axis. `null` means
  "draws nothing for this tag" - a jacket layer that only the casual outfit has:
  `{ "school": null, "casual": "mei_jacket_casual" }`.
- **Every layer image is the same pixel size** - the full canvas, transparent where the part is not.
  Each layer is drawn centred at its own size, so an eyes image cropped to the face would land in the
  middle of the body. The tools refuse mismatched sizes and list them.
- **Tag names are unique across the character's axes.** A row names the tag alone (`/char Mei
  casual`), so `none` cannot be both a hat and a glasses tag - call them `no-hat` and `no-glasses`.

## Naming the files

Import the layer images with `assets_import`, naming them

```
<character>_<layer>            a layer that always draws        mei_body
<character>_<layer>_<tag>      one tag of a varying layer       mei_eyes_smile, mei_outfit_casual
```

A layer name has no `_` (write `back-hair`, not `back_hair`); a tag may. A varying layer's files say
which tags it has; a tag one layer has and another layer of the same axis lacks becomes `null` there
(the answer lists those under `scoped` - check each is intended, not a missing file). Studio's own PSD
import names its files the same way.

## Building one

**From named files** - one call:

```json
character_layers_import {
  "character": "Mei",
  "order": ["back-hair", "body", "outfit", "jacket", "eyes", "brows", "mouth", "front-hair"],
  "axes": { "expression": ["eyes", "brows", "mouth"], "outfit": ["outfit", "jacket"] },
  "defaults": { "expression": "normal", "outfit": "school" }
}
```

`order` is required once there is more than one layer: stacking cannot be read off file names.
Layers not listed in `axes` follow an axis of their own name. Use `dryRun: true` first; the answer's
`derivedSpec` is the full stack in `character_layered_set`'s words.

**From a PSD** - `character_layers_import { "character": "Mei", "psd": "/abs/path/mei.psd" }`. Each
top-level group with two or more layers becomes an axis whose tags are the layers inside it; every
other layer is a fixed layer. Layers are baked to the full canvas and imported as assets. A layer
with a blend mode the stage cannot draw (multiply, screen, ...) must be decided first: the refusal
lists them, answer with `blendModes: { "Face/Shadow": "merge" }` (flattened onto the layer below, as
Photoshop shows it) or `"skip"`. Ask the author when unsure. Hidden layers are left out.

**Stated outright** - `character_layered_set`, when you want full control or are adjusting what an
import made:

```json
character_layered_set {
  "character": "Mei",
  "axes": [
    { "name": "expression", "tags": ["normal", "smile", "angry"] },
    { "name": "outfit", "tags": ["school", "casual"], "default": "school" }
  ],
  "layers": [
    { "name": "body", "asset": "mei_body" },
    { "name": "outfit", "axis": "outfit", "options": { "school": "mei_outfit_school", "casual": "mei_outfit_casual" } },
    { "name": "jacket", "axis": "outfit", "options": { "school": null, "casual": "mei_jacket_casual" } },
    { "name": "eyes", "axis": "expression", "options": { "normal": "mei_eyes_normal", "smile": "mei_eyes_smile", "angry": "mei_eyes_angry" } },
    { "name": "mouth", "axis": "expression", "options": { "normal": "mei_mouth_normal", "smile": "mei_mouth_smile", "angry": "mei_mouth_angry" } }
  ]
}
```

Both tools are one undo step, refuse with nothing written on any error, and answer with the
character as `characters_list` describes it. Restating a character keeps every axis, tag and layer
whose name you kept, so story rows that chose them keep working; a tag you drop is reported with the
rows that chose it (they fall back to the default - rewrite them).

Name colour, nicknames and the entrance (`zoom`, baseline) are set with `character_upsert` as for any
character; a new layered character gets a standing entrance fitted to its canvas.

**Changing kind is destructive.** Turning a preset character layered (or back, by giving it `poses`)
discards its looks - nothing is converted. The tools refuse first and list the story rows that chose
one of its looks; pass `confirmSwitch: true` only when the author agreed, then rewrite those rows.

## Checking the looks

`character_preview { "character": "Mei", "look": { "expression": "angry", "outfit": "casual" } }`
returns the composited sprite. Look at the combinations a scene will use - especially ones mixing
axes (does the angry mouth sit right under the casual hood?). `characters_list` gives each
character's axes, tags, defaults and layers; `story_targets` lists the looks under *character looks*.

## In a scene

```
/show Mei pos=left in=fade            every axis at its default
/show Mei casual pos=right            casual outfit, default expression
Mei: Did you wait long?
/char Mei smile                       expression changes, outfit stays casual
Mei: Good. Let's go.
/char Mei school t=dissolve d=0.4     outfit changes, still smiling
```

One tag per `/char` row: to change two axes at once, write two rows. A `/show` names at most one tag
too; every axis it does not name takes its default.

## Live2D, Spine and custom runtimes

These characters are drawn by a runtime the author installs in Studio themselves (Live2D's licence
does not let Studio ship or download it). **You cannot set one up**: creating the character, picking
the model and installing the runtime happen in Studio's character editor. `characters_list` shows an
existing one (kind, runtime, model, resting state), and story rows drive it with the model's own
names: `/char Hiyori smile` (expression), `/motion Hiyori idle`, `/skin Doll summer`,
`/param Hiyori ParamAngleX 15`. Ask the author for the names their model has (Studio's editor lists
them), and see it with `playtest_screenshot` - `character_preview` cannot render a model.
