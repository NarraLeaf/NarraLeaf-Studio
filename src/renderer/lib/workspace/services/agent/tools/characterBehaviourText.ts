/**
 * A character's behaviours as the agent reads and writes them: each event a list of `.story` command
 * lines, in the canonical vocabulary - the same words `story_apply` takes, printed by the same
 * projection the story editor prints a row with.
 *
 * Lines rather than stored rows because a row stores ids (`characterId`, an asset id) and an agent
 * writes names; and so that what `characters_list` shows can be sent back to `character_upsert`
 * unchanged.
 *
 * Comments in English per project convention.
 */

import {
    CHARACTER_BEHAVIOUR_EVENTS,
    isCharacterBehaviourEvent,
    type CharacterBehaviourEvent,
    type CharacterBehaviours,
} from "@shared/story/characterBehaviours";
import type { StoryBlock } from "@shared/types/story";
import { projectStoryCommandLine } from "@/apps/workspace/modules/story/scene-editor/storyCommandLine";
import { buildBehaviourBlockFromLine } from "@/apps/workspace/modules/story/scene-editor/storyBehaviourLine";
import { buildContext } from "@/lib/story-cli/model";
import { buildLookups } from "@/lib/story-cli/lookups";
import type { WorkspaceContext } from "../../services";
import { refuse } from "../agentCall";
import { storyProjectDataOf, withCanonicalCommandVocabulary } from "./textFormat";

export type CharacterBehaviourLines = Partial<Record<CharacterBehaviourEvent, string[]>>;

/** Every event the character reacts to, its rows printed as lines; null when it has none. */
export function behaviourLinesOf(ctx: WorkspaceContext, behaviours: CharacterBehaviours | undefined): CharacterBehaviourLines | null {
    if (!behaviours || Object.keys(behaviours).length === 0) {
        return null;
    }
    const data = storyProjectDataOf(ctx);
    const lookups = buildLookups(data, null, null, buildContext(data, null, null)).rowLookups;
    return withCanonicalCommandVocabulary(() => {
        const lines: CharacterBehaviourLines = {};
        for (const event of CHARACTER_BEHAVIOUR_EVENTS) {
            const rows = behaviours[event];
            if (rows) {
                lines[event] = rows.flatMap(row => {
                    const projected = projectStoryCommandLine(row, lookups);
                    return projected ? [projected.source] : [];
                });
            }
        }
        return lines;
    });
}

/**
 * The behaviours a `character_upsert` call asks for: `undefined` to leave them, `null` to clear them,
 * or every event given replaced by the rows its lines write. An event left out of the object is
 * kept as it was; an event given as `[]` is kept with no rows, as the properties panel keeps one.
 *
 * Every line is read before anything is written, so one bad line writes nothing.
 */
export function readBehaviourLines(
    ctx: WorkspaceContext,
    raw: unknown,
    current: CharacterBehaviours | undefined,
): CharacterBehaviours | null | undefined {
    if (raw === undefined) {
        return undefined;
    }
    if (raw === null) {
        return null;
    }
    if (typeof raw !== "object" || Array.isArray(raw)) {
        throw refuse("invalid_args", "`behaviours` must be { startSpeaking?: string[], stopSpeaking?: string[] } or null.");
    }
    const data = storyProjectDataOf(ctx);
    const context = buildContext(data, null, null);
    const next: CharacterBehaviours = { ...(current ?? {}) };
    for (const [event, lines] of Object.entries(raw as Record<string, unknown>)) {
        if (!isCharacterBehaviourEvent(event)) {
            throw refuse("invalid_args", `behaviours.${event}: not an event (expected ${CHARACTER_BEHAVIOUR_EVENTS.join(", ")}).`);
        }
        if (lines === null) {
            delete next[event];
            continue;
        }
        if (!Array.isArray(lines) || lines.some(line => typeof line !== "string")) {
            throw refuse("invalid_args", `behaviours.${event} must be a list of command lines, or null to remove the event.`);
        }
        const rows: StoryBlock[] = [];
        for (const line of lines as string[]) {
            const result = buildBehaviourBlockFromLine(line, context);
            if (!result.ok) {
                throw refuse(
                    "invalid_args",
                    result.reason === "notAllowed"
                        ? `behaviours.${event}: "${line}" is not a command a behaviour can run.`
                        : `behaviours.${event}: "${line}" is not a complete command line.`,
                    result.reason === "notAllowed"
                        ? "Behaviours run stage commands only: /transform (a character or the camera), /char, /front, /motion, /skin, /param, /reset and /sound."
                        : "Write it as a .story command line, the way story_apply takes it.",
                );
            }
            rows.push(result.block);
        }
        next[event] = rows;
    }
    return next;
}
