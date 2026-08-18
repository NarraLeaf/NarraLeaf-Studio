# Production Compatibility

This document outlines the compatibility of the game built with NarraLeaf-Studio. This is not for NarraLeaf-Studio itself.

## Media Formats

The following media file extensions are supported for each asset type in Werkspace (based on Chromium's capabilities):

A few containers are still listed by the file picker but refused on import, with a message naming
what to convert to: Chromium cannot demux them at all, so importing one would produce an asset that
never plays.

### Images

Raster: `png`, `apng`, `avif`, `jpg`, `jpeg`, `jpe`, `jfif`, `pjpeg`, `pjp`, `bmp`, `dib`, `gif`, `webp`, `ico`, `cur`  
Vector: `svg`  
Refused on import (convert to `png` or `webp`): `tif`, `tiff`, `xbm`

### Audio

- `mp3`, `wav`, `wave`, `ogg`, `oga`, `opus`, `aac`, `m4a`, `flac`, `weba`, `mka`
- Refused on import (convert to `mp3` or `wav`): `aiff`, `aif`, `aifc`, `mp2`

MIDI (`mid`, `midi`) is not a media format — playing it needs a synthesiser and an instrument bank,
not a decoder — and playlists (`m3u`, `m3u8`, `pls`) are lists of filenames rather than audio.
Neither can be imported.

### Video

- Modern web formats: `mp4`, `m4v`, `m4b`, `m4r`, `mov`, `qt`, `webm`, `mkv`
- Other containers Chromium demuxes: `3gp`, `3g2`, `f4v`
- Imports, but the picture does not play: `ogv`, `ogm`, `ogx`
- Refused on import (convert to `mp4` or `webm`): `avi`, `flv`, `wmv`, `asf`, `mpg`, `mpeg`, `mpe`, `mpv`, `m2v`, `ts`, `m2ts`, `mts`, `m2t`, `vob`

The Ogg video spellings sit in their own row because they fail differently from the row below, and
that difference is the whole reason they are still importable: the container **does** demux, so the
file loads and its audio track plays — it is Theora, the video codec conventionally inside it, that
no engine here decodes. Measured on Electron 38.8.6 / Chromium 140: the video track reports 0×0 and
never produces a frame, so a build is a black screen with sound. The `portability/media-format` lint
rule reports them on every build target; refusing them at import instead would be wrong, because a
container that demuxes could hold a codec that plays.

`m4p` is DRM-wrapped and can never be decoded; `av1` is a codec, not a container extension. Neither
can be imported.

Everything above is keyed by **extension, which is not the real criterion** — what plays is the codec
inside the container. The same `.mp4` plays when it carries H.264 and comes out as a black rectangle
with sound when it carries HEVC. Judging by codec means reading the container, which is a later
milestone; until then these lists are the conservative approximation.

### JSON

- `json`, `jsonc`

### Fonts

- Standard: `ttf`, `otf`, `ttc`
- Web: `woff`, `woff2`
- Other: `eot`, `svg`, `otc`

Some extra media formats may be supported using external libraries or plugins for NarraLeaf-Studio.

## Platforms

- Windows
  - Windows 10 x64 (20H2+)
  - Windows 11 x64
  - Windows 11 ARM64

- macOS
  - macOS 10.15+
  - macOS 11.0+

- Linux
  - Ubuntu 18.04+ x64
  - Ubuntu 20.04+ x64
  - Ubuntu 22.04+ x64
  - Fedora 35+ x64
  - Debian 10+ x64
  - CentOS/RHEL 8+ x64

Some platforms may be supported by building the game with an older version of Electron. Any platforms not listed here are not officially supported.
