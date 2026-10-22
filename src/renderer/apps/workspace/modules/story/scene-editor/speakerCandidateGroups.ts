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

export interface GroupedSpeakerCandidates<T> {
    /** The candidates in the order they are drawn, which is the order the arrow keys walk. */
    ordered: T[];
    /**
     * Candidate key -> the group name drawn immediately above that candidate.
     *
     * A header per group rather than a section object, because the list is one flat run of pickable
     * rows: the arrow keys step candidates, and a header is something the picker draws on the way
     * past rather than a stop of its own.
     */
    headers: ReadonlyMap<string, string>;
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
    const headers = new Map<string, string>();
    for (const [groupId, name] of groupNames) {
        const bucket = members.get(groupId);
        if (!bucket || bucket.length === 0) {
            continue;
        }
        headers.set(bucket[0].key, name);
        ordered.push(...bucket);
    }
    ordered.push(...temps);

    return { ordered, headers };
}
