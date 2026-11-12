/**
 * Pure model behind scene content history (automatic and manual content snapshots of one scene).
 *
 * Not the variable snapshots of `modules/story-snapshots` (StoryScene.sceneSnapshots), which are
 * named sets of variable values and ship in the story document. Content snapshots are copies of a
 * whole scene, kept under `.nlstudio/` (unversioned, unpackaged) so they never reach a build or a
 * merge. Comments in English per convention.
 */

import type { StoryBlock, StoryBlockId, StoryScene } from "@shared/types/story";

export type SceneHistoryKind = "auto" | "manual";

export type SceneHistoryEntryMeta = {
    id: string;
    kind: SceneHistoryKind;
    /** Epoch milliseconds. */
    createdAt: number;
    /** Author-given name, manual snapshots only. */
    label?: string;
    /** {@link hashString} of the serialized scene - what "unchanged since the last snapshot" compares. */
    hash: string;
    blockCount: number;
};

export type SceneHistoryIndex = {
    version: 1;
    entries: SceneHistoryEntryMeta[];
};

export type SceneHistoryRetentionPolicy = {
    /** The newest automatic snapshots kept unconditionally. */
    keepRecent: number;
    /** Beyond those, one automatic snapshot (the newest) per calendar day, for this many days. */
    keepDaily: number;
    /** Hard cap on automatic snapshots per scene. Manual snapshots are never pruned by policy. */
    maxAuto: number;
};

export const DEFAULT_RETENTION_POLICY: SceneHistoryRetentionPolicy = {
    keepRecent: 20,
    keepDaily: 14,
    maxAuto: 40,
};

/** FNV-1a, 32-bit, hex. Collisions only cost one skipped snapshot, never data. */
export function hashString(text: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}

function localDayKey(ms: number): string {
    const date = new Date(ms);
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/**
 * Which entries survive the policy. Manual entries always survive; automatic ones survive when
 * they are among the newest `keepRecent`, or the newest of their day for the newest `keepDaily`
 * days that have one - and in either case only up to `maxAuto`, newest first.
 */
export function applyRetention(
    entries: readonly SceneHistoryEntryMeta[],
    policy: SceneHistoryRetentionPolicy = DEFAULT_RETENTION_POLICY,
): { keep: SceneHistoryEntryMeta[]; drop: SceneHistoryEntryMeta[] } {
    const auto = entries.filter(entry => entry.kind === "auto").sort((a, b) => b.createdAt - a.createdAt);
    const survivors = new Set<string>();
    auto.slice(0, Math.max(0, policy.keepRecent)).forEach(entry => survivors.add(entry.id));
    const days = new Set<string>();
    for (const entry of auto) {
        const day = localDayKey(entry.createdAt);
        if (days.has(day)) continue;
        if (days.size >= Math.max(0, policy.keepDaily)) break;
        days.add(day);
        survivors.add(entry.id);
    }
    const keptAuto = auto.filter(entry => survivors.has(entry.id)).slice(0, Math.max(0, policy.maxAuto));
    const keepIds = new Set(keptAuto.map(entry => entry.id));
    const keep: SceneHistoryEntryMeta[] = [];
    const drop: SceneHistoryEntryMeta[] = [];
    for (const entry of entries) {
        (entry.kind === "manual" || keepIds.has(entry.id) ? keep : drop).push(entry);
    }
    return { keep, drop };
}

/** What a row is, for history purposes: everything but its place in the tree. */
export function rowSignature(block: StoryBlock): string {
    return JSON.stringify({ kind: block.kind, payload: block.payload, disabled: block.disabled === true });
}

export type RowHistorySource =
    | { kind: "snapshot"; entry: SceneHistoryEntryMeta }
    | { kind: "revision"; revision: string; number: number; message?: string };

export type RowHistoryInput = {
    source: RowHistorySource;
    /** Epoch milliseconds. */
    at: number;
    /** The scene as that source holds it, or null when the source does not contain the scene. */
    scene: StoryScene | null;
};

export type RowVersion = {
    source: RowHistorySource;
    at: number;
    /** The row in that source, or null when the source has the scene but not this row (deleted / not yet written). */
    block: StoryBlock | null;
    signature: string | null;
};

/**
 * The distinct versions one row went through, newest first. A run of sources holding the same row
 * collapses to its newest member; a version identical to `current` is dropped (it is not a change),
 * and so are sources that do not contain the scene at all.
 */
export function extractRowVersions(
    blockId: StoryBlockId,
    current: StoryBlock | null,
    inputs: readonly RowHistoryInput[],
): RowVersion[] {
    const currentSignature = current ? rowSignature(current) : null;
    const sorted = inputs.filter(input => input.scene !== null).sort((a, b) => b.at - a.at);
    const versions: RowVersion[] = [];
    const seen = new Set<string | null>([currentSignature]);
    for (const input of sorted) {
        const block = input.scene!.blocks[blockId] ?? null;
        const signature = block ? rowSignature(block) : null;
        if (seen.has(signature)) continue;
        seen.add(signature);
        versions.push({ source: input.source, at: input.at, block, signature });
    }
    return versions;
}

/** A scene with one row's content set back to `version`, tree position untouched. Null if the row is gone. */
export function sceneWithRowRestored(scene: StoryScene, version: StoryBlock): StoryScene | null {
    const existing = scene.blocks[version.id];
    if (!existing) return null;
    const restored = {
        ...existing,
        kind: version.kind,
        payload: JSON.parse(JSON.stringify(version.payload)),
        disabled: version.disabled,
    } as StoryBlock;
    if (restored.disabled === undefined) delete restored.disabled;
    return { ...scene, blocks: { ...scene.blocks, [version.id]: restored } };
}
