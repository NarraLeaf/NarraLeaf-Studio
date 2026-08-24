import { useEffect, useMemo, useRef, useState } from "react";
import { useOptionalWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { WorkspaceContext } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { AssetType, AssetData } from "@/lib/workspace/services/assets/assetTypes";
import { getInterface } from "@/lib/app/bridge";
import { resolveDevModeSavePreviewImageUrl } from "@/lib/ui-editor/runtime/devModeSavePreviewAssets";
import {
    isCharacterAvatarAssetId,
    resolveCharacterAvatarAssetUrl,
} from "@/lib/ui-editor/runtime/characterAvatarAssets";
import { resolveGameRuntimeAssetUrl } from "@/lib/ui-editor/runtime/gameRuntimeBridge";
import { resolveEditorAssetSetMember } from "@/lib/workspace/assets/resolveWorkspaceAssetUrl";
import { useAssetLibraryRevision } from "@/lib/workspace/hooks/useAssetLibraryRevision";
import { AssetSetService } from "@/lib/workspace/services/assets/AssetSetService";
import {
    useAssetBytesSource,
    type AssetBytesResult,
} from "@/lib/ui-editor/assets/assetBytesSource";

interface AssetObjectUrlState {
    url: string | null;
    metadata: AssetData<AssetType.Image> | null;
    loading: boolean;
    error: string | null;
}

/**
 * Which library pool an id is looked up in. The bare string form is accepted so callers inside the
 * shared `@/lib/ui-editor` tree - which the game-runtime bundle also compiles, and which may not
 * import workspace service modules - can name a pool without pulling the enum across that boundary.
 */
export type AssetObjectUrlPool = AssetType | `${AssetType}`;

/**
 * `assetType` selects which library pool the id is looked up in. It was implicitly Image before
 * `nl.video` existed - and silently so: a video id resolved to "not found" rather than to anything
 * an author could see was wrong. The runtime shim ignores the argument entirely, because the
 * packaged game addresses assets by id alone.
 */
export function useAssetObjectUrl(requestedAssetId?: string | null, assetType: AssetObjectUrlPool = AssetType.Image) {
    const workspaceValue = useOptionalWorkspace();
    const context: WorkspaceContext | null = workspaceValue?.context ?? null;
    const assetsService = context ? context.services.get<AssetsService>(Services.Assets) : null;
    /**
     * The version these bytes belong to, when the caller has named one.
     *
     * `null` everywhere in Studio today - nothing mounts a provider - and `null` means the live
     * ladder below runs exactly as it always has.
     */
    const assetBytesSource = useAssetBytesSource();
    const [state, setState] = useState<AssetObjectUrlState>({
        url: null,
        metadata: null,
        loading: false,
        error: null,
    });
    const urlRef = useRef<string | null>(null);
    /**
     * Bumped when this asset's bytes are replaced — or when the asset is deleted.
     *
     * Everything downstream of this hook — story rows, character variants, widget fills — addresses
     * the asset by id, and the id survives a replacement, so without a second key the effect below
     * would never re-run and every one of them would keep the pre-replacement picture until the tab
     * was remounted.
     *
     * `deleted` is on the same key for the same reason read the other way: nothing about the id
     * changes when the record goes, so the picture of a file that is no longer in the project stayed
     * on screen — the effect below turns the missing record into the "not found" state every caller
     * already draws.
     */
    const [contentGeneration, setContentGeneration] = useState(0);

    /**
     * A second key, and only for an id that names a SET.
     *
     * `contentGeneration` above watches one record, which is the right key for a file and no key at
     * all for a set: a set has no record of its own, and what changes under it is which file answers
     * - a tag written on some other file entirely. So a set is keyed on the library instead.
     *
     * Held at a constant for every ordinary id rather than always reading the revision: this effect
     * refetches bytes when it re-runs, and there is one of these per picture on screen.
     */
    const libraryRevision = useAssetLibraryRevision();
    const setRevision = useMemo(() => {
        if (!context || !requestedAssetId) {
            return 0;
        }
        try {
            return context.services.get<AssetSetService>(Services.AssetSets).getSet(requestedAssetId)
                ? libraryRevision
                : 0;
        } catch {
            return 0;
        }
    }, [context, requestedAssetId, libraryRevision]);

    useEffect(() => {
        if (!assetsService || !requestedAssetId) {
            return;
        }
        // Keyed on the id the caller asked for, not on the file it resolves to. A set's own id never
        // has a record to be updated or deleted; what changes under it is which file answers, and the
        // tag write that changes that raises `updated` on the file - so watching the caller's id
        // would miss it. Watching every event is not an option either: this runs per widget.
        const bump = (asset: { id: string }) => {
            if (asset.id === requestedAssetId) {
                setContentGeneration(generation => generation + 1);
            }
        };
        const events = assetsService.getEvents();
        const unsubs = [events.on("updated", bump), events.on("deleted", bump)];
        return () => unsubs.forEach(unsub => unsub());
    }, [assetsService, requestedAssetId]);

    useEffect(() => {
        /**
         * The versioned arm, and it is deliberately the FIRST thing in this effect.
         *
         * Every arm below resolves against the project as it is right now: the set resolution reads
         * today's tags, the avatar table holds URLs the currently mounted compile minted, the Dev
         * Mode and game-runtime arms answer off the running session, and the ladder at the bottom
         * fetches today's bytes. A seam placed after any of them would leave that arm rendering the
         * present inside a picture of the past - most visibly for dialogue avatars, which are not a
         * rare case on the surfaces a comparison shows.
         *
         * So a mounted source answers for the id the caller asked for, whole: sets included, avatars
         * included. That is a duty as much as a privilege, and the contract says so.
         */
        if (assetBytesSource && requestedAssetId) {
            let cancelled = false;
            setState(prev => ({
                ...prev,
                loading: true,
                error: null,
            }));

            (async () => {
                let result: AssetBytesResult;
                try {
                    result = await assetBytesSource.read(requestedAssetId, assetType);
                } catch (err) {
                    result = {
                        kind: "failed",
                        reason: err instanceof Error ? err.message : String(err),
                    };
                }
                if (cancelled) {
                    return;
                }

                if (result.kind !== "bytes") {
                    if (urlRef.current) {
                        URL.revokeObjectURL(urlRef.current);
                        urlRef.current = null;
                    }
                    setState({
                        url: null,
                        metadata: null,
                        loading: false,
                        // "Absent at that version" and "the read broke" are different facts, and the
                        // source keeps them apart; what this hook can carry is one string, so each
                        // takes the wording the live ladder already uses for its own version of it.
                        error: result.kind === "absent"
                            ? `Asset not found: ${requestedAssetId}`
                            : result.reason || `Failed to load asset: ${requestedAssetId}`,
                    });
                    return;
                }

                const blob = new Blob(
                    [new Uint8Array(result.bytes) as BlobPart],
                    result.mediaType ? { type: result.mediaType } : undefined,
                );
                const nextUrl = URL.createObjectURL(blob);
                if (urlRef.current) {
                    URL.revokeObjectURL(urlRef.current);
                }
                urlRef.current = nextUrl;
                setState({
                    url: nextUrl,
                    // No width/height: a source hands over bytes and a media type, and decoding them
                    // to fill in image metadata is work no caller has asked for. Same caveat as the
                    // game runtime's shim - a consumer that reads `metadata` finds nothing here.
                    metadata: null,
                    loading: false,
                    error: null,
                });
            })();

            return () => {
                cancelled = true;
            };
        }

        /**
         * The file this call is really about.
         *
         * A set id names a family of files, and every arm below wants the one it means here. Only
         * the EDITOR answers here: a running game has had its documents resolved for the player's
         * language before anything rendered, so what reaches this hook there is already a file. An
         * ordinary asset id gets null back and is used untouched, which is every call but a handful.
         */
        const assetId = requestedAssetId
            ? (context ? resolveEditorAssetSetMember(context, requestedAssetId) : null) ?? requestedAssetId
            : requestedAssetId;
        if (!assetId) {
            if (urlRef.current) {
                URL.revokeObjectURL(urlRef.current);
                urlRef.current = null;
            }
            setState({
                url: null,
                metadata: null,
                loading: false,
                error: null,
            });
            return;
        }

        const runtimePreviewUrl = resolveDevModeSavePreviewImageUrl(assetId);
        if (runtimePreviewUrl) {
            if (urlRef.current) {
                URL.revokeObjectURL(urlRef.current);
                urlRef.current = null;
            }
            setState({
                url: runtimePreviewUrl,
                metadata: null,
                loading: false,
                error: null,
            });
            return;
        }

        // A dialog avatar the mounted compile already resolved. This has to come before every
        // other arm: it is the swap that must not flash, and in Dev Mode the ordinary arm costs
        // two IPC hops. A synthetic (baked) avatar id stops here either way - it has no record in
        // the asset library, so falling through would spend that round trip only to be told so.
        const avatarUrl = resolveCharacterAvatarAssetUrl(assetId);
        if (avatarUrl || isCharacterAvatarAssetId(assetId)) {
            if (urlRef.current) {
                URL.revokeObjectURL(urlRef.current);
                urlRef.current = null;
            }
            setState({
                url: avatarUrl,
                metadata: null,
                loading: false,
                error: avatarUrl ? null : `Avatar is not available in this session: ${assetId}`,
            });
            return;
        }

        const gameRuntimeUrl = resolveGameRuntimeAssetUrl(assetId);
        if (gameRuntimeUrl) {
            if (urlRef.current) {
                URL.revokeObjectURL(urlRef.current);
                urlRef.current = null;
            }
            setState({
                url: gameRuntimeUrl,
                metadata: null,
                loading: false,
                error: null,
            });
            return;
        }

        // Dev Mode without workspace context should still resolve assets through IPC.
        if (!assetsService) {
            if (workspaceValue) {
                setState({
                    url: null,
                    metadata: null,
                    loading: false,
                    error: "Assets service not ready",
                });
                return;
            }

            let cancelled = false;
            setState(prev => ({
                ...prev,
                loading: true,
                error: null,
            }));

            (async () => {
                try {
                    const result = await getInterface().devMode.resolveAssetUrl(assetId, assetType);
                    if (cancelled) {
                        return;
                    }
                    if (!result.success || !result.data?.url) {
                        setState({
                            url: null,
                            metadata: null,
                            loading: false,
                            error: result.error ?? `Asset not found: ${assetId}`,
                        });
                        return;
                    }

                    const url = result.data.url;
                    if (urlRef.current) {
                        URL.revokeObjectURL(urlRef.current);
                        urlRef.current = null;
                    }
                    urlRef.current = url;
                    setState({
                        url,
                        metadata: null,
                        loading: false,
                        error: null,
                    });
                } catch (err) {
                    if (cancelled) {
                        return;
                    }
                    setState({
                        url: null,
                        metadata: null,
                        loading: false,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            })();

            return () => {
                cancelled = true;
            };
        }

        const asset = assetsService.getAssets()[assetType]?.[assetId];
        if (!asset) {
            // Released here as well as in the branches above: reaching this after a delete means the
            // blob is unreachable for good, and leaving it alive would hold the file's bytes in
            // memory for the life of the window.
            if (urlRef.current) {
                URL.revokeObjectURL(urlRef.current);
                urlRef.current = null;
            }
            setState({
                url: null,
                metadata: null,
                loading: false,
                error: `Asset not found: ${assetId}`,
            });
            return;
        }

        let cancelled = false;
        setState(prev => ({
            ...prev,
            loading: true,
            error: null,
        }));

        (async () => {
            const result = await assetsService.fetch(asset);
            if (cancelled) {
                return;
            }
            if (!result.success || !result.data) {
                setState({
                    url: null,
                    metadata: null,
                    loading: false,
                    error: result.error ?? `Failed to load asset: ${assetId}`,
                });
                return;
            }

            /**
             * `fetch` is typed per pool: image / audio / video / font hand back bytes, while
             * blueprint, JSON and model bundles hand back parsed objects. Only the byte-bearing ones
             * can become an object URL, so an object payload is an error here rather than a
             * `[object Object]` blob some `<img>` or `<video>` would silently fail to decode.
             */
            const payload = result.data;
            const bytes = payload.data;
            if (!(bytes instanceof Uint8Array)) {
                setState({
                    url: null,
                    metadata: null,
                    loading: false,
                    error: `Asset has no binary content: ${assetId}`,
                });
                return;
            }

            const blob = new Blob([new Uint8Array(bytes) as BlobPart]);
            const nextUrl = URL.createObjectURL(blob);
            if (urlRef.current) {
                URL.revokeObjectURL(urlRef.current);
            }
            urlRef.current = nextUrl;
            setState({
                url: nextUrl,
                // Image-shaped metadata is only image-shaped for the image pool; claiming otherwise
                // would hand a caller a width/height that does not exist.
                metadata: assetType === AssetType.Image ? (payload as AssetData<AssetType.Image>) : null,
                loading: false,
                error: null,
            });
        })();

        return () => {
            cancelled = true;
        };
        // The source's identity, not the object: a provider that rebuilds its value every render
        // would otherwise restart every fetch on the surface.
    }, [
        context,
        requestedAssetId,
        assetType,
        assetsService,
        contentGeneration,
        setRevision,
        assetBytesSource?.id ?? null,
    ]);

    useEffect(() => {
        return () => {
            if (urlRef.current) {
                URL.revokeObjectURL(urlRef.current);
                urlRef.current = null;
            }
        };
    }, []);

    return state;
}
