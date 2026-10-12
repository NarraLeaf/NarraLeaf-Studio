/**
 * Which story rows choose one of a character's looks - what a change to the character's appearance
 * leaves pointing at nothing.
 *
 * A row stores the look it asks for by id: a pose id on a `preset` character, a tag id per axis on a
 * `layered` one, a model-owned name on a puppet. They sit on the character row's payload and on an
 * inline expression event inside a line of dialogue, both as `{ characterId, pose?, tags?,
 * puppetName? }`, so the walk looks for that shape anywhere in a row rather than listing row kinds.
 *
 * Nothing rewrites those rows when the look goes: the compiler resolves a missing tag to the axis
 * default and a missing pose to the default pose, which plays - just not as written. So the tools
 * that remove looks report the rows instead, and the cold switch between kinds refuses until the
 * agent has seen them.
 *
 * Comments in English per project convention.
 */

import type { StoryLintStory } from "@/lib/agent-core";
import { scenesInOrder } from "./agentLookups";
import { rowsInOrder } from "./agentReferences";

type LookRef = { characterId?: unknown; pose?: unknown; tags?: unknown; puppetName?: unknown };

function chosenLooks(ref: LookRef): string[] {
    const out: string[] = [];
    if (typeof ref.pose === "string" && ref.pose) {
        out.push(ref.pose);
    }
    if (ref.tags && typeof ref.tags === "object") {
        out.push(...Object.values(ref.tags as Record<string, unknown>).filter((tag): tag is string => typeof tag === "string"));
    }
    if (typeof ref.puppetName === "string" && ref.puppetName.trim()) {
        out.push(ref.puppetName);
    }
    return out;
}

/** Whether `value` holds, anywhere, a look choice for `characterId` (restricted to `lookIds` when given). */
function choosesLook(value: unknown, characterId: string, lookIds: ReadonlySet<string> | null): boolean {
    if (Array.isArray(value)) {
        return value.some(item => choosesLook(item, characterId, lookIds));
    }
    if (!value || typeof value !== "object") {
        return false;
    }
    const ref = value as LookRef;
    if (ref.characterId === characterId) {
        const looks = chosenLooks(ref);
        if (looks.length > 0 && (lookIds === null || looks.some(look => lookIds.has(look)))) {
            return true;
        }
    }
    return Object.values(value as Record<string, unknown>).some(item => choosesLook(item, characterId, lookIds));
}

/**
 * Every row that chooses a look of `characterId`, one readable line each, placed the way the delete
 * tools place a referrer. With `lookIds`, only the rows choosing one of those looks.
 */
export function storyRowsChoosingLook(
    stories: readonly StoryLintStory[],
    characterId: string,
    lookIds: readonly string[] | null = null,
): string[] {
    const wanted = lookIds ? new Set(lookIds) : null;
    if (wanted && wanted.size === 0) {
        return [];
    }
    const out: string[] = [];
    for (const story of stories) {
        for (const scene of scenesInOrder(story.document)) {
            rowsInOrder(scene).forEach((block, index) => {
                if (choosesLook(block.payload, characterId, wanted)) {
                    out.push(`story "${story.name}", scene "${scene.name}", row ${index + 1} (${block.kind})`);
                }
            });
        }
    }
    return out;
}
