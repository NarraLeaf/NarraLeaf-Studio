/**
 * Community mirrors offered by name for the build's own downloads.
 *
 * Each is a choice in its setting's source picker, never a default: an empty setting still means
 * the official host, and an author outside the networks these serve gains nothing from them. They
 * are offered because the official hosts (github.com and ziglang.org) are slow or unreachable from
 * some networks, and an author there has no way to know the address of a mirror that lays its
 * files out the way each download expects.
 *
 * What a named mirror is trusted with differs by download, and the comments below say which:
 * a payload checked against a digest pinned in the source cannot be swapped by the mirror, only
 * withheld; one checked against a checksum file fetched from the same mirror can.
 */

/**
 * npmmirror's copy of the Electron releases, for `build.electronMirror`.
 *
 * Laid out as `<mirror>v<version>/<file>`, which is what `@electron/get` composes from
 * `electronDownload.mirror`. Its integrity check reads `SHASUMS256.txt` from the same mirror, so
 * this one is trusted with the bytes, not merely with availability - which is why it is a mirror
 * run by npmmirror (Alibaba's npm mirror, the one Electron's own Chinese documentation names)
 * rather than any address that happens to answer.
 */
export const MIRROR_ELECTRON_URL = "https://npmmirror.com/mirrors/electron/";

/**
 * npmmirror's copy of electron-builder-binaries, for `build.electronBuilderBinariesMirror`.
 *
 * Laid out as `<mirror><release>/<file>`, the layout electron-builder composes from
 * `ELECTRON_BUILDER_BINARIES_MIRROR`. Every archive a build fetches through it - 7-Zip, NSIS, the
 * code-signing bundle, the AppImage toolset - is checked against a digest pinned in electron-builder
 * or in Studio, so the mirror decides only whether the download arrives.
 */
export const MIRROR_ELECTRON_BUILDER_BINARIES_URL = "https://npmmirror.com/mirrors/electron-builder-binaries/";

/**
 * A mirror of ziglang.org's release archives, for `build.zigMirror`.
 *
 * One of the community mirrors ziglang.org itself lists, run from China, and the one on that list
 * that serves the `<mirror><version>/<archive>` layout `zigToolchain` composes - most serve the
 * archives flat. The archive is checked against the sha256 pinned in `zigToolchain.ts`, so the
 * mirror decides only whether it arrives.
 */
export const MIRROR_ZIG_URL = "https://fs.liujiacai.net/zigbuilds/";
