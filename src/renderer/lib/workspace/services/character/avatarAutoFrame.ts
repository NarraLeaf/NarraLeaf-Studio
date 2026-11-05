import { characterAvatarTargets, type CharacterAvatarTarget } from "@shared/utils/characterAvatar";
import { mapCharacterStoreEntriesToSummaries } from "@shared/utils/characterSummaries";
import { translate } from "@/lib/i18n";
import { AssetType } from "../assets/assetTypes";
import { Services, type WorkspaceContext } from "../services";
import type { AssetsService } from "../core/AssetsService";
import type { CharacterService } from "../core/CharacterService";
import type { ConsoleService } from "../core/ConsoleService";
import type { UIService } from "../core/UIService";
import { Character } from "./Character";
import type { PortraitCrop, StoredCharacter } from "./types";

/**
 * Framing dialog avatars on the head the model finds: the Characters panel's "Auto-frame all", the
 * button beside a portrait's framing, and the `character_avatars_autoframe` agent tool all run this.
 *
 * What it writes is an ordinary per-differential framing - a preset pose's `portrait`, a layered
 * look's avatar-entry `portrait` - the same field the framing box writes. So everything downstream is
 * unchanged: the bake cuts the avatar with it, the box shows it and can adjust it, and "Clear
 * framing" takes it back to the automatic crop. It is the box placed for the author, not a new kind
 * of framing that would need its own rank in the bake's order.
 *
 * Each character lands as one step of undo through `commitCharacterRecord`, shaped on a fresh copy of
 * the live record at that moment: detection takes seconds, and an edit made meanwhile is kept.
 */

/** Locates a head in a stack of layers drawn centred; null when there is none. */
export type HeadFrameDetector = (layers: readonly ImageBitmap[]) => Promise<PortraitCrop | null>;

/** Why a differential was left as it was. */
export type AutoFrameSkip =
    /** The author drew this avatar; there is no framing to set. */
    | "override"
    /** It already has its own framing and the run was told to keep framings. */
    | "framed"
    /** Nothing draws for it, so there is nothing to look at. */
    | "empty";

export type AutoFrameOutcome =
    | { key: string; label: string; result: "framed"; crop: PortraitCrop }
    | { key: string; label: string; result: "noHead" }
    | { key: string; label: string; result: "unreadable" }
    | { key: string; label: string; result: "skipped"; reason: AutoFrameSkip };

export type AutoFrameCharacterReport = {
    characterId: string;
    name: string;
    outcomes: AutoFrameOutcome[];
};

export type AutoFrameReport = {
    characters: AutoFrameCharacterReport[];
    framed: number;
    noHead: number;
    kept: number;
};

/** One differential to look at. */
export type AutoFramePlanItem = {
    key: string;
    label: string;
    selection: CharacterAvatarTarget["selection"];
    /** The asset ids to draw, bottom to top. */
    layers: string[];
    skip?: AutoFrameSkip;
};

/**
 * The differentials of one character and what the run will do with each. Live2D, Spine and other
 * runtime-drawn characters have none: their avatar is the profile's default picture.
 */
export function planAutoFrame(character: Character, overwrite: boolean): AutoFramePlanItem[] {
    const appearance = character.profile.appearance;
    const kind = appearance.getKind();
    if (kind !== "preset" && kind !== "layered") {
        return [];
    }
    const summary = mapCharacterStoreEntriesToSummaries([character.toJSON()])[0];
    const tagNames = new Map(appearance.getAxes().flatMap(axis => axis.tags.map(tag => [tag.id, tag.name] as const)));
    return characterAvatarTargets(summary?.appearance).map(target => {
        const entry = appearance.getAvatar(target.key);
        const label = target.selection.poseId
            ? appearance.getPose(target.selection.poseId)?.name ?? target.key
            : Object.values(target.selection.tags ?? {}).map(tag => tagNames.get(tag) ?? tag).join("+");
        const layers = appearance.resolveDrawList(target.selection).filter((asset): asset is string => Boolean(asset));
        const ownFraming = Boolean(entry?.portrait)
            || Boolean(target.selection.poseId && appearance.getPose(target.selection.poseId)?.portrait);
        const skip: AutoFrameSkip | undefined = entry?.overrideAssetId?.trim()
            ? "override"
            : layers.length === 0
                ? "empty"
                : ownFraming && !overwrite
                    ? "framed"
                    : undefined;
        return { key: target.key, label, selection: target.selection, layers, skip };
    });
}

/**
 * Write found framings onto a copy of the character's record. A preset pose's framing lives on the
 * pose; an avatar-entry framing on the same key would outrank it in the bake, so it is cleared.
 */
export function applyAutoFrames(character: Character, frames: ReadonlyMap<string, { selection: CharacterAvatarTarget["selection"]; crop: PortraitCrop }>): StoredCharacter {
    const draft = Character.fromJSON(structuredClone(character.toJSON()));
    const appearance = draft.profile.appearance;
    for (const [key, { selection, crop }] of frames) {
        if (selection.poseId) {
            if (!appearance.getPose(selection.poseId)) continue;
            appearance.setPosePortrait(selection.poseId, { ...crop });
            if (appearance.getAvatarPortrait(key)) {
                appearance.setAvatarPortrait(key, null);
            }
        } else {
            appearance.setAvatarPortrait(key, { ...crop });
        }
    }
    return draft.toJSON() as StoredCharacter;
}

export type AutoFrameOptions = {
    /** Character ids, or every character with differentials when omitted. */
    characterIds?: readonly string[];
    /** Only these differentials of the (single) character; every one when omitted. */
    keys?: readonly string[];
    /** Replace framings a differential already has. Without it they are kept. */
    overwrite: boolean;
    detect: HeadFrameDetector;
    onProgress?: (done: number, total: number) => void;
    /** Asked before each character is written; throwing stops the run there. */
    beforeCommit?: () => void;
};

async function decodeLayer(assets: AssetsService, assetId: string): Promise<ImageBitmap | null> {
    const asset = assets.getAssets()[AssetType.Image]?.[assetId];
    if (!asset) return null;
    const fetched = await assets.fetch(asset).catch(() => null);
    if (!fetched?.success || !fetched.data) return null;
    return createImageBitmap(new Blob([new Uint8Array((fetched.data as { data: Uint8Array }).data)])).catch(() => null);
}

/** Let the window paint between pictures: inference holds this thread for a quarter of a second. */
const yieldToWindow = () => new Promise<void>(resolve => setTimeout(resolve, 0));

export async function autoFrameAvatars(ctx: WorkspaceContext, options: AutoFrameOptions): Promise<AutoFrameReport> {
    const cast = ctx.services.get<CharacterService>(Services.Character);
    const assets = ctx.services.get<AssetsService>(Services.Assets);
    const characters = options.characterIds
        ? options.characterIds.map(id => cast.getCharacter(id)).filter((item): item is Character => Boolean(item))
        : cast.listCharacter();
    const plans = characters.map(character => ({
        character,
        items: planAutoFrame(character, options.overwrite)
            .filter(item => !options.keys || options.keys.includes(item.key)),
    }));
    const total = plans.reduce((sum, plan) => sum + plan.items.filter(item => !item.skip).length, 0);
    let done = 0;
    options.onProgress?.(done, total);

    const report: AutoFrameReport = { characters: [], framed: 0, noHead: 0, kept: 0 };
    for (const { character, items } of plans) {
        if (items.length === 0) continue;
        const outcomes: AutoFrameOutcome[] = [];
        const frames = new Map<string, { selection: CharacterAvatarTarget["selection"]; crop: PortraitCrop }>();
        for (const item of items) {
            if (item.skip) {
                outcomes.push({ key: item.key, label: item.label, result: "skipped", reason: item.skip });
                if (item.skip === "framed") report.kept++;
                continue;
            }
            const decoded = await Promise.all(item.layers.map(asset => decodeLayer(assets, asset)));
            const bitmaps = decoded.filter((bitmap): bitmap is ImageBitmap => bitmap !== null);
            try {
                if (bitmaps.length === 0) {
                    outcomes.push({ key: item.key, label: item.label, result: "unreadable" });
                } else {
                    const crop = await options.detect(bitmaps);
                    if (crop) {
                        frames.set(item.key, { selection: item.selection, crop });
                        outcomes.push({ key: item.key, label: item.label, result: "framed", crop });
                        report.framed++;
                    } else {
                        outcomes.push({ key: item.key, label: item.label, result: "noHead" });
                        report.noHead++;
                    }
                }
            } finally {
                bitmaps.forEach(bitmap => bitmap.close());
            }
            done++;
            options.onProgress?.(done, total);
            await yieldToWindow();
        }
        if (frames.size > 0) {
            options.beforeCommit?.();
            // The live record now, not the one the plan was read from.
            const live = cast.getCharacter(character.profile.getId());
            if (live) {
                cast.commitCharacterRecord(applyAutoFrames(live, frames), {
                    key: "characters.history.autoFrameAvatars",
                    params: { name: live.profile.getName() },
                });
            }
        }
        report.characters.push({ characterId: character.profile.getId(), name: character.profile.getName(), outcomes });
    }
    return report;
}

// ── One run at a time, with the console's progress bar ──────────────────────────────────────────

export const AVATAR_CONSOLE_CHANNEL = "avatars";
/** `source` stamped on the run's console lines. */
export const AVATAR_CONSOLE_SOURCE = "Avatars";
const CONSOLE_PANEL_ID = "narraleaf-studio:console";
/** How long a finished run's full bar stays before it clears, as the build and test bars do. */
const DONE_LINGER_MS = 1500;

type RunState = { running: boolean };
let runState: RunState = { running: false };
const runListeners = new Set<() => void>();
let lingerTimer: ReturnType<typeof setTimeout> | null = null;
const registeredConsoles = new WeakSet<ConsoleService>();

function setRunState(next: RunState): void {
    runState = next;
    runListeners.forEach(listener => listener());
}

export function getAutoFrameRunState(): RunState {
    return runState;
}

export function subscribeAutoFrameRunState(listener: () => void): () => void {
    runListeners.add(listener);
    return () => {
        runListeners.delete(listener);
    };
}

function tryConsole(ctx: WorkspaceContext): ConsoleService | null {
    try {
        const consoleService = ctx.services.get<ConsoleService>(Services.Console);
        if (!registeredConsoles.has(consoleService)) {
            registeredConsoles.add(consoleService);
            // Kept for the session once used: its lines are the run's receipt.
            consoleService.registerChannel({
                id: AVATAR_CONSOLE_CHANNEL,
                label: translate("characters.autoFrame.consoleChannel"),
                description: translate("characters.autoFrame.consoleChannelDescription"),
            });
        }
        return consoleService;
    } catch {
        return null;
    }
}

export class AutoFrameBusyError extends Error {
    constructor() {
        super("Dialog avatars are already being auto-framed.");
    }
}

/**
 * {@link autoFrameAvatars} as a run the author can watch: the console's `avatars` channel carries a
 * determinate bar (differentials looked at over differentials to look at) and the summary, with the
 * build and test bars' ending - full and lingering when done, full in the warning colour when it
 * failed. `reveal` brings the console up on that channel; the agent tool leaves the layout alone.
 */
export async function runAutoFrame(
    ctx: WorkspaceContext,
    options: AutoFrameOptions & { reveal?: boolean },
): Promise<AutoFrameReport> {
    if (runState.running) {
        throw new AutoFrameBusyError();
    }
    setRunState({ running: true });
    const consoleService = tryConsole(ctx);
    if (lingerTimer) {
        clearTimeout(lingerTimer);
        lingerTimer = null;
    }
    if (consoleService) {
        consoleService.setProgress(AVATAR_CONSOLE_CHANNEL, null);
        consoleService.setProgress(AVATAR_CONSOLE_CHANNEL, { value: 0, indeterminate: true, error: false });
        consoleService.append(AVATAR_CONSOLE_CHANNEL, {
            level: "info",
            source: AVATAR_CONSOLE_SOURCE,
            message: translate("characters.autoFrame.started"),
        });
        if (options.reveal) {
            try {
                ctx.services.get<UIService>(Services.UI).panels.show(CONSOLE_PANEL_ID);
            } catch {
                // No panel service in this context; the bar is still set for when the console opens.
            }
            consoleService.requestFocus(AVATAR_CONSOLE_CHANNEL);
        }
    }
    let failed = false;
    try {
        const report = await autoFrameAvatars(ctx, {
            ...options,
            onProgress: (done, total) => {
                // The fraction is real from the first picture on; before it the model is loading.
                if (done > 0 && total > 0) {
                    consoleService?.setProgress(AVATAR_CONSOLE_CHANNEL, { value: done / total, indeterminate: false });
                }
                options.onProgress?.(done, total);
            },
        });
        if (consoleService) {
            for (const character of report.characters) {
                const missing = character.outcomes.filter(outcome => outcome.result === "noHead" || outcome.result === "unreadable");
                if (missing.length > 0) {
                    consoleService.append(AVATAR_CONSOLE_CHANNEL, {
                        level: "warning",
                        source: AVATAR_CONSOLE_SOURCE,
                        message: translate("characters.autoFrame.noHeadLine", {
                            name: character.name,
                            looks: missing.map(outcome => outcome.label).join(", "),
                        }),
                    });
                }
            }
            const nothing = report.framed + report.noHead + report.kept === 0;
            consoleService.append(AVATAR_CONSOLE_CHANNEL, {
                level: nothing ? "info" : report.noHead > 0 ? "warning" : "success",
                source: AVATAR_CONSOLE_SOURCE,
                message: nothing
                    ? translate("characters.autoFrame.nothingToDo")
                    : translate("characters.autoFrame.summary", { framed: report.framed, noHead: report.noHead, kept: report.kept }),
            });
        }
        return report;
    } catch (error) {
        failed = true;
        consoleService?.append(AVATAR_CONSOLE_CHANNEL, {
            level: "error",
            source: AVATAR_CONSOLE_SOURCE,
            message: translate("characters.autoFrame.failed", { message: error instanceof Error ? error.message : String(error) }),
        });
        throw error;
    } finally {
        if (consoleService) {
            consoleService.setProgress(AVATAR_CONSOLE_CHANNEL, { value: 1, indeterminate: false, error: failed });
            lingerTimer = setTimeout(() => {
                lingerTimer = null;
                consoleService.setProgress(AVATAR_CONSOLE_CHANNEL, null);
            }, DONE_LINGER_MS);
        }
        setRunState({ running: false });
    }
}
