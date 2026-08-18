/**
 * Quick Save blueprint node definitions, shared by both plugin entries:
 * - main.ts (studio entry) registers the full defs for the editor palette
 *   and in-editor preview execution.
 * - runtime.ts (runtime entry) registers the execute bindings for game
 *   execution environments (Dev Mode window, Preview, Production).
 *
 * All nodes operate on one reserved save slot id that players never see,
 * so a story graph gets quick save / quick read without managing ids.
 *
 * Powers come from `app.game`, the capability-gated surface the manifest
 * declares (`contributes.runtimeCapabilities`): `saves.read` to see whether the
 * slot exists, `saves.write` to fill or restore it.
 */

import type { PluginBlueprintNodeContext, PluginBlueprintNodeDef } from "narraleaf-studio/plugin";

/** The capability-gated game surface a node execute is handed. */
type NodeGame = PluginBlueprintNodeContext["game"];

export const PLUGIN_ID = "narraleaf.quick-save";
export const QUICK_SAVE_SLOT_ID = `${PLUGIN_ID}.slot`;

/**
 * The write half is gated on `saves.write` *and* on the environment backing it,
 * so it can legitimately be absent (an editor preview backs nothing). Failing
 * with a named reason beats a silent no-op: a story graph whose quick save never
 * happened should say so.
 */
function requireSaveWriting(game: NodeGame): NonNullable<NodeGame["saves"]> {
  const saves = game.saves;
  if (!saves?.write || !saves.load) {
    throw new Error(
      'Quick Save needs the "saves.write" capability, and an environment that can serve it.'
    );
  }
  return saves;
}

export function createQuickSaveBlueprintNodes(): PluginBlueprintNodeDef[] {
  return [
    {
      type: `${PLUGIN_ID}.save`,
      displayName: "Quick Save",
      category: "Game",
      keywords: ["game", "save", "quick", "quicksave", "write", "slot"],
      graphKinds: ["event", "macro"],
      isPure: false,
      isLatent: true,
      pins: [
        { id: "in", kind: "input", semantic: "exec", label: "In" },
        { id: "next", kind: "output", semantic: "exec", label: "Next" }
      ],
      execute: async (ctx) => {
        await requireSaveWriting(ctx.game).write!(QUICK_SAVE_SLOT_ID);
        return { nextPort: "next" };
      }
    },
    {
      type: `${PLUGIN_ID}.load`,
      displayName: "Quick Read",
      category: "Game",
      keywords: ["game", "save", "load", "read", "quick", "quickload", "slot"],
      graphKinds: ["event", "macro"],
      isPure: false,
      isLatent: true,
      pins: [{ id: "in", kind: "input", semantic: "exec", label: "In" }],
      // No exec output: loading replaces the running playthrough, so
      // whatever followed this node in the old one is gone.
      execute: async (ctx) => {
        await requireSaveWriting(ctx.game).load!(QUICK_SAVE_SLOT_ID);
      }
    },
    {
      type: `${PLUGIN_ID}.has`,
      displayName: "Has Quick Save",
      category: "Game",
      keywords: ["game", "save", "quick", "quicksave", "has", "exists", "slot"],
      graphKinds: ["event", "macro"],
      isPure: false,
      isLatent: true,
      pins: [
        { id: "in", kind: "input", semantic: "exec", label: "In" },
        { id: "next", kind: "output", semantic: "exec", label: "Next" },
        {
          id: "hasQuickSave",
          kind: "output",
          semantic: "data",
          valueType: "boolean",
          label: "Has Save"
        }
      ],
      execute: async (ctx) => {
        return {
          nextPort: "next",
          outputValues: {
            hasQuickSave: await hasQuickSave(ctx.game)
          }
        };
      }
    }
  ];
}

/**
 * False when the environment cannot back `saves.read` at all - the editor has no
 * playthrough, so there is no quick save there by definition. Degrading beats
 * throwing: a menu graph previewed in Studio should render, not blow up.
 */
async function hasQuickSave(game: NodeGame): Promise<boolean> {
  if (!game.saves) {
    return false;
  }
  const ids = await game.saves.listIds();
  return ids.includes(QUICK_SAVE_SLOT_ID);
}
