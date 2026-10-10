# Assets and media

Import with `assets_import` in batches (about 50 paths per call), into folders that mirror the
game's (`backgrounds`, `characters/<name>`, `cg`, `ui`, `bgm`, `se`, `voice/<speaker>`, `video`).
Keep a name → asset-id map from each result; your converter emits asset names and needs it.

## What imports as is

PNG, JPEG, WebP images; MP3, OGG, WAV, Opus audio; MP4 (H.264) and WebM (VP8/VP9) video; TTF/OTF/
WOFF fonts. When unsure, import one file and read the answer - Studio checks the real container and
codecs, not the extension, and says what is wrong.

## Convert first (into your working folder, never the source)

| Ren'Py source | Do | Example |
|---|---|---|
| `.avi`, `.ogv` (Theora), MPEG-4 Part 2 | transcode to MP4 or WebM | `ffmpeg -i in.ogv -c:v libvpx-vp9 -b:v 0 -crf 32 -c:a libopus out.webm` |
| `Movie(play="a.webm", mask="a_mask.webm")` | merge the mask into an alpha WebM | `ffmpeg -c:v libvpx-vp9 -i a.webm -c:v libvpx-vp9 -i a_mask.webm -filter_complex "[1:v]format=gray[m];[0:v]format=rgba[v];[v][m]alphamerge[o]" -map "[o]" -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 2M -auto-alt-ref 0 -an out.webm` (scale both inputs to the same size first if they differ) |
| a masked movie shown with a zoom or position transform | bake the transform into a full-screen alpha WebM (scale + pad to the stage size) | add `scale=…,pad=W:H:x:y:color=0x00000000` before encoding |
| `im.MatrixColor`, `im.matrix.tint`, `Transform(matrixcolor=…)` on stills | pre-render each variant to PNG and treat it as its own image | `colorchannelmixer` in ffmpeg, or PIL |
| `Composite`, `LiveComposite`, `Crop`, `Flatten` of stills | pre-render | |
| a file whose content does not match its extension (WAV named `.mp3`) | re-encode to what the name says | Studio refuses it and says what it really is |
| a huge font (10+ MB CJK) | subset to the characters the game uses, keep the family name | fonttools `pyftsubset` |

Decode VP9 inputs with `-c:v libvpx-vp9` *before* `-i`, or ffmpeg's native decoder drops the alpha.

## Things to know

- **Duplicates.** Byte-identical files are imported once; the second path is answered under
  `duplicates` with the existing asset's name, and no asset is created under the new name. Map the
  second Ren'Py name to the existing asset in your converter.
- **Missing references.** Ren'Py scripts often name images that do not exist (dead branches, typos).
  Do not create placeholders; list them in the log with the lines that use them.
- **Fonts.** Import every font the screens and `gui.*` use. Check in a playtest that the game draws
  them, not only the editor; log any fallback with a screenshot.
- **Unused assets.** Before deleting anything `lint` reports under `assets/unused`, ask `asset_usage`
  whether anything uses it - videos used only by effect rows, voice takes and gallery items are
  easy to miss.
- **Size.** A Ren'Py game can be several GB. Import what the game uses (your stage model knows) plus
  the interface images; leave caches, saves and unused source art out.
