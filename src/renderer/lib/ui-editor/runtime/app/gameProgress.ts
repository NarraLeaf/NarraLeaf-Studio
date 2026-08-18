/**
 * What the running game puts into a progress document, and what it takes back out.
 *
 * Both halves work over the DECLARED variables and nothing else - the merged view of the project's
 * variable registry and the story document's own `/save` and `/persis` rows, which is the same view
 * every editor shows. That is not tidiness, it is the only workable definition of "the player's
 * variables":
 *
 *  - **Export.** Persistent values live in host persistence beside the player's language, their
 *    read-text record and their preferences. A sweep of that store would carry all of it into a
 *    document meant to hold a playthrough, and the other edition would then adopt the demo's
 *    settings along with its progress.
 *  - **Import.** A key nothing in this build declares is skipped rather than written. A document
 *    written by an older edition names variables this one may have renamed or dropped, and a
 *    hand-edited one names whatever someone typed; neither has any business seeding keys into a
 *    store this build's code will never read but its save files will carry forever.
 *
 * Keys are `storageKey`, never variable id - see `variables/registry.ts`. The storage key is what
 * the two editions' stores actually agree on, and it is unchanged by a rename.
 *
 * Pure and host-free on purpose: reading and writing are passed in, so the same functions serve the
 * live Storable, host persistence, and a test.
 *
 * Comments in English per project convention.
 */

import type { GameProgressDocumentV1, GameProgressImportOutcome } from "@shared/types/gameProgress";

/** The one field of a variable definition either half needs. */
export type GameProgressVariableDef = {
  storageKey: string;
};

/**
 * The values of `defs`, keyed by storage key.
 *
 * A variable that has never been written is left out entirely rather than exported as `undefined`:
 * absent means "this playthrough says nothing about it", and the importing build then keeps its own
 * default - which is the right answer for a variable the release edition introduced.
 */
export async function collectGameProgressVariables(
  defs: Iterable<GameProgressVariableDef>,
  read: (storageKey: string) => unknown | Promise<unknown>
): Promise<Record<string, unknown>> {
  const values: Record<string, unknown> = {};
  for (const def of defs) {
    const storageKey = def?.storageKey?.trim();
    if (!storageKey || Object.prototype.hasOwnProperty.call(values, storageKey)) {
      continue;
    }
    let value: unknown;
    try {
      value = await read(storageKey);
    } catch {
      // One unreadable variable must not cost the player the rest of their progress.
      continue;
    }
    if (value !== undefined) {
      values[storageKey] = value;
    }
  }
  return values;
}

/**
 * Write the values this build declares into whatever store `write` names.
 *
 * Returns the keys it applied, so a caller can log what a document actually contributed - the
 * difference between that and the document's own key count is exactly the variables this edition
 * does not have, which is the one thing worth saying out loud when progress arrives incomplete.
 */
export function applyGameProgressVariables(
  defs: Iterable<GameProgressVariableDef>,
  values: Record<string, unknown>,
  write: (storageKey: string, value: unknown) => void
): string[] {
  const applied: string[] = [];
  for (const def of defs) {
    const storageKey = def?.storageKey?.trim();
    if (!storageKey || applied.includes(storageKey)) {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(values, storageKey)) {
      continue;
    }
    try {
      write(storageKey, values[storageKey]);
      applied.push(storageKey);
    } catch {
      // Same reasoning as the read side: one refused write is not the whole playthrough.
    }
  }
  return applied;
}

/**
 * The visited scene ids to hold after a document arrives: what the build already had, plus what the
 * document brought, in that order and without duplicates.
 *
 * A union rather than a replacement, unlike the variables. A variable has one current value and the
 * document states it; the visited record is a set of things that happened, and a player who saw a
 * scene in the demo and another in the release has seen both. Discarding either half would be
 * telling them they had not.
 */
export function mergeVisitedSceneIds(
  current: readonly string[],
  incoming: readonly string[]
): string[] {
  const merged: string[] = [];
  for (const id of [...current, ...incoming]) {
    if (typeof id === "string" && id.trim() && !merged.includes(id)) {
      merged.push(id);
    }
  }
  return merged;
}

/** The node-facing shape of a document that arrived. */
export function toImportOutcome(document: GameProgressDocumentV1): GameProgressImportOutcome {
  return { outcome: "found", sceneId: document.anchor?.sceneId ?? "", error: "" };
}
