/**
 * The speaker picker's candidates, filed under the cast groups the Characters panel files them under.
 *
 * A project with a sizeable cast keeps it in groups, and a picker that ignored them offered one flat
 * list of every name in the project - the one place in Studio where the author's own filing was
 * thrown away. The order here is the panel's order: the ungrouped cast first, then each group under
 * its name, so "which group is this character in" has one answer wherever it is asked.
 *
 * Bare names stay at the end. A temp speaker belongs to no group, and the name being typed has to
 * remain the last entry for Tab and Enter to keep meaning what they mean (see `getSpeakerCandidates`).
 *
 * Comments in English per project convention.
 */

import type { Character } from "@/lib/workspace/services/character/Character";

/** The shape this reads off a candidate: which kind it is, and whose profile holds the group. */
export type GroupableSpeakerCandidate =
    | { key: string; kind: "character"; character: Character }
    | { key: string; kind: "temp" };

/**
 * One line of the drawn list.
 *
 *  - `candidate` — a speaker.
 *  - `label` — a group's name over its members, drawn on the way past rather than offered.
 *  - `group` — a whole group as one entry, whose members open in a column beside it. The arrow keys
 *    stop on it; its members are not in the list at all until that column is open.
 */
export type SpeakerPickerEntry<T> =
    | { kind: "candidate"; candidate: T }
    | { kind: "label"; groupId: string; name: string }
    | { kind: "group"; groupId: string; name: string; members: T[] };

/**
 * How groups are drawn: `inline` lists each group's members under its name; `submenus` makes each
 * group one entry with its members in a column of their own.
 */
export type SpeakerGroupLayout = "inline" | "submenus";

export interface GroupedSpeakerCandidates<T> {
    /** Every candidate in the order `inline` draws them, members of a group right after its name. */
    ordered: T[];
    /** What is drawn in the list, in order. */
    entries: SpeakerPickerEntry<T>[];
}

/**
 * File `candidates` under `groupNames`, which is the group list in the order the service returns it.
 *
 * A character whose group has since been deleted is ungrouped here as well: the picker shows what the
 * project holds, and a header for a group that is gone would name nothing.
 */
export function groupSpeakerCandidates<T extends GroupableSpeakerCandidate>(
    candidates: readonly T[],
    groupNames: ReadonlyMap<string, string>,
    layout: SpeakerGroupLayout = "inline",
): GroupedSpeakerCandidates<T> {
    const ungrouped: T[] = [];
    const temps: T[] = [];
    const members = new Map<string, T[]>();

    for (const candidate of candidates) {
        if (candidate.kind !== "character") {
            temps.push(candidate);
            continue;
        }
        const groupId = candidate.character.profile.getGroupId();
        if (!groupId || !groupNames.has(groupId)) {
            ungrouped.push(candidate);
            continue;
        }
        const bucket = members.get(groupId);
        if (bucket) {
            bucket.push(candidate);
        } else {
            members.set(groupId, [candidate]);
        }
    }

    const ordered = [...ungrouped];
    const entries: SpeakerPickerEntry<T>[] = ungrouped.map(candidate => ({ kind: "candidate", candidate }));
    for (const [groupId, name] of groupNames) {
        const bucket = members.get(groupId);
        if (!bucket || bucket.length === 0) {
            continue;
        }
        ordered.push(...bucket);
        if (layout === "submenus") {
            entries.push({ kind: "group", groupId, name, members: bucket });
            continue;
        }
        entries.push({ kind: "label", groupId, name });
        entries.push(...bucket.map(candidate => ({ kind: "candidate" as const, candidate })));
    }
    ordered.push(...temps);
    entries.push(...temps.map(candidate => ({ kind: "candidate" as const, candidate })));

    return { ordered, entries };
}
