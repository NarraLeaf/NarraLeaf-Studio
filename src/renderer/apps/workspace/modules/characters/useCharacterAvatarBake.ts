import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { Character } from "@/lib/workspace/services/character/Character";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { mapCharacterStoreEntriesToSummaries } from "@shared/utils/characterSummaries";
import type { CharacterAvatarTarget } from "@shared/utils/characterAvatar";
import type { PortraitCrop } from "@/lib/workspace/services/character/types";
import { bakeCharacterAvatars, type AvatarBakeIO, type AvatarBakeReport } from "./avatarBake";
import { createAvatarRenderer } from "./avatarRenderer";
import { inheritedPosePortrait, measurePosePictures } from "@/lib/workspace/services/character/poseFraming";
import { useWorkspaceFrozen } from "@/apps/workspace/hooks/useWorkspaceFrozen";
import { isDeferredWriteAllowed } from "@/apps/workspace/components/ui/freezeGuard";

/**
 * Whether the panel-open bake may run.
 *
 * A write with no author gesture behind it, so there is nothing to grey out - see
 * {@link isDeferredWriteAllowed} for why a freeze defers this instead of refusing it, and what the
 * author saw before it did.
 */
export function shouldBakeCharacterAvatars(enabled: boolean, frozen: boolean): boolean {
    return enabled && isDeferredWriteAllowed(frozen);
}

/**
 * Which framing a differential is baked with: **entry → pose → profile → inherited**, and the
 * automatic head crop when none of them answers.
 *
 * The entry's crop is the specific one — it is written against a single avatar key, which is the
 * only address a `layered` character has for one tag combination. Without it at the head of the
 * order an author who reframed one look would be overruled by the character-wide crop they were
 * overriding, which is what dragging the crop box used to do to them silently.
 *
 * The pose crop sits in the middle rather than being retired: it predates the entry crop, it only
 * exists for `preset`, and the story rows still frame their speaker badge from it — so a project
 * that set one keeps meaning what it meant.
 *
 * Pure and exported for the test; the hook below is the only production caller.
 */
export function resolveAvatarBakePortrait(input: {
    entry?: PortraitCrop | null;
    pose?: PortraitCrop | null;
    profile?: PortraitCrop | null;
    /**
     * A `preset` pose framed by nothing above it takes the framing of a pose whose picture is the same
     * size (`inheritedPosePortrait`): the same picture with another face, so the face is in the same
     * place. Last, because the three above are the author's word about this picture.
     */
    inherited?: PortraitCrop | null;
}): PortraitCrop | undefined {
    return input.entry ?? input.pose ?? input.profile ?? input.inherited ?? undefined;
}

/**
 * What the last bake did, per character.
 *
 * `bakeCharacterAvatars` has always returned this and every caller threw it away, which is why "this
 * differential has no drawable art, so it fell back to the character's default avatar" was a thing
 * the author could only find out by looking at a dialog box in a running game.
 */
export type AvatarBakeSummary = {
    byCharacter: Record<string, AvatarBakeReport>;
    written: number;
    unresolved: number;
    removed: number;
    /** `Date.now()` of the run, so a repeat run with identical counts still reads as a new one. */
    at: number;
};

type BakeState = { running: boolean; summary: AvatarBakeSummary | null };

/**
 * How long the cast has to stand still after an edit that moves an avatar's inputs before the
 * avatars are baked again. Long enough that a crop being dragged or a run of pose edits is one bake,
 * short enough that the file is current by the time the author looks for it.
 */
export const AVATAR_REBAKE_DEBOUNCE_MS = 800;

/**
 * Everything of the cast a bake reads, as one comparable string: each character's framing and its
 * appearance, without the `baked` stamps the bake itself writes back.
 *
 * Leaving the stamps out is what keeps a bake from scheduling the next one: its own write-back
 * changes nothing here. An entry left empty by removing its stamp is dropped too, for the same
 * reason - the bake drops such an entry rather than keeping `{}`.
 */
export function avatarBakeInputs(characters: readonly Character[]): string {
    return JSON.stringify(characters.map(character => {
        const appearance = character.profile.appearance.toJSON() as unknown as Record<string, unknown>;
        const avatars = (appearance.avatars ?? {}) as Record<string, Record<string, unknown>>;
        const authored: Record<string, Record<string, unknown>> = {};
        for (const [key, entry] of Object.entries(avatars)) {
            const rest = { ...entry };
            delete rest.baked;
            if (Object.keys(rest).length > 0) {
                authored[key] = rest;
            }
        }
        return [character.profile.getId(), character.profile.getPortrait() ?? null, { ...appearance, avatars: authored }];
    }));
}

/**
 * Module state, not per-hook state, for two reasons. The panel mounts one of these and the character
 * editor mounts another, and (a) two concurrent bakes over the same files would race — the old
 * per-instance `runningRef` only ever guarded one of them — and (b) the receipt the panel's
 * open-bake produced is exactly what the editor wants to show, so it has to outlive that instance.
 */
let bakeState: BakeState = { running: false, summary: null };
const bakeListeners = new Set<() => void>();
/** The bake in flight, so a second caller waits for it instead of starting another over the same files. */
let runningBake: Promise<void> | null = null;
/** {@link avatarBakeInputs} as the last bake started from them; null until one has run. */
let bakedInputs: string | null = null;
/** A bake owed by an edit, waiting for the cast to stand still. */
let owedBakeTimer: ReturnType<typeof setTimeout> | null = null;
/** Mounted hooks, so the owed bake is dropped once nothing that can run it is left. */
let mountedBakeHooks = 0;

function cancelOwedBake(): void {
    if (owedBakeTimer !== null) {
        clearTimeout(owedBakeTimer);
        owedBakeTimer = null;
    }
}

/**
 * Run the owed bake now, and wait for any bake already running. Settles once nothing is owed and
 * nothing is running - which is what a flush before a launch needs: the avatars the editor shows are
 * on disk and on the cast before the project is read.
 */
async function settleOwedBake(run: () => Promise<void>): Promise<void> {
    // Bounded: an edit that lands during each bake would otherwise keep a closing window waiting.
    for (let round = 0; round < 4 && (owedBakeTimer !== null || runningBake !== null); round++) {
        if (runningBake) {
            await runningBake;
            continue;
        }
        cancelOwedBake();
        await run();
    }
}

function setBakeState(next: BakeState): void {
    bakeState = next;
    bakeListeners.forEach(listener => listener());
}

function subscribeBakeState(listener: () => void): () => void {
    bakeListeners.add(listener);
    return () => {
        bakeListeners.delete(listener);
    };
}

/**
 * Keep every character's baked dialog avatars in step with its sprites.
 *
 * Runs when the character panel opens, on the same reasoning as `bakeProjectIcons`: a project that
 * is already current performs reads only, so the common case leaves the working tree untouched and
 * the author never has to remember to press anything. A re-bake is only ever triggered by a
 * fingerprint moving — new art, a changed crop, a differential added or removed.
 *
 * And again after an edit that moves what a bake reads - a pose added, its image changed, a crop
 * set - once the cast has stood still for {@link AVATAR_REBAKE_DEBOUNCE_MS}. The panel stays mounted
 * for the whole session, so its open-bake alone left every pose made after it with no avatar in the
 * game while the editor showed one. Not on every keystroke: the character editor writes continuously
 * while an author drags a crop or renames a tag, and rendering against each of those would be work
 * whose output the next edit invalidates. A flush (Dev Mode, Preview, a closing window) runs an owed
 * bake at once, so a launch straight after an edit is not raced.
 */
export function useCharacterAvatarBake(enabled: boolean): {
    rebake: () => Promise<void>;
    running: boolean;
    summary: AvatarBakeSummary | null;
} {
    const { context, isInitialized } = useWorkspace();
    const frozen = useWorkspaceFrozen();
    const state = useSyncExternalStore(subscribeBakeState, () => bakeState, () => bakeState);

    const rebake = useCallback(async (): Promise<void> => {
        if (!context || !isInitialized) {
            return;
        }
        if (runningBake) {
            return runningBake;
        }
        // Also guarded here, not only at the effect: `rebake` is returned to callers, and a write with
        // no gesture behind it must not depend on every future caller remembering the freeze.
        if (frozen) {
            return;
        }
        runningBake = bakeAll(context).finally(() => {
            runningBake = null;
        });
        return runningBake;
    }, [context, frozen, isInitialized]);

    // The edit-driven bake. Every mounted hook listens, and they share one timer, so the panel and an
    // open editor schedule a single bake between them.
    const rebakeRef = useRef(rebake);
    rebakeRef.current = rebake;
    useEffect(() => {
        if (!context || !isInitialized) {
            return;
        }
        const characters = context.services.get<CharacterService>(Services.Character);
        const run = () => rebakeRef.current();
        mountedBakeHooks += 1;
        const unsubscribe = characters.subscribe(() => {
            if (avatarBakeInputs(characters.listCharacter()) === bakedInputs) {
                return;
            }
            cancelOwedBake();
            owedBakeTimer = setTimeout(() => {
                owedBakeTimer = null;
                void (runningBake ?? Promise.resolve())
                    .then(() => (avatarBakeInputs(characters.listCharacter()) === bakedInputs ? undefined : run()))
                    .catch(error => console.warn("[characters] avatar bake failed:", error));
            }, AVATAR_REBAKE_DEBOUNCE_MS);
        });
        const unregister = characters.registerPendingDerivedWork(() => settleOwedBake(run));
        return () => {
            unsubscribe();
            unregister();
            mountedBakeHooks -= 1;
            if (mountedBakeHooks === 0) {
                cancelOwedBake();
            }
        };
    }, [context, isInitialized]);

    useEffect(() => {
        if (!shouldBakeCharacterAvatars(enabled, frozen)) {
            return;
        }
        void rebake();
    }, [enabled, frozen, rebake]);

    return { rebake, running: state.running, summary: state.summary };
}

/**
 * Bring every avatar up to date before Dev Mode, Preview or a build reads the project, unless a bake
 * pass has already run on the cast as it stands. Returns whether it ran one.
 *
 * The panel's open-bake and the edit-driven bake both need the character panel or editor to have
 * been mounted, and an author who never opens either never gets one: a bake made by an older rule
 * (a different framing, a different recipe) went on showing in Dev Mode and shipping in builds. A
 * pass over a cast whose avatars are current only reads, so this is a re-bake of exactly the stale
 * ones. Once per set of inputs: a launch after the panel baked, or after a previous launch did, does
 * no work at all. Nothing while frozen - it writes, and a past version is not the author's to write.
 *
 * `bake` is the pass itself, injected for the test; production passes {@link bakeAll}.
 */
export async function bakeStaleAvatarsBeforeLaunch(input: {
    characters: Pick<CharacterService, "listCharacter">;
    frozen: boolean;
    bake: () => Promise<void>;
}): Promise<boolean> {
    if (!isDeferredWriteAllowed(input.frozen)) {
        return false;
    }
    if (runningBake) {
        await runningBake;
    }
    const inputs = avatarBakeInputs(input.characters.listCharacter());
    if (inputs === bakedInputs) {
        return false;
    }
    // This pass covers whatever an edit still owed.
    cancelOwedBake();
    bakedInputs = inputs;
    runningBake = input.bake()
        .catch(error => {
            // A pass that did not finish has not made anything current; the next launch tries again.
            bakedInputs = null;
            throw error;
        })
        .finally(() => {
            runningBake = null;
        });
    await runningBake;
    return true;
}

/** Forget every bake this window ran, for tests that start from a fresh window. */
export function resetAvatarBakeStateForTests(): void {
    cancelOwedBake();
    runningBake = null;
    bakedInputs = null;
    bakeState = { running: false, summary: null };
}

/**
 * Register {@link bakeStaleAvatarsBeforeLaunch} as derived work for the cast's flush, for the life of
 * the workspace - which is what Dev Mode (a row's ▶ included), Preview and a build wait on before
 * they read the project. Mounted once, by the workspace itself, so it does not depend on any
 * character surface ever having been opened. Nothing runs when the project opens.
 */
export function useAvatarBakeBeforeLaunch(): void {
    const { context, isInitialized } = useWorkspace();
    const frozen = useWorkspaceFrozen();
    const frozenRef = useRef(frozen);
    frozenRef.current = frozen;
    useEffect(() => {
        if (!context || !isInitialized) {
            return;
        }
        const characters = context.services.get<CharacterService>(Services.Character);
        return characters.registerPendingDerivedWork(async () => {
            await bakeStaleAvatarsBeforeLaunch({
                characters,
                frozen: frozenRef.current,
                bake: () => bakeAll(context),
            });
        });
    }, [context, isInitialized]);
}

/** One pass over the whole cast. {@link useCharacterAvatarBake}'s `rebake` and the pre-launch pass call it. */
async function bakeAll(context: WorkspaceContext): Promise<void> {
    setBakeState({ running: true, summary: bakeState.summary });
    const byCharacter: Record<string, AvatarBakeReport> = {};
    try {
        const characters = context.services.get<CharacterService>(Services.Character);
        // What this pass reads. An edit made while it runs moves the inputs past this, so the
        // edit's own bake still happens.
        bakedInputs = avatarBakeInputs(characters.listCharacter());
        const assets = context.services.get<AssetsService>(Services.Assets);
        const project = context.services.get<ProjectService>(Services.Project);

        const io: AvatarBakeIO = {
            assetHash: assetId => assets.getAssets()[AssetType.Image]?.[assetId]?.hash ?? null,
            readProjectFile: relativePath => project.readProjectIconFile(relativePath),
            projectFileExists: relativePath => project.projectIconFileExists(relativePath),
            writeProjectFile: (relativePath, bytes) => project.writeProjectDerivedFile(relativePath, bytes, {
                store: "workspace.shell.save.stores.characters",
            }),
            deleteProjectFile: relativePath => project.deleteProjectIconFile(relativePath),
        };
        const render = createAvatarRenderer(async assetId => {
            const asset = assets.getAssets()[AssetType.Image]?.[assetId];
            if (!asset) {
                return null;
            }
            const result = await assets.fetch(asset);
            if (!result.success || !result.data) {
                return null;
            }
            return createImageBitmap(new Blob([new Uint8Array(result.data.data)]));
        });

        for (const character of characters.listCharacter()) {
            const profile = character.profile;
            const summary = mapCharacterStoreEntriesToSummaries([character.toJSON()])[0];
            if (!summary) {
                continue;
            }
            const appearance = profile.appearance;
            // Read only where an inherited framing could apply: a preset character with a framed pose.
            const poses = appearance.getKind() === "preset" ? appearance.getPoses() : [];
            const poseSizes = poses.some(pose => pose.portrait) ? await measurePosePictures(assets, poses) : {};
            const report = await bakeCharacterAvatars(io, render, {
                characterId: summary.id,
                appearance: {
                    summary: summary.appearance,
                    avatars: appearance.getAvatars(),
                    resolveDrawList: selection => appearance.resolveDrawList(selection),
                    // entry → pose → profile; see resolveAvatarBakePortrait. The entry arm is
                    // applied again inside the baker, which has the entry in hand anyway — the
                    // duplication is deliberate, so this order cannot be lost by a caller.
                    portraitFor: (target: CharacterAvatarTarget) => resolveAvatarBakePortrait({
                        entry: appearance.getAvatarPortrait(target.key),
                        // `poseId` is only ever set for `preset` targets, so this arm is
                        // structurally preset-only rather than by a kind check.
                        pose: target.selection.poseId
                            ? appearance.getPose(target.selection.poseId)?.portrait
                            : undefined,
                        profile: profile.getPortrait(),
                        inherited: target.selection.poseId
                            ? inheritedPosePortrait({
                                poses,
                                defaultPoseId: appearance.getDefaultPoseId(),
                                poseId: target.selection.poseId,
                                sizeOf: assetId => poseSizes[assetId],
                            })
                            : undefined,
                    }),
                },
            });

            // Write back only what moved. `setAvatar` drops an entry that carries neither a bake
            // nor an override, so a differential whose art was removed stops claiming one.
            const previous = appearance.getAvatars();
            for (const key of new Set([...Object.keys(previous), ...Object.keys(report.avatars)])) {
                const next = report.avatars[key] ?? null;
                if (JSON.stringify(previous[key] ?? null) !== JSON.stringify(next)) {
                    appearance.setAvatar(key, next);
                }
            }

            // Kept even when it is all zeroes: "nothing moved" is the answer a manual re-bake is
            // usually asking for, and an empty receipt is not the same as no receipt.
            byCharacter[summary.id] = report;
        }
    } finally {
        setBakeState({
            running: false,
            summary: {
                byCharacter,
                written: Object.values(byCharacter).reduce((total, report) => total + report.written.length, 0),
                unresolved: Object.values(byCharacter).reduce((total, report) => total + report.unresolved.length, 0),
                removed: Object.values(byCharacter).reduce((total, report) => total + report.removed.length, 0),
                at: Date.now(),
            },
        });
    }
}
