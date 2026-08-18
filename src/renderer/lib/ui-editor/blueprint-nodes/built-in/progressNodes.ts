/**
 * `Export Progress` / `Import Progress` - carrying a player from one edition of a title to the next.
 *
 * A demo and the full game are separate packages with separate app ids, so they keep separate
 * user-data directories and their asset protection keys differ on purpose: the release build cannot
 * read the demo's save files and must not try. These two nodes are the channel that does cross, and
 * it is deliberately not a save file - it is one plain JSON document per title holding the
 * project-level variables, where the player had got to, and which scenes they had seen. See
 * `@shared/types/gameProgress`.
 *
 * Where that document lives is decided by the shell that performs the act, never by the graph: the
 * desktop shells hand it to their main process, the web export refuses because a page has no shared
 * file to write. An author's graph therefore has to be able to hear "no", which is why both nodes
 * carry a failure branch and a reason.
 *
 * **`Import Progress` does not jump.** It hands the scene id out as data and stops. `Start Game` is
 * the node that starts a story, and it is already wired into whatever else the author's title screen
 * does first - a fade, a confirmation, a chapter select. A node that jumped by itself would be a
 * second way to start a story that skipped all of it.
 *
 * Comments in English per project convention.
 */

import {
  BLUEPRINT_NODE_TYPE_GAME_EXPORT_PROGRESS,
  BLUEPRINT_NODE_TYPE_GAME_IMPORT_PROGRESS
} from "@shared/types/blueprint/graph";
import type { BlueprintNodeDef, BlueprintNodePinDef } from "../types";
import { requireHostApi } from "./hostApi";

const execIn: BlueprintNodePinDef = { id: "in", kind: "input", semantic: "exec", label: "In" };
const errorOut: BlueprintNodePinDef = {
  id: "error",
  kind: "output",
  semantic: "data",
  valueType: "string",
  label: "Error"
};

export const progressBlueprintNodes: BlueprintNodeDef[] = [
  {
    /**
     * Write everything this playthrough holds into the title's progress document.
     *
     * Takes nothing. What travels is the project's declared variables plus the position, and an
     * author who could pick a subset here would be picking it once, in one graph, for a document
     * the OTHER edition has to be able to read - so the set is the project's, not the node's.
     *
     * `Failed` covers a shell that cannot write (a web export), a build with no progress key,
     * and a disk that refused, with `Error` saying which. They share a pin because the author's
     * answer to all three is the same: tell the player it did not happen.
     */
    type: BLUEPRINT_NODE_TYPE_GAME_EXPORT_PROGRESS,
    displayName: "Export Progress",
    category: "Game",
    keywords: [
      "progress",
      "export",
      "carry",
      "transfer",
      "demo",
      "full",
      "edition",
      "save",
      "continue",
      "write"
    ],
    graphKinds: ["event", "macro"],
    isPure: false,
    isLatent: true,
    pins: [
      execIn,
      { id: "next", kind: "output", semantic: "exec", label: "Next" },
      { id: "failed", kind: "output", semantic: "exec", label: "Failed" },
      errorOut
    ],
    async execute(ctx) {
      const result = await requireHostApi(ctx).progress.export();
      return {
        nextPort: result.outcome === "written" ? "next" : "failed",
        outputValues: { error: result.error }
      };
    }
  },
  {
    /**
     * Read the title's progress document and apply what it holds to the running game.
     *
     * Three ways out, because the author answers each differently. `Missing` is the ordinary
     * state of everybody who never exported - a fresh install, a player who went straight to the
     * full game - and it leads to "start a new game", not to an apology; folding it into
     * `Failed` would put an error in front of every first-time player. `Failed` is a document
     * that would not read: written by a newer build, belonging to another title, or corrupt.
     *
     * `Scene` is where the player had got to, and it is blank when the document anchors nowhere
     * (progress carried with no playthrough in flight). Wire it into `Start Game`; nothing here
     * goes anywhere with it.
     */
    type: BLUEPRINT_NODE_TYPE_GAME_IMPORT_PROGRESS,
    displayName: "Import Progress",
    category: "Game",
    keywords: [
      "progress",
      "import",
      "carry",
      "transfer",
      "demo",
      "full",
      "edition",
      "continue",
      "resume",
      "read"
    ],
    graphKinds: ["event", "macro"],
    isPure: false,
    isLatent: true,
    pins: [
      execIn,
      { id: "found", kind: "output", semantic: "exec", label: "Found" },
      { id: "missing", kind: "output", semantic: "exec", label: "Missing" },
      { id: "failed", kind: "output", semantic: "exec", label: "Failed" },
      { id: "sceneId", kind: "output", semantic: "data", valueType: "string", label: "Scene" },
      errorOut
    ],
    async execute(ctx) {
      const result = await requireHostApi(ctx).progress.import();
      return {
        nextPort: result.outcome,
        outputValues: { sceneId: result.sceneId, error: result.error }
      };
    }
  }
];
