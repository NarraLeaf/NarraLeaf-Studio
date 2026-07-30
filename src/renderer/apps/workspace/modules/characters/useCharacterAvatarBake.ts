import { useCallback, useEffect, useRef } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { mapCharacterStoreEntriesToSummaries } from "@shared/utils/characterSummaries";
import type { CharacterAvatarTarget } from "@shared/utils/characterAvatar";
import { bakeCharacterAvatars, type AvatarBakeIO } from "./avatarBake";
import { createAvatarRenderer } from "./avatarRenderer";
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
 * Keep every character's baked dialog avatars in step with its sprites.
 *
 * Runs when the character panel opens, on the same reasoning as `bakeProjectIcons`: a project that
 * is already current performs reads only, so the common case leaves the working tree untouched and
 * the author never has to remember to press anything. A re-bake is only ever triggered by a
 * fingerprint moving — new art, a changed crop, a differential added or removed.
 *
 * Deliberately not run on every keystroke: the character editor writes continuously while an author
 * drags a crop or renames a tag, and rendering sixty PNGs against each of those would be pointless
 * work whose output the next edit invalidates.
 */
export function useCharacterAvatarBake(enabled: boolean): { rebake: () => Promise<void> } {
    const { context, isInitialized } = useWorkspace();
    const frozen = useWorkspaceFrozen();
    const runningRef = useRef(false);

    const rebake = useCallback(async (): Promise<void> => {
        if (!context || !isInitialized || runningRef.current) {
            return;
        }
        // Also guarded here, not only at the effect: `rebake` is returned to callers, and a write with
        // no gesture behind it must not depend on every future caller remembering the freeze.
        if (frozen) {
            return;
        }
        runningRef.current = true;
        try {
            const characters = context.services.get<CharacterService>(Services.Character);
            const assets = context.services.get<AssetsService>(Services.Assets);
            const project = context.services.get<ProjectService>(Services.Project);

            const io: AvatarBakeIO = {
                assetHash: assetId => assets.getAssets()[AssetType.Image]?.[assetId]?.hash ?? null,
                readProjectFile: relativePath => project.readProjectIconFile(relativePath),
                projectFileExists: relativePath => project.projectIconFileExists(relativePath),
                writeProjectFile: (relativePath, bytes) => project.writeProjectDerivedFile(relativePath, bytes),
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
                const report = await bakeCharacterAvatars(io, render, {
                    characterId: summary.id,
                    appearance: {
                        summary: summary.appearance,
                        avatars: appearance.getAvatars(),
                        resolveDrawList: selection => appearance.resolveDrawList(selection),
                        // A pose's own framing wins over the character's, which is the rule the
                        // story editor's badges already follow.
                        portraitFor: (target: CharacterAvatarTarget) =>
                            (target.selection.poseId ? appearance.getPose(target.selection.poseId)?.portrait : undefined)
                            ?? profile.getPortrait(),
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
            }
        } finally {
            runningRef.current = false;
        }
    }, [context, frozen, isInitialized]);

    useEffect(() => {
        if (!shouldBakeCharacterAvatars(enabled, frozen)) {
            return;
        }
        void rebake();
    }, [enabled, frozen, rebake]);

    return { rebake };
}
