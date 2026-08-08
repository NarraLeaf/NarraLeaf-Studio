# Skeleton template — asset provenance and licences

The ten assets in this template's `content/assets/` travel inside Studio's
installer, and every project made from the template gets a copy of them.
Bundling is redistribution, so "free to use" was not enough: each licence had to
permit passing the file on. This file is the record of which licence, and where
each file came from, so a later maintainer can re-verify rather than re-search.

## Backgrounds — CC0 (public domain dedication)

| Asset | Source | Author |
|---|---|---|
| `classroom` | [OpenGameArt · Classroom 002](https://opengameart.org/content/classroom-002) | midnight68 / MedicineStorm |
| `corridor` | same submission (`lockers_0.jpg`) | midnight68 / MedicineStorm |
| `room-warm` | same submission (`classroom4.png`) | midnight68 / MedicineStorm |
| `washroom` | [OpenGameArt · Bathroom01](https://opengameart.org/content/bathroom01) | midnight68 / MedicineStorm |

`corridor` was cropped to 1074×604 — 16:9, so it fills a 1920×1080 stage instead
of letterboxing it. The other three ship at their original sizes.

CC0 requires no attribution. The table is here anyway, for provenance.

## Audio — CC0

| Asset | Source | Note |
|---|---|---|
| `bgm-daily` | [OpenGameArt · Catmint](https://opengameart.org/content/catmint) | the submission's own pre-cut loop |
| `bgm-quiet` | [OpenGameArt · Forget Me Not](https://opengameart.org/content/forget-me-not) | the submission's own pre-cut loop |
| `ui-confirm`, `ui-hover`, `ui-back` | [OpenGameArt · 51 UI sound effects](https://opengameart.org/content/51-ui-sound-effects-buttons-switches-and-clicks) | three clips of the 51; the pack's own readme credits **Kenney Vleugels (kenney.nl)** |

Both music files are the loop variants their authors published, which is what
Studio's intro→loop audio track wants.

## Character — NarraLeaf's own

`narra` — Narra, the project's mascot, supplied by the project owner: cropped to
the character, padded so the **head** sits on the horizontal centre (not the
alpha centroid — long hair drags that off the axis a viewer actually tracks), and
scaled to 1289×1620.

**Upper body only.** The owner intends to replace it with a full-body sprite, so
the story places her with a single centred preset that a new file can inherit.

## Rejected, and why — so nobody re-researches them

- **Pepo Kukuru, "Girl Sprites for VN"** — tagged CC0, but the author's own text
  says "do not resell these directly or with minor modifications". Bundling into
  an installer is redistribution, and a licence that contradicts itself is not one
  to build on.
- **Wenrexa UI kits** — genuinely CC0, but bitmap UI: it cannot be recoloured in
  the inspector and does not scale. Studio's templates are shapes and text for
  exactly that reason.
- **"592 Anime Grasslands Backgrounds"** — AI-generated and only 768×512, well
  under a 1920 stage.
