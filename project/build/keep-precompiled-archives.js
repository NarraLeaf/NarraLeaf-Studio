/*
 * electron-builder's `onNodeModuleFile` hook: the files inside node_modules that
 * must survive its default ignore list.
 *
 * The list is `excludedExts` in app-builder-lib/out/fileMatcher.js, and the
 * entry that matters here is `a`. Every file under node_modules whose name ends
 * in `.a` is dropped from the package, on every platform - the extension is
 * assumed to be a static library left behind by a node-gyp build, which nothing
 * needs at run time.
 *
 * @narraleaf/bindings ships something else under it. `prebuilds/<target>/core.a`
 * is the precompiled half of the content codec: a protected build compiles the
 * rest of it and links the two together, so the archive is a runtime input to
 * the in-app game build rather than build leftovers. The iOS xcframework beside
 * it carries its own static slices for the same reason.
 *
 * Dropping them is silent - packaging succeeds, and the module is complete
 * everywhere except in the packaged app - so the whole failure lands on an
 * author, in a build of their game, as:
 *
 *   [Build] build failed: Error: no precompiled archive for win32-x64
 *
 * thrown by the package when it looks for the archive beside the prebuilt
 * binaries it shipped with. Development never sees it: there the module is read
 * from node_modules, archives and all.
 *
 * Returning true here force-includes a file (NodeModuleCopyHelper.js checks the
 * hook before applying the extension list). It is deliberately narrow - the
 * defaults are worth keeping for every other package, and for every other part
 * of this one.
 */

const path = require('path');

// Everything the package staged under prebuilds/ is meant to be there, whatever
// the extension: the tree is one prebuilt artefact per target, assembled by the
// package's own release step.
const prebuiltArtefacts = `${path.join('node_modules', '@narraleaf', 'bindings', 'prebuilds')}${path.sep}`;

exports.onNodeModuleFile = (file) => file.includes(prebuiltArtefacts);
