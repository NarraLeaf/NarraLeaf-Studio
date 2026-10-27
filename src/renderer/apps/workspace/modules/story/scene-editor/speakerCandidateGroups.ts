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

/** A cast group's header as the picker draws it. */
export interface SpeakerGroupHeader {
    groupId: string;
    name: string;
    /** Members on show under the current query, counted whether or not the group is folded. */
    count: number;
    collapsed: boolean;
}

/** One line of the drawn list: a group's header, or a candidate. */
export type SpeakerPickerEntry<T> =
    | { kind: "header"; header: SpeakerGroupHeader }
    | { kind: "candidate"; candidate: T };

export interface GroupedSpeakerCandidates<T> {
    /**
     * The candidates the arrow keys walk, in the order they are drawn.
     *
     * A folded group's members are not here: a highlight that stepped onto a row nobody can see would
     * leave Enter choosing a speaker the author never looked at.
     */
    ordered: T[];
    /**
     * Everything drawn, headers included.
     *
     * A header is drawn rather than offered: it is not a candidate, so the arrow keys walk straight
     * past it. It does keep its place when its group is folded, which is the one way back in short
     * of typing.
     */
    entries: SpeakerPickerEntry<T>[];
}

/**
 * File `candidates` under `groupNames`, which is the group list in the order the service returns it.
 *
 * A character whose group has since been deleted is ungrouped here as well: the picker shows what the
 * project holds, and a header for a group that is gone would name nothing.
 *
 * `isCollapsed` folds a group to its header. Leave it out to unfold everything, which is what a typed
 * query wants: a search has to reach every member, folded or not.
 */
export function groupSpeakerCandidates<T extends GroupableSpeakerCandidate>(
    candidates: readonly T[],
    groupNames: ReadonlyMap<string, string>,
    isCollapsed?: (groupId: string) => boolean,
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
        const collapsed = isCollapsed?.(groupId) ?? false;
        entries.push({ kind: "header", header: { groupId, name, count: bucket.length, collapsed } });
        if (collapsed) {
            continue;
        }
        ordered.push(...bucket);
        entries.push(...bucket.map(candidate => ({ kind: "candidate" as const, candidate })));
    }
    ordered.push(...temps);
    entries.push(...temps.map(candidate => ({ kind: "candidate" as const, candidate })));

    return { ordered, entries };
}
