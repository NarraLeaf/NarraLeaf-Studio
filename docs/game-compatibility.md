# Production Compatibility

This document outlines the compatibility of the game built with NarraLeaf-Studio. This is not for NarraLeaf-Studio itself.

## Media Formats

The following media file extensions are supported for each asset type in Werkspace (based on Chromium's capabilities):

### Images

Raster: `png`, `apng`, `jpg`, `jpeg`, `jfif`, `pjpeg`, `pjp`, `bmp`, `dib`, `gif`, `webp`, `tif`, `tiff`, `ico`, `cur`, `xbm`  
Vector: `svg`
Partial support for `avif` (in progress)

### Audio

- `mp3`, `wav`, `wave`, `ogg`, `oga`, `opus`, `aac`, `m4a`, `flac`, `weba`
- Less common / legacy: `aiff`, `aif`, `aifc`, `mid`, `midi`, `mp2`, `mka`
Partial support for `aiff`, `aif`, `aifc` (in progress)

### Video

- Modern web formats: `mp4`, `m4v`, `m4p`, `m4b`, `m4r`, `mov`, `qt`, `webm`, `av1`
- Legacy/extra: `3gp`, `3g2`, `flv`, `f4v`, `wmv`, `asf`, `mpg`, `mpeg`, `mpe`, `mpv`, `m2v`, `mts`, `m2t`, `ogv`, `ogm`, `ogx`, `vob`
Partial support for `mkv`, `avi`, `ts`, `m2ts` (in progress)

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
