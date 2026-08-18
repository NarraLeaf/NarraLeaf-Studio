import { useEffect, useState } from "react";
import { resolveDevModeSavePreviewImageUrl } from "@/lib/ui-editor/runtime/devModeSavePreviewAssets";
import { resolveCharacterAvatarAssetUrl } from "@/lib/ui-editor/runtime/characterAvatarAssets";
import { resolveGameRuntimeAssetUrl } from "@/lib/ui-editor/runtime/gameRuntimeBridge";

type AssetObjectUrlState = {
  url: string | null;
  metadata: null;
  loading: boolean;
  error: string | null;
};

/**
 * `assetType` exists only to match the workspace hook's signature. The packaged game resolves every
 * asset through one id-keyed protocol handler (`nlgame://asset/<id>`), which serves whatever the
 * pack manifest says the bytes are - so the pool a Studio author picked from is not information the
 * runtime needs, or has.
 *
 * It is nevertheless typed, not `unknown`: see the guard at the bottom of this file.
 */
export function useAssetObjectUrl(
  assetId?: string | null,
  _assetType?: AssetPoolName
): AssetObjectUrlState {
  const [state, setState] = useState<AssetObjectUrlState>({
    url: null,
    metadata: null,
    loading: false,
    error: null
  });

  useEffect(() => {
    if (!assetId) {
      setState({ url: null, metadata: null, loading: false, error: null });
      return;
    }
    const previewUrl = resolveDevModeSavePreviewImageUrl(assetId);
    // Avatars first: the mounted compile already resolved them, so this is the swap that must
    // not cost a round trip.
    const runtimeUrl =
      previewUrl ?? resolveCharacterAvatarAssetUrl(assetId) ?? resolveGameRuntimeAssetUrl(assetId);
    setState({
      url: runtimeUrl,
      metadata: null,
      loading: false,
      error: runtimeUrl ? null : `Runtime asset not found: ${assetId}`
    });
  }, [assetId]);

  return state;
}

/**
 * The guard the shim mechanism itself cannot provide.
 *
 * `src/runtime/tsconfig.json` maps `@/*` back onto the renderer sources, so tsc checks this file and
 * the workspace hook it displaces as two unrelated modules. Signature drift between them therefore
 * compiles perfectly clean and shows up only as a broken widget in a shipped game - which is the
 * whole failure mode this pair exists inside. Until now this pair had no guard at all, and the pool
 * parameter was typed `unknown`, so making it required, renaming it, or reshaping the returned
 * `metadata` all stayed green.
 *
 * `import type` is erased before esbuild resolves anything, so the runtime bundle still contains none
 * of the workspace module.
 *
 * The guard is deliberately asymmetric, unlike `useSurfacePuppetSession`'s, and the asymmetry is a
 * finding rather than a convenience:
 *
 * - **Substitutability** is checked in full. The shim has to be usable everywhere the workspace hook
 *   was, because that is what the build does to shared `@/lib/ui-editor` code.
 * - **The reverse is checked on parameters only**, because the two genuinely disagree on their
 *   return: the workspace hook can hand back decoded bytes and `ImageAssetMetadata`, and the
 *   packaged game has no equivalent - it resolves a URL from a protocol handler and never reads the
 *   file. Asserting full mutual assignability here fails, and the first version of this guard did.
 *
 * The consequence is worth stating where someone will read it: **shared widget code must not rely on
 * `metadata`.** It is always `null` in a packaged game, so a consumer that reads it typechecks
 * against the workspace shape and finds nothing at runtime in the shipped title.
 */
import type { useAssetObjectUrl as WorkspaceUseAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";

type AssetPoolName = Parameters<typeof WorkspaceUseAssetObjectUrl>[1];

const _shimIsSubstitutable: typeof WorkspaceUseAssetObjectUrl = useAssetObjectUrl;
const _parametersMatchWorkspace: Parameters<typeof useAssetObjectUrl> =
  null as unknown as Parameters<typeof WorkspaceUseAssetObjectUrl>;
const _parametersMatchShim: Parameters<typeof WorkspaceUseAssetObjectUrl> =
  null as unknown as Parameters<typeof useAssetObjectUrl>;
void _shimIsSubstitutable;
void _parametersMatchWorkspace;
void _parametersMatchShim;
