import { AppHost, AppProtocol } from "@shared/types/constants";
import { appPrivilegedFacade } from "@/lib/app/privilegedFacade";
import { ProjectNameConvention } from "@/lib/workspace/project/nameConvention";
import { Services, WorkspaceContext } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { AssetSource } from "@/lib/workspace/services/assets/types";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { FileSystemService } from "@/lib/workspace/services/core/FileSystem";
import { characterAvatarBakePath, parseCharacterAvatarAssetId } from "@shared/utils/characterAvatar";

export type WorkspaceAssetUrlResult =
    | { success: true; url: string }
    | { success: false; error: string };

export type WorkspaceAssetUrlResolver = (assetId: string, assetType?: string) => Promise<WorkspaceAssetUrlResult>;

export type WorkspaceBlobUrlResolver = {
    resolve: (assetId: string, assetType?: string) => Promise<string | null>;
    /** Revoke every object URL this resolver created. Call once the consumer unmounts. */
    dispose: () => void;
};

/**
 * Resolves an asset id to a URL loadable inside any renderer window:
 * remote assets resolve to their stored URL, local assets to an `app://fs/{hash}` grant.
 *
 * Grants are issued one-shot; the Dev Mode request path promotes them in the
 * main process to session-lived repeatable reads bound to the Dev Mode window
 * (see devModeAction.ts) so the engine can re-fetch assets on scene changes.
 *
 * This is the single source of truth used by both the cross-window IPC handler
 * (WorkspaceContext) and in-window consumers such as the story preview stage.
 */
/**
 * The project-relative path a baked character avatar lives at, or null when the id is an ordinary
 * asset id.
 *
 * Baked avatars are derived project files rather than library assets - one character can bake
 * dozens, and dropping those into the author's asset browser would bury the images they chose - so
 * they are addressed by a parsed id and resolved off the project tree instead of the asset store.
 */
function characterAvatarProjectPath(assetId: string): string | null {
    const parsed = parseCharacterAvatarAssetId(assetId);
    return parsed ? characterAvatarBakePath(parsed.characterId, parsed.key) : null;
}

export function createWorkspaceAssetUrlResolver(context: WorkspaceContext): WorkspaceAssetUrlResolver {
    const assetsService = context.services.get<AssetsService>(Services.Assets);

    return async (assetId: string, assetType?: string): Promise<WorkspaceAssetUrlResult> => {
        const avatarPath = characterAvatarProjectPath(assetId);
        if (avatarPath) {
            const request = await appPrivilegedFacade.fs.requestReadRaw(context.project.resolve(avatarPath));
            if (!request.success || !request.data?.ok) {
                return { success: false, error: request.error ?? "Baked avatar not found" };
            }
            return { success: true, url: `${AppProtocol}://${AppHost.Fs}/${request.data.data}` };
        }

        const asset = findAsset(assetsService, assetId, assetType);
        if (!asset) {
            return { success: false, error: "Asset not found" };
        }

        if (asset.source === AssetSource.Remote) {
            const url = (asset.meta as any)?.url;
            if (typeof url !== "string" || !url.trim()) {
                return { success: false, error: "Remote asset URL missing" };
            }
            return { success: true, url };
        }

        const assetPath = context.project.resolve(ProjectNameConvention.AssetsDataShard(assetId));
        const request = await appPrivilegedFacade.fs.requestReadRaw(assetPath);

        if (!request.success || !request.data?.ok) {
            return { success: false, error: request.error ?? "Failed to resolve asset file" };
        }

        return { success: true, url: `${AppProtocol}://${AppHost.Fs}/${request.data.data}` };
    };
}

function findAsset(assetsService: AssetsService, assetId: string, assetType?: string) {
    const assets = assetsService.getAssets();
    const typedAsset = Object.values(AssetType).includes(assetType as AssetType)
        ? assets[assetType as AssetType]?.[assetId]
        : undefined;
    return typedAsset ?? Object.values(AssetType)
        .map(type => assets[type]?.[assetId])
        .find(Boolean);
}

/**
 * Resolves asset ids to session-lived URLs safe for REPEATED loads: remote assets keep their
 * stored URL; local assets are fetched once and served as blob object URLs.
 *
 * Use this (not {@link createWorkspaceAssetUrlResolver}) whenever the consumer may load the same
 * URL more than once - `app://fs/{hash}` grants are single-use (the protocol handler cleans the
 * hash up after the first successful read), so a re-fetch of the same URL 404s. The embedded
 * story preview hits this constantly (engine preloading + rendering, session remounts).
 *
 * Results are cached per resolver instance; binary changes to an asset show up after the next
 * `dispose()`/re-create cycle.
 */
export function createWorkspaceBlobUrlResolver(context: WorkspaceContext): WorkspaceBlobUrlResolver {
    const assetsService = context.services.get<AssetsService>(Services.Assets);
    const cache = new Map<string, Promise<string | null>>();
    const objectUrls: string[] = [];
    let disposed = false;

    /** Hand back a minted URL, or revoke it when the resolver was disposed mid-flight. */
    const trackObjectUrl = (url: string): string | null => {
        if (disposed) {
            URL.revokeObjectURL(url);
            return null;
        }
        objectUrls.push(url);
        return url;
    };

    const resolve = (assetId: string, assetType?: string): Promise<string | null> => {
        const existing = cache.get(assetId);
        if (existing) {
            return existing;
        }
        const promise = (async (): Promise<string | null> => {
            const avatarPath = characterAvatarProjectPath(assetId);
            if (avatarPath) {
                const filesystemService = context.services.get<FileSystemService>(Services.FileSystem);
                const read = await filesystemService.readRaw(context.project.resolve(avatarPath));
                if (!read.ok || !read.data?.byteLength) {
                    return null;
                }
                return trackObjectUrl(URL.createObjectURL(new Blob([new Uint8Array(read.data)])));
            }

            const asset = findAsset(assetsService, assetId, assetType);
            if (!asset) {
                return null;
            }
            if (asset.source === AssetSource.Remote) {
                const url = (asset.meta as any)?.url;
                return typeof url === "string" && url.trim() ? url : null;
            }
            const result = await assetsService.fetch(asset);
            if (!result.success || !result.data) {
                return null;
            }
            return trackObjectUrl(URL.createObjectURL(new Blob([new Uint8Array((result.data as { data: ArrayLike<number> }).data)])));
        })();
        cache.set(assetId, promise);
        // Only successes stay cached: a transient fetch failure must not pin the asset to null
        // for the rest of the pane's lifetime (it black-screens every row that references it).
        // Evicting lets the next compile retry.
        promise.then(url => {
            if (url === null && cache.get(assetId) === promise) {
                cache.delete(assetId);
            }
        }, () => {
            if (cache.get(assetId) === promise) {
                cache.delete(assetId);
            }
        });
        return promise;
    };

    const dispose = (): void => {
        disposed = true;
        cache.clear();
        for (const url of objectUrls) {
            URL.revokeObjectURL(url);
        }
        objectUrls.length = 0;
    };

    return { resolve, dispose };
}
