import { useEffect, useMemo, useState } from "react";
import { useOptionalWorkspace } from "@/apps/workspace/context";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { Character } from "@/lib/workspace/services/character/Character";
import type { CharacterTagSelection } from "@/lib/workspace/services/character/types";
import { SpriteCompositor, spriteCompositeKey } from "@/lib/workspace/services/character/spriteCompositor";
import { Services } from "@/lib/workspace/services/services";

/**
 * One compositor per window, because one window is one project and the cache is keyed by character.
 * Held at module scope rather than in context so that a badge, a picker and a thumbnail asking for the
 * same picture share one decode and one object URL.
 */
let shared: SpriteCompositor | null = null;
let boundService: AssetsService | null = null;

function compositorFor(assetsService: AssetsService): SpriteCompositor {
    if (shared && boundService === assetsService) {
        return shared;
    }
    shared?.dispose();
    boundService = assetsService;
    shared = new SpriteCompositor(async assetId => {
        const asset = assetsService.getAssets()[AssetType.Image]?.[assetId];
        if (!asset) {
            return null;
        }
        const result = await assetsService.fetch(asset);
        if (!result.success || !result.data) {
            return null;
        }
        return createImageBitmap(new Blob([new Uint8Array(result.data.data)]));
    });
    return shared;
}

export type SpriteSelection = { poseId?: string | null; tags?: CharacterTagSelection | null };

/**
 * The character's whole appearance as one picture.
 *
 * A layered sprite has no single file, so anywhere that used to read one asset id has to composite
 * instead. `maxSize` is the longest edge in CSS pixels — pass the size you are about to draw at, so a
 * 24px badge does not hold a 2000px bitmap.
 *
 * The URL is owned by the shared compositor and deliberately not revoked here: several rows showing
 * the same differential share one, and the cache drops them when the character or its assets change.
 */
export function useCompositedSprite(
    character: Character | null | undefined,
    selection: SpriteSelection,
    maxSize?: number,
): { url: string | null; loading: boolean } {
    // Optional, not required: this hook is reached from widget renderers that also draw in the Dev
    // Mode window, where there is no provider and "no workspace" is an ordinary answer. Throwing
    // there took the whole surface subtree down with it.
    const workspace = useOptionalWorkspace();
    const context = workspace?.context ?? null;
    const isInitialized = workspace?.isInitialized ?? false;
    const assetsService = context && isInitialized ? context.services.get<AssetsService>(Services.Assets) : null;
    const [url, setUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    /** Bumped when the stack or any asset in it changes, which is what re-renders every consumer. */
    const [generation, setGeneration] = useState(0);

    const characterId = character?.profile.getId() ?? null;
    const appearance = character?.profile.appearance ?? null;

    // The draw list is what actually decides the picture, so it — not the raw selection — is the
    // dependency. Two rows that resolve to the same layers must not composite twice.
    const layers = useMemo(
        () => (appearance ? appearance.resolveDrawList(selection) : []),
        [appearance, selection.poseId, JSON.stringify(selection.tags ?? {}), generation],
    );
    const key = useMemo(
        () => (characterId ? spriteCompositeKey(characterId, selection) : null),
        [characterId, selection.poseId, JSON.stringify(selection.tags ?? {})],
    );

    useEffect(() => {
        if (!character || !assetsService) {
            return;
        }
        const stop = character.subscribe(() => {
            compositorFor(assetsService).invalidate(`${character.profile.getId()}|`);
            setGeneration(current => current + 1);
        });
        const off = assetsService.getEvents().on("updated", asset => {
            if (layers.includes(asset.id)) {
                compositorFor(assetsService).invalidate(`${character.profile.getId()}|`);
                setGeneration(current => current + 1);
            }
        });
        return () => { stop?.(); off?.(); };
    }, [character, assetsService, layers.join(",")]);

    useEffect(() => {
        if (!key || !assetsService || layers.every(assetId => !assetId)) {
            setUrl(null);
            return;
        }
        let cancelled = false;
        setLoading(true);
        compositorFor(assetsService)
            .composite(key, layers, maxSize)
            .then(next => {
                if (!cancelled) {
                    setUrl(next);
                    setLoading(false);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setUrl(null);
                    setLoading(false);
                }
            });
        return () => { cancelled = true; };
    }, [key, layers.join(","), maxSize, assetsService, generation]);

    return { url, loading };
}

/** The compositor a non-hook caller (the editor's occlusion pass) should use. */
export function getSpriteCompositor(assetsService: AssetsService): SpriteCompositor {
    return compositorFor(assetsService);
}
