/**
 * The transforms an author saved to reuse, at `editor/transform-presets.json`.
 *
 * Studio ships a closed list of named looks (`left`, `fadeIn`, `zoom` …) that the transform card's
 * dropdown offers. This document is the project's own list beside it: whatever an author has already
 * built out of channels, kept under a name and offered in the same dropdown.
 *
 * **A preset seeds, it does not own.** Picking one writes its channels into the row and nothing
 * points back here afterwards - the same bargain the shipped names and the motion gallery already
 * make. That is what makes the list safe to edit: deleting a preset cannot change a single row that
 * was written from it, because no row ever refers to one.
 *
 * What is stored is a {@link StoryTransformRef} in `props` mode - the destination bag, the optional
 * starting bag, the timing, and the clip-path generator when there is one. A Story Motion is not a
 * preset and cannot be saved as one: it is an asset with its own file, and a name pointing at it
 * would be a reference rather than a seed.
 *
 * Comments in English per project convention.
 */

import type { StoryTransformRef } from "./story";

/** Persisted document version for `editor/transform-presets.json`. Independent of every other document. */
export const TRANSFORM_PRESET_SCHEMA_VERSION = 1;

/** How long a preset name may be. Long enough for a sentence fragment, short enough for a menu row. */
export const TRANSFORM_PRESET_NAME_MAX = 60;

/** One saved transform. */
export type ProjectTransformPreset = {
    /** Generated, and the identity: renaming a preset leaves it the same preset. */
    id: string;
    /** What the author calls it. Never blank, and unique within the project. */
    name: string;
    /** The transform this preset seeds. Always `props` mode, never a motion. */
    transform: StoryTransformRef;
};

/** The persisted document. */
export type ProjectTransformPresetDocument = {
    schemaVersion: number;
    presets: ProjectTransformPreset[];
};

export function createEmptyProjectTransformPresetDocument(): ProjectTransformPresetDocument {
    return { schemaVersion: TRANSFORM_PRESET_SCHEMA_VERSION, presets: [] };
}

/**
 * A name as it is stored: trimmed, inner runs of whitespace collapsed, capped.
 *
 * Returns null for anything that is not a name, which is what the save dialog refuses on.
 */
export function normalizeTransformPresetName(raw: unknown): string | null {
    if (typeof raw !== "string") {
        return null;
    }
    const name = raw.replace(/\s+/g, " ").trim().slice(0, TRANSFORM_PRESET_NAME_MAX);
    return name.length > 0 ? name : null;
}

/**
 * The transform as a preset stores it.
 *
 * Everything that identifies a target or a motion is dropped rather than carried: `mode` is always
 * `props` here, and an `animationId` would make the preset a reference to an asset the author can
 * delete. Empty bags are dropped too, so "a preset that states nothing" cannot be written - the two
 * channels of a bag full of `undefined` and a bag that was never there are the same seed.
 */
export function normalizeTransformPresetTransform(raw: unknown): StoryTransformRef | null {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const source = raw as StoryTransformRef;
    const next: StoryTransformRef = { mode: "props" };

    const to = pruneBag(source.to);
    if (to) {
        next.to = to;
    }
    const from = pruneBag(source.from);
    if (from) {
        next.from = from;
    }
    if (source.clipReveal && typeof source.clipReveal === "object" && typeof source.clipReveal.kind === "string") {
        next.clipReveal = { ...source.clipReveal };
    }
    assignFinite(next, "durationMs", source.durationMs);
    assignFinite(next, "delayMs", source.delayMs);
    assignFinite(next, "repeat", source.repeat);
    assignFinite(next, "repeatDelayMs", source.repeatDelayMs);
    if (typeof source.easing === "string" && source.easing.length > 0) {
        next.easing = source.easing;
    }
    if (source.repeatType === "loop" || source.repeatType === "reverse" || source.repeatType === "mirror") {
        next.repeatType = source.repeatType;
    }

    return next.to || next.from || next.clipReveal ? next : null;
}

/**
 * The list as it is stored: readable records only, one per id, one per name, sorted by name.
 *
 * Sorted rather than kept in insertion order because the dropdown reads it in this order, and a list
 * that moves when a preset is renamed is a list an author has to search twice. Sorted by code unit
 * rather than by locale: the file is compared and merged, and an order that depended on the machine
 * that saved it would reorder the whole list for every teammate.
 */
export function normalizeTransformPresets(raw: unknown): ProjectTransformPreset[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const presets: ProjectTransformPreset[] = [];
    const ids = new Set<string>();
    const names = new Set<string>();

    for (const entry of raw) {
        if (!entry || typeof entry !== "object") {
            continue;
        }
        const record = entry as Partial<ProjectTransformPreset>;
        const id = typeof record.id === "string" ? record.id.trim() : "";
        const name = normalizeTransformPresetName(record.name);
        const transform = normalizeTransformPresetTransform(record.transform);
        if (!id || !name || !transform || ids.has(id) || names.has(name.toLowerCase())) {
            continue;
        }
        ids.add(id);
        names.add(name.toLowerCase());
        presets.push({ id, name, transform });
    }

    return presets.sort((left, right) => compare(left.name, right.name) || compare(left.id, right.id));
}

export function migrateProjectTransformPresetDocument(raw: unknown): ProjectTransformPresetDocument {
    const record = (raw && typeof raw === "object" ? raw : {}) as Partial<ProjectTransformPresetDocument>;
    return {
        schemaVersion: TRANSFORM_PRESET_SCHEMA_VERSION,
        presets: normalizeTransformPresets(record.presets),
    };
}

/**
 * A transform reduced to the string two of them are compared by.
 *
 * What the dropdown reads back with: a row carries a copy of the preset's bag and nothing saying
 * where it came from, so the only way to show the author the name they saved is to recognise the
 * bag. Keys are sorted and absent values are dropped, so two bags that state the same channels
 * compare equal however they were built.
 */
export function transformPresetSignature(transform: StoryTransformRef | undefined | null): string {
    const normalized = normalizeTransformPresetTransform(transform ?? undefined);
    if (!normalized) {
        return "";
    }
    return JSON.stringify(normalized, (_key, value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            return value;
        }
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .filter(([, entry]) => entry !== undefined)
                .sort(([left], [right]) => (left < right ? -1 : 1)),
        );
    });
}

/** Whether the project already holds this name. Case-insensitive, which is how an author reads a list. */
export function findTransformPresetByName(
    presets: readonly ProjectTransformPreset[],
    name: string,
): ProjectTransformPreset | null {
    const normalized = normalizeTransformPresetName(name)?.toLowerCase();
    if (!normalized) {
        return null;
    }
    return presets.find(preset => preset.name.toLowerCase() === normalized) ?? null;
}

/** Code-unit order, which is the same on every machine. */
function compare(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

/** Drop absent channels, and the whole bag when nothing is left. */
function pruneBag(bag: unknown): StoryTransformRef["to"] | undefined {
    if (!bag || typeof bag !== "object") {
        return undefined;
    }
    const entries = Object.entries(bag as Record<string, unknown>).filter(([, value]) => value !== undefined);
    return entries.length > 0 ? (Object.fromEntries(entries) as StoryTransformRef["to"]) : undefined;
}

function assignFinite<K extends "durationMs" | "delayMs" | "repeat" | "repeatDelayMs">(
    target: StoryTransformRef,
    key: K,
    value: unknown,
): void {
    if (typeof value === "number" && Number.isFinite(value)) {
        target[key] = value;
    }
}
