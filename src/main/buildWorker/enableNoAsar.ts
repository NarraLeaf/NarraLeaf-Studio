/**
 * electron-builder manages asar archives itself: it creates the game's
 * app.asar and reads its header back to compute integrity metadata. Electron
 * patches `fs` so any path containing ".asar" is routed through its virtual
 * filesystem, which makes electron-builder's own open()/read() of the output
 * archive fail with ENOENT (it wants the file, not a lookup inside it).
 *
 * Disabling the patch for this worker process lets electron-builder treat
 * .asar files as the plain files they are. This is imported first — before
 * electron-builder or any of its dependencies — so the flag is set before any
 * of that code runs a build.
 *
 * Because the asar require hook is also affected, electron-builder and its
 * dependency closure must live OUTSIDE the Studio asar: see
 * `asarUnpack: node_modules/**` in electron-builder.yml. This only affects this
 * dedicated build worker; the Studio main process keeps asar support on.
 */
process.noAsar = true;
