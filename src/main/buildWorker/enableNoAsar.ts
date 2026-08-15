/**
 * electron-builder manages asar archives itself: it creates the game's
 * app.asar and reads its header back to compute integrity metadata. Electron
 * patches `fs` so any path containing ".asar" is routed through its virtual
 * filesystem, which makes electron-builder's own open()/read() of the output
 * archive fail with ENOENT (it wants the file, not a lookup inside it).
 *
 * Disabling the patch for this worker process lets electron-builder treat
 * .asar files as the plain files they are. This is imported first - before
 * electron-builder or any of its dependencies - so the flag is set before any
 * of that code runs a build.
 *
 * Because the asar require hook is the same patch, this worker cannot resolve
 * anything through the archive once the flag is set, and that includes finding
 * itself. `asarUnpack` putting `node_modules` on disk is only half of it: a
 * worker still *loaded* from `.../app.asar/dist/main/buildWorker.js` walks up to
 * `.../app.asar/node_modules`, a path inside a file, and every external require
 * in the bundle (electron-builder, 7zip-bin, @narraleaf/encryption) fails with
 * MODULE_NOT_FOUND - in packaged builds only, long after packaging succeeded.
 * So the worker is unpacked too and forked from the real path; see
 * `asarUnpack` in electron-builder.yml and `GameBuildManager.resolveWorkerPath`,
 * which are the other two thirds of this and are useless apart.
 *
 * This only affects this dedicated build worker; the Studio main process keeps
 * asar support on.
 */
process.noAsar = true;
