import { AppHost, AppProtocol } from "@shared/types/constants";
import { appPrivilegedFacade } from "@/lib/app/privilegedFacade";
import { ProjectNameConvention } from "@/lib/workspace/project/nameConvention";
import { Services, WorkspaceContext } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { AssetSetService } from "@/lib/workspace/services/assets/AssetSetService";
import { LocalizationService } from "@/lib/workspace/services/localization/LocalizationService";
import { resolveAssetSetMember, type AssetSet, type AssetSetCandidate } from "@shared/types/assetSet";
import { Asset, AssetSource } from "@/lib/workspace/services/assets/types";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { FileSystemService } from "@/lib/workspace/services/core/FileSystem";
import { characterAvatarBakePath, parseCharacterAvatarAssetId } from "@shared/utils/characterAvatar";
import { getInterface } from "@/lib/app/bridge";
import { recordAssetUrlToken } from "./assetUrlTokens";

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
 * Resolves an asset id to a URL loadable inside any renderer window: an `app://fs/{hash}` grant
 * over the bytes stored in the project.
 *
 * Source-blind on purpose. A remote asset used to resolve to its own `https:` URL, which put a
 * project-authored address straight into an `<img src>` - renderers do not talk to the network, and
 * a preview that silently reached out to whatever host a record named was the clearest breach of
 * that rule in the codebase. A remote asset's bytes are a versioned snapshot at the same content
 * shard as any other asset's, so there is nothing left here to distinguish.
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

    return async (rawAssetId: string, assetType?: string): Promise<WorkspaceAssetUrlResult> => {
        // A set is resolved here rather than left to the compiler, because the compiler only sees a
        // materialised map and nothing materialises one in the editor: assembly writes them, and the
        // scene preview compiles the document the author is editing. Resolving live keeps the
        // preview honest - the row shows a picture rather than a missing-asset diagnostic - and it
        // reads the same tags the build will read, so what the author sees is what will ship.
        const assetId = resolveEditorAssetSet(context, rawAssetId) ?? rawAssetId;
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

        if (asset.type === AssetType.Model) {
            return resolveModelBundleUrl(context, asset as Asset<AssetType.Model>);
        }

        const assetPath = context.project.resolve(ProjectNameConvention.AssetsDataShard(assetId));
        const request = await appPrivilegedFacade.fs.requestReadRaw(assetPath);

        if (!request.success || !request.data?.ok) {
            return { success: false, error: request.error ?? "Failed to resolve asset file" };
        }

        // The one instant at which "this token" and "this asset" are both known and both true. A
        // grant token carries no information about the file it opens, so a URL that reaches a
        // document is traceable back to an asset only if it was written down here - see
        // assetUrlTokens.ts.
        recordAssetUrlToken(request.data.data, asset.id);
        return { success: true, url: `${AppProtocol}://${AppHost.Fs}/${request.data.data}` };
    };
}

/**
 * The member an asset set resolves to for the language the editor is previewing in.
 *
 * The project's source language, which is the one an author writes and previews in; a preview of
 * another language is a build concern, and guessing at one here would show the author a picture
 * their own row does not name. Answers null for every ordinary asset id, which is the common case
 * and costs one map lookup.
 */
function resolveEditorAssetSet(context: WorkspaceContext, assetId: string): string | null {
    let set: AssetSet | undefined;
    try {
        set = context.services.get<AssetSetService>(Services.AssetSets).getSet(assetId);
    } catch {
        return null;
    }
    if (!set || set.axes.length !== 1) {
        return null;
    }
    const assetsService = context.services.get<AssetsService>(Services.Assets);
    const candidates: AssetSetCandidate[] = [];
    for (const bucket of Object.values(assetsService.getAssets())) {
        for (const asset of Object.values(bucket ?? {})) {
            candidates.push({ id: asset.id, type: asset.type, tags: asset.tags });
        }
    }
    let sourceLocale: string | undefined;
    try {
        sourceLocale = context.services.get<LocalizationService>(Services.Localization).getConfiguration().sourceLocale;
    } catch {
        sourceLocale = undefined;
    }
    const axis = set.axes[0];
    const chain = [sourceLocale, ...axis.values].filter((value): value is string => Boolean(value));
    for (const value of chain) {
        const member = resolveAssetSetMember(set, { [axis.key]: value }, candidates);
        if (member) {
            return member;
        }
    }
    return null;
}

/**
 * Resolve a model bundle to the URL of its **entry file**, served from a directory grant.
 *
 * This is the contract the whole asset type exists to satisfy. A model's manifest names its
 * siblings by relative path, and the engine's `PuppetMountContext.resolveSibling(rel)` does plain
 * URL arithmetic against the entry URL to find them - so what comes back here must be a URL against
 * which `new URL("Hiyori.2048/texture_00.png", entryUrl)` is *also servable*.
 *
 * A per-file grant (`app://fs/{hash}`, what every other asset type gets) cannot be that URL: it is
 * flat, so every sibling resolves to `app://fs/{something-else}` and 404s. Hence the directory
 * grant, under which the bundle's own tree is the path space:
 *
 *     app://fs/{grant}/Hiyori.model3.json          <- returned here
 *     app://fs/{grant}/Hiyori.2048/texture_00.png  <- what resolveSibling() asks for, and gets
 *
 * A bundle whose entry cannot be identified resolves to an error rather than to the root: the
 * engine would take a directory URL and mount nothing, which reads as "the model is broken" instead
 * of "nobody has said which file is the entry".
 */
async function resolveModelBundleUrl(
    context: WorkspaceContext,
    asset: Asset<AssetType.Model>,
): Promise<WorkspaceAssetUrlResult> {
    const assetsService = context.services.get<AssetsService>(Services.Assets);
    const modelService = assetsService.modelService;
    if (!modelService) {
        return { success: false, error: "Model service is not initialized" };
    }

    const root = modelService.getBundleRoot(asset.id);
    const listing = await modelService.listBundle(root);
    if (!listing.success || !listing.data) {
        return { success: false, error: listing.error ?? "Failed to read model bundle" };
    }

    const resolved = modelService.resolveEntry(asset, listing.data.files);
    if (!resolved.entry) {
        return {
            success: false,
            error: resolved.unresolved === "ambiguous"
                ? `Model bundle "${asset.name}" has more than one possible entry file; choose one in the asset inspector.`
                : `Model bundle "${asset.name}" has no entry file; choose one in the asset inspector.`,
        };
    }

    const grant = await getInterface().fs.requestReadDir(root);
    if (!grant.success || !grant.data?.ok) {
        return { success: false, error: grant.error ?? "Failed to grant access to the model bundle" };
    }

    // Each segment is encoded on its own so the separators stay separators - encoding the whole
    // relative path would turn "Hiyori.2048/texture_00.png" into a single opaque segment and break
    // the very sibling arithmetic this URL exists for.
    const encodedEntry = resolved.entry.split("/").map(encodeURIComponent).join("/");
    // Recorded for the same reason the per-file grant above is: a bundle's directory token is just
    // as opaque, and the entry path after it belongs to the bundle rather than to the token.
    recordAssetUrlToken(grant.data.data, asset.id);
    return { success: true, url: `${AppProtocol}://${AppHost.Fs}/${grant.data.data}/${encodedEntry}` };
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
 * Resolves asset ids to session-lived URLs safe for REPEATED loads: the bytes are read once and
 * served as a blob object URL.
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
            if (asset.type === AssetType.Model) {
                // A bundle has no single blob to wrap in an object URL, and it does not need one:
                // its directory grant is already session-lived and repeatable, which is the only
                // property this resolver exists to add.
                const resolved = await resolveModelBundleUrl(context, asset as Asset<AssetType.Model>);
                return resolved.success ? resolved.url : null;
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
