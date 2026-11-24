/**
 * The file a transform preset or a Story Motion travels in.
 *
 * Both are library entries an author builds once and reuses, and both are stuck inside the project
 * that holds them: there is no way to take a move you like to the next project, or to hand one to
 * somebody else. This is that file - plain JSON, one envelope, any number of items.
 *
 * **It carries data, never references.** A motion's `previewAssetId` and `previewBackgroundAssetId`
 * are editor-only pointers at images in the project it came from (the compiler ignores them), so an
 * exported motion drops them: kept, they would name files the importing project does not have and
 * the preview would draw whatever happened to share the id. Ids and timestamps go the same way -
 * importing mints new ones, because the item arriving is a new entry in this project, not the same
 * entry in two places.
 *
 * Decoding is a shape gate, not a migration. What survives it is handed to the service that owns the
 * kind (`TransformPresetService.savePreset`, `StoryService.createAnimationAsset`), and those
 * normalize as they do for anything else written through them.
 *
 * Comments in English per project convention.
 */

import type {
    StoryAnimationAsset,
    StoryAnimationConfig,
    StoryAnimationSequence,
    StoryAnimationTimeline,
    StoryMotionTargetKind,
    StoryTransformRef,
} from "../types/story";
import type { StoryCustomCommand } from "../types/story/customCommands";
import { normalizeStoryCustomCommandDocument } from "./customCommands";
import {
    normalizeTransformPresetName,
    normalizeTransformPresetTransform,
    type ProjectTransformPreset,
} from "../types/transformPreset";

/** What every exported file says it is. A file without this is not one of ours. */
export const LIBRARY_EXCHANGE_FORMAT = "narraleaf.library";

/** Bumped only for a change a build reading v1 could not make sense of. */
export const LIBRARY_EXCHANGE_VERSION = 1;

/** The two libraries that can travel. Each surface exports and imports exactly one of them. */
export type LibraryExchangeKind = "transform-preset" | "story-motion" | "story-command";

export type TransformPresetExchangeItem = {
    name: string;
    transform: StoryTransformRef;
};

export type StoryMotionExchangeItem = {
    name: string;
    targetKind: StoryMotionTargetKind;
    timeline?: StoryAnimationTimeline;
    sequences?: StoryAnimationSequence[];
    config?: StoryAnimationConfig;
};

/**
 * Why a file could not be read, as one word the surface turns into a sentence.
 *
 * Separate reasons rather than one failure because they ask for different things of the author:
 * `wrongKind` means they picked the file for the other library and should pick again, `tooNew` means
 * the file is fine and this Studio is old, and `unreadable` means the file is not one of ours at all.
 */
export type LibraryExchangeFailure = "unreadable" | "wrongKind" | "tooNew" | "empty";

export type LibraryExchangeResult<T> =
    | { ok: true; items: T[] }
    | { ok: false; reason: LibraryExchangeFailure };

/**
 * The motion target kinds an exported file may name.
 *
 * Spelled here rather than taken from the renderer's normalizer on purpose: that one answers `image`
 * for anything it does not recognise, which is the right answer for a document Studio itself wrote
 * and the wrong one for a file from somewhere else - a motion built for the camera would arrive as a
 * sprite move and look like a Studio bug rather than an unreadable file.
 */
const MOTION_TARGET_KINDS: readonly StoryMotionTargetKind[] = ["image", "text", "layer", "character", "camera"];

type Envelope = {
    format: string;
    version: number;
    kind: LibraryExchangeKind;
    items: unknown[];
};

/** The whole file, pretty-printed: this is a document an author may open in an editor. */
export function encodeTransformPresetExchange(presets: readonly ProjectTransformPreset[]): string {
    const items: TransformPresetExchangeItem[] = presets.map(preset => ({
        name: preset.name,
        transform: preset.transform,
    }));
    return encode("transform-preset", items);
}

export function encodeStoryMotionExchange(assets: readonly StoryAnimationAsset[]): string {
    const items: StoryMotionExchangeItem[] = assets.map(asset => {
        const item: StoryMotionExchangeItem = { name: asset.name, targetKind: asset.targetKind };
        // Only what the compiler reads. `previewAssetId`, `previewBackgroundAssetId`, `id`, `meta`
        // and `schemaVersion` are all about this motion's life in the project it came from.
        if (asset.timeline) {
            item.timeline = asset.timeline;
        }
        if (asset.sequences && asset.sequences.length > 0) {
            item.sequences = asset.sequences;
        }
        if (asset.config && Object.keys(asset.config).length > 0) {
            item.config = asset.config;
        }
        return item;
    });
    return encode("story-motion", items);
}

export function decodeTransformPresetExchange(text: string): LibraryExchangeResult<TransformPresetExchangeItem> {
    return decode(text, "transform-preset", raw => {
        const record = raw as Partial<TransformPresetExchangeItem>;
        const name = normalizeTransformPresetName(record.name);
        const transform = normalizeTransformPresetTransform(record.transform);
        return name && transform ? { name, transform } : null;
    });
}

export function decodeStoryMotionExchange(text: string): LibraryExchangeResult<StoryMotionExchangeItem> {
    return decode(text, "story-motion", raw => {
        const record = raw as Partial<StoryMotionExchangeItem>;
        const name = typeof record.name === "string" ? record.name.trim() : "";
        if (!name || !MOTION_TARGET_KINDS.includes(record.targetKind as StoryMotionTargetKind)) {
            return null;
        }
        // A motion with neither a timeline nor a sequence states no movement at all. The service
        // would seed it with a default sequence and the author would import an empty motion.
        const hasTimeline = Boolean(record.timeline && Array.isArray(record.timeline.tracks) && record.timeline.tracks.length > 0);
        const hasSequences = Array.isArray(record.sequences) && record.sequences.length > 0;
        if (!hasTimeline && !hasSequences) {
            return null;
        }
        const item: StoryMotionExchangeItem = { name, targetKind: record.targetKind as StoryMotionTargetKind };
        if (hasTimeline) {
            item.timeline = record.timeline;
        }
        if (hasSequences) {
            item.sequences = record.sequences;
        }
        if (record.config && typeof record.config === "object") {
            item.config = record.config;
        }
        return item;
    });
}

/**
 * A file name for what is being exported.
 *
 * One item is named after itself, several after the library, because a file called `Shake.json`
 * holding eleven motions is a file whose name is a lie. Reduced to what every filesystem takes,
 * which for a Chinese or Japanese name means keeping it: only the characters a path cannot hold are
 * replaced.
 */
/**
 * The project's own story commands, as a file another project can import - and, because the file is
 * plain text, as something to paste into a chat.
 *
 * Every command a chosen one calls is carried with it, so the file plays on its own: a command made
 * of commands that left its parts behind would import as calls to nothing. Ids travel, so the
 * importer can point the calls inside at the copies it makes (`StoryCustomCommandService`).
 *
 * What does not travel is what the rows NAME in the project they came from: a character or a file
 * written into a row rather than passed as a parameter. Parameters are how a command is made to work
 * anywhere, and the importing project's lint names whatever does not resolve.
 */
export function encodeStoryCommandExchange(chosen: readonly StoryCustomCommand[], all: readonly StoryCustomCommand[]): string {
    const byId = new Map(all.map(command => [command.id, command]));
    const carried = new Map<string, StoryCustomCommand>();
    const visit = (command: StoryCustomCommand) => {
        if (carried.has(command.id)) {
            return;
        }
        carried.set(command.id, command);
        for (const row of command.rows) {
            const payload = row.block.kind === "action" ? row.block.payload : null;
            if (payload?.action === "customCommand") {
                const inner = byId.get(payload.commandId);
                if (inner) {
                    visit(inner);
                }
            }
        }
    };
    chosen.forEach(visit);
    return encode("story-command", [...carried.values()]);
}

export function decodeStoryCommandExchange(text: string): LibraryExchangeResult<StoryCustomCommand> {
    return decode(text, "story-command", raw => normalizeStoryCustomCommandDocument({ commands: [raw] }).commands[0] ?? null);
}

export function libraryExchangeFileName(kind: LibraryExchangeKind, names: readonly string[]): string {
    const fallback = kind === "transform-preset" ? "transform-presets" : kind === "story-command" ? "story-commands" : "story-motions";
    const base = names.length === 1 ? sanitizeFileName(names[0]) || fallback : fallback;
    return `${base}.json`;
}

function encode(kind: LibraryExchangeKind, items: unknown[]): string {
    const envelope: Envelope = {
        format: LIBRARY_EXCHANGE_FORMAT,
        version: LIBRARY_EXCHANGE_VERSION,
        kind,
        items,
    };
    return `${JSON.stringify(envelope, null, 2)}\n`;
}

function decode<T>(
    text: string,
    kind: LibraryExchangeKind,
    read: (raw: unknown) => T | null,
): LibraryExchangeResult<T> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { ok: false, reason: "unreadable" };
    }
    if (!parsed || typeof parsed !== "object") {
        return { ok: false, reason: "unreadable" };
    }
    const envelope = parsed as Partial<Envelope>;
    if (envelope.format !== LIBRARY_EXCHANGE_FORMAT || typeof envelope.version !== "number") {
        return { ok: false, reason: "unreadable" };
    }
    if (envelope.version > LIBRARY_EXCHANGE_VERSION) {
        return { ok: false, reason: "tooNew" };
    }
    if (envelope.kind !== kind) {
        return { ok: false, reason: "wrongKind" };
    }
    if (!Array.isArray(envelope.items)) {
        return { ok: false, reason: "unreadable" };
    }
    // Unreadable entries are dropped rather than failing the file: a file with nine good items and
    // one written by a newer build should bring in the nine. A file where nothing survives is
    // reported as empty, which is the only honest thing to say about it.
    const items = envelope.items.map(entry => (entry && typeof entry === "object" ? read(entry) : null))
        .filter((item): item is T => item !== null);
    return items.length > 0 ? { ok: true, items } : { ok: false, reason: "empty" };
}

/** Everything a path cannot hold, plus the leading dot that would make the file hidden. */
function sanitizeFileName(name: string): string {
    return name
        .replace(/[\/:*?"<>|]/g, " ")
        .replace(new RegExp("[\u0000-\u001f]", "g"), " ")
        .replace(/\s+/g, " ")
        .replace(/^\.+/, "")
        .trim()
        .slice(0, 80);
}
