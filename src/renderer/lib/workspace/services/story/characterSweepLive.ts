/**
 * The speaker sweeps a character deletion and its undo perform now live in
 * `@shared/live/characterSweep`, where the Team server's project authority runs the same code.
 * Re-exported so the editor's importers did not have to move.
 */
export * from "@shared/live/characterSweep";
