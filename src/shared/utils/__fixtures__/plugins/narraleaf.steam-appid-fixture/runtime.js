/**
 * Runtime entry for the build config fixture package.
 *
 * It does nothing, and that is the point: build config is declared in the manifest and read before
 * any plugin code runs, so a package that declares fields needs no code to make them exist. The file
 * is here because a manifest must name an entry that is actually on disk.
 */
export function setup() {}
