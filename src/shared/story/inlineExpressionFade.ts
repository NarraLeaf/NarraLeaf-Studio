import type { StoryBlockId, StoryInlineEvent, StoryRichRun, StoryScene } from "@shared/types/story";

/**
 * The cross-fade of inline expression changes, which carries forward through a scene.
 *
 * An expression change with its own `fadeMs` (0 included, which turns the fade off) uses it, and so
 * does every change after it that sets none, until a later change sets its own. A change that sets
 * none takes the one in effect before it. Setting a change therefore reaches forward and never back:
 * the changes before it keep what they had.
 *
 * "Before" is the scene's document order - the same pre-order walk the dialogue differential chips
 * accumulate along (`buildDialogueAppearances`) - across lines and speakers alike, and within a line
 * the order of its runs. Every scene starts with no fade. Like those chips it reads the tree linearly
 * and does not model which branch ran: a change inside an `if` sets the fade for what follows the
 * `if` too, which is what the author reads down the page.
 *
 * The editor and the compiler both read it from here, so what the settings show inherited is what
 * the game plays.
 */

/** A change's own fade, or undefined when it sets none and takes the one in effect. */
export function ownInlineFadeMs(event: StoryInlineEvent): number | undefined {
    const value = event.expression?.fadeMs;
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Walk a line's runs from `startMs`, the fade in effect as the line begins: each expression change's
 * fade, keyed by its run, and the fade in effect after the last of them. A sound-only event carries
 * no fade and passes the current one through untouched.
 */
export function foldInlineFades(
    runs: readonly StoryRichRun[] | undefined,
    startMs: number,
): { fades: Map<StoryRichRun, number>; endMs: number } {
    const fades = new Map<StoryRichRun, number>();
    let current = startMs;
    for (const run of runs ?? []) {
        if (!("event" in run) || !run.event.expression) {
            continue;
        }
        current = ownInlineFadeMs(run.event) ?? current;
        fades.set(run, current);
    }
    return { fades, endMs: current };
}

const atBlockStartCache = new WeakMap<StoryScene, ReadonlyMap<StoryBlockId, number>>();

/**
 * The fade in effect as each narration or dialogue row of `scene` begins, for every row that has
 * text. Cached per scene object: a scene is replaced, never mutated, when it is edited.
 */
export function inlineFadesAtBlockStart(scene: StoryScene): ReadonlyMap<StoryBlockId, number> {
    const cached = atBlockStartCache.get(scene);
    if (cached) {
        return cached;
    }
    const result = new Map<StoryBlockId, number>();
    let current = 0;
    const visit = (blockId: StoryBlockId) => {
        const block = scene.blocks[blockId];
        if (!block) {
            return;
        }
        if (block.kind === "nodeAction" && (block.payload.action === "dialogue" || block.payload.action === "narration")) {
            result.set(block.id, current);
            current = foldInlineFades(block.payload.text.rich, current).endMs;
        }
        block.childrenIds.forEach(visit);
    };
    scene.rootBlockIds.forEach(visit);
    atBlockStartCache.set(scene, result);
    return result;
}
