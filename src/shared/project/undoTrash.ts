/**
 * Where a project keeps the asset bytes its undo steps can still bring back, relative to the project
 * folder: the payload of a deleted asset, and the bytes a replacement wrote over.
 *
 * Named once because two processes need it. The workspace writes and reads it (`AssetTrash`), and
 * the main process empties it when the project's last window closes, when no undo step is left to
 * need any of it.
 *
 * It sits under `.nlstudio/` because nothing that leaves this machine reads that directory: version
 * control and Team pushes exclude it at any depth, a project export excludes it whole, and a build
 * reads assets by id from their content shards. `undoTrash.test.ts` holds this path against the
 * first two.
 */
export const UNDO_TRASH_DIRECTORY = ".nlstudio/trash";
