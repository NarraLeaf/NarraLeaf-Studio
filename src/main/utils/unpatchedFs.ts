/**
 * `fs` with Electron's asar patch left out, for every file an author owns.
 *
 * The loader lives in `@shared/utils/unpatchedFs` because the shared `Fs` helpers - the renderer's
 * file-system facade, the `app://fs` protocol, document storage - reach author files through it
 * too, and `src/shared` cannot import from here. Read that module for what the patch does to a file
 * named like an archive and for the one case that still needs the patched module (Studio's own
 * archive). Main-process code keeps importing from this path.
 */
export { unpatchedFs, unpatchedFsPromises } from "@shared/utils/unpatchedFs";
