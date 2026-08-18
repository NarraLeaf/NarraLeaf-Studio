/**
 * Carrying a player from one edition of a title to the next.
 *
 * A player finishes the demo and buys the full game. Those are two packages with two app ids (an
 * app tag may override `identifier`), therefore two user-data directories, and their asset
 * protection keys deliberately differ - so the release build cannot read the demo's save files and
 * must not try. What travels between them is not a save. It is a small, explicit statement of what
 * the player has: their project-level variables, where they had got to, and which scenes they had
 * seen. The author decides when it is written and when it is read, with two blueprint nodes.
 *
 * # One document per title, not per build
 *
 * Both editions have to reach the same file, so it cannot live under either one's user-data
 * directory - that directory is exactly the thing the two do not share. It sits beside them
 * instead, under `NarraLeaf/progress/`, named by {@link GameProgressDocumentV1.progressKey}: one
 * key for the whole title, resolved from the identity the RELEASE tag carries whatever variant is
 * being built. A demo and a full game therefore write and read the same path, and two different
 * titles never collide.
 *
 * # Plain JSON. Not encrypted, not signed
 *
 * This is an interchange document by design. Its whole purpose is that a package which cannot
 * decrypt the other's assets can still read it, so encrypting it with a per-title secret would
 * defeat the feature, and signing it would only prove which build wrote it - a fact no reader here
 * acts on. A player who edits the file gives themselves variables in their own single-player game,
 * which is the same thing a save editor already does and is not a boundary this file is pretending
 * to hold.
 *
 * # Versioned from the start
 *
 * {@link GAME_PROGRESS_SCHEMA_VERSION} is written by the first build that ever writes one. The
 * documents outlive the build that wrote them by construction - the whole point is that a package
 * shipped later reads one written earlier - so a document this Studio cannot read has to be
 * refusable rather than half-understood, and there is no later moment at which adding a version
 * would cover the documents already out there.
 *
 * Comments in English per project convention.
 */

import { deriveGameAppId } from "./gameBuild";
import { userDataDirectoryName } from "../utils/userDataLocation";
import { RELEASE_APP_TAG, resolveAppTagIdentity, type AppTagBaseIdentity } from "./appTag";

export const GAME_PROGRESS_SCHEMA_VERSION = 1 as const;

export type GameProgressSchemaVersion = typeof GAME_PROGRESS_SCHEMA_VERSION;

/**
 * The path segments the file sits under, inside whichever per-user root the platform names.
 *
 * `NarraLeaf` rather than the title, because the directory is shared by every title a player has
 * and the per-title part is the filename. See `userDataLocation.ts` for which root each platform
 * uses and why Linux is the odd one out.
 */
export const GAME_PROGRESS_DIRECTORY_SEGMENTS = ["NarraLeaf", "progress"] as const;

export const GAME_PROGRESS_FILE_EXTENSION = ".json";

/**
 * Where the player had got to, in the terms the author wires back into `Start Game`.
 *
 * `sceneId` is the Studio id - the stable one a rename never changes, and the one `Start Game`
 * takes. `sceneRuntimeName` travels beside it for the reader, not for the runtime: this document is
 * meant to be openable in a text editor, and an id alone says nothing about where the player was.
 * Nothing resolves a scene by it.
 *
 * Null when no story was running, which is a legitimate export: a player may have persistent
 * variables worth carrying and no playthrough in progress.
 */
export type GameProgressAnchor = {
  sceneId: string;
  sceneRuntimeName: string;
};

export type GameProgressDocumentV1 = {
  schemaVersion: GameProgressSchemaVersion;
  /** The title this belongs to. Compared on read: a document for another title is not ours. */
  progressKey: string;
  writtenAt: string;
  /** Which story document the anchor and the saved values belong to. Blank when none was running. */
  storyId: string;
  /**
   * Saved-scope values, keyed by `storageKey` and not by variable id.
   *
   * `storageKey` is the key that is rename-stable and that the save file itself uses (see
   * `variables/registry.ts`), so a variable renamed between the demo and the release still lands.
   * A variable id would have been the wrong half: it is stable within one project, but it is the
   * storage key the two editions' stores actually agree on.
   */
  savedVariables: Record<string, unknown>;
  /** Persistent-scope values, keyed by `storageKey` for the reason above. */
  persistentVariables: Record<string, unknown>;
  anchor: GameProgressAnchor | null;
  /** Studio scene ids the player had entered. The saved-domain visited record. */
  visitedSceneIds: string[];
};

/**
 * The one key both editions of a title compute.
 *
 * Derived from the app id the RELEASE tag resolves to, so a variant that renames `identifier` -
 * which is exactly what a demo does, and is exactly why the two have separate user-data directories
 * - still answers the same string. The app id rather than the display name for the reason
 * `userDataLocation.ts` gives: a display name is renamed freely and every rename would orphan the
 * file. Run through {@link userDataDirectoryName} so the result is one path segment by construction.
 */
export function gameProgressKey(base: AppTagBaseIdentity): string {
  // The release tag carries no overrides by construction (see RELEASE_APP_TAG), so this resolves
  // to the project's own values whatever variant is being built. Spelled as a resolve rather than
  // as a read of `base` so the intent survives: it is the release identity that is wanted, not
  // "whatever is in hand".
  const identity = resolveAppTagIdentity(RELEASE_APP_TAG, base);
  return userDataDirectoryName(
    deriveGameAppId(identity.identifier.value, identity.displayName.value)
  );
}

/** The file name a key answers to. One segment; the key is already path-safe. */
export function gameProgressFileName(progressKey: string): string {
  return `${progressKey}${GAME_PROGRESS_FILE_EXTENSION}`;
}

/**
 * What the running game states when it exports. The shell supplies everything else - the key, the
 * timestamp and the version are facts about the build and the moment, not about the playthrough,
 * and a renderer that could state them could write a document naming another title.
 */
export type GameProgressExportRequest = {
  storyId: string;
  savedVariables: Record<string, unknown>;
  persistentVariables: Record<string, unknown>;
  anchor: GameProgressAnchor | null;
  visitedSceneIds: string[];
};

/**
 * The answer to an export. `failed` carries the reason: a web export has no filesystem, a build
 * predating {@link gameProgressKey} has no key, and a disk can be full.
 */
export type GameProgressExportResult =
  | { outcome: "written"; error: null }
  | { outcome: "failed"; error: string };

/**
 * The answer to an import.
 *
 * `missing` is not an error and must never be reported as one: no file is the ordinary state of
 * every player who has not exported, and an author's graph has a different answer for it (start a
 * new game) than for a file that would not parse (say something went wrong).
 */
export type GameProgressImportResult =
  | { outcome: "found"; document: GameProgressDocumentV1; error: null }
  | { outcome: "missing"; document: null; error: null }
  | { outcome: "failed"; document: null; error: string };

/**
 * What `Import Progress` hands the author's graph.
 *
 * The node's three exec outs and its two data pins, in one value. `sceneId` is blank when the
 * document anchors nowhere, which is a `found` with nothing to resume from - persistent variables
 * carried across, no playthrough in progress.
 */
export type GameProgressImportOutcome = {
  outcome: "found" | "missing" | "failed";
  sceneId: string;
  error: string;
};

/** A record of plain values, or `{}`. Structural only - it judges the shape, never the meaning. */
function normalizeValueRecord(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key.trim()) {
      values[key] = value;
    }
  }
  return values;
}

function normalizeAnchor(raw: unknown): GameProgressAnchor | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const sceneId = typeof record.sceneId === "string" ? record.sceneId.trim() : "";
  if (!sceneId) {
    // Without a scene id there is nothing to hand to `Start Game`, and a name alone names
    // nothing the runtime can resolve. That is an anchor of none, not a broken document.
    return null;
  }
  const sceneRuntimeName =
    typeof record.sceneRuntimeName === "string" ? record.sceneRuntimeName.trim() : "";
  return { sceneId, sceneRuntimeName };
}

/**
 * One document, from whatever was on disk. `null` for anything this build cannot read.
 *
 * Null exactly twice: the payload is not an object at all, or its `schemaVersion` is not the one
 * this build understands. Everything else degrades - a missing record reads as empty, a bad anchor
 * reads as none - because the alternative is refusing a player's whole progress over a key nothing
 * was going to read. A future version is refused rather than guessed at, which is the whole reason
 * the version is written.
 */
export function normalizeGameProgressDocument(raw: unknown): GameProgressDocumentV1 | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== GAME_PROGRESS_SCHEMA_VERSION) {
    return null;
  }
  return {
    schemaVersion: GAME_PROGRESS_SCHEMA_VERSION,
    progressKey: typeof record.progressKey === "string" ? record.progressKey.trim() : "",
    writtenAt: typeof record.writtenAt === "string" ? record.writtenAt : "",
    storyId: typeof record.storyId === "string" ? record.storyId.trim() : "",
    savedVariables: normalizeValueRecord(record.savedVariables),
    persistentVariables: normalizeValueRecord(record.persistentVariables),
    anchor: normalizeAnchor(record.anchor),
    visitedSceneIds: Array.isArray(record.visitedSceneIds)
      ? record.visitedSceneIds.filter(
          (id): id is string => typeof id === "string" && id.trim().length > 0
        )
      : []
  };
}

/** The document a shell writes, from what the running game stated and what the build knows. */
export function buildGameProgressDocument(
  progressKey: string,
  request: GameProgressExportRequest,
  writtenAt: string
): GameProgressDocumentV1 {
  return {
    schemaVersion: GAME_PROGRESS_SCHEMA_VERSION,
    progressKey,
    writtenAt,
    storyId: typeof request.storyId === "string" ? request.storyId.trim() : "",
    savedVariables: normalizeValueRecord(request.savedVariables),
    persistentVariables: normalizeValueRecord(request.persistentVariables),
    anchor: normalizeAnchor(request.anchor),
    visitedSceneIds: Array.isArray(request.visitedSceneIds)
      ? request.visitedSceneIds.filter(
          (id): id is string => typeof id === "string" && id.trim().length > 0
        )
      : []
  };
}
