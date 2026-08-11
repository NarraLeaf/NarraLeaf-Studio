import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetType } from "../services/assets/assetTypes";
import { Services, type WorkspaceContext } from "../services/services";
import { clearAssetUrlTokens, lookupAssetIdForUrl } from "./assetUrlTokens";
import { createWorkspaceAssetUrlResolver } from "./resolveWorkspaceAssetUrl";

/**
 * The recording end of the reverse table.
 *
 * The table is only worth anything if something fills it, and nothing else in the suite would
 * notice if the `recordAssetUrlToken` call were deleted: the extractor tests hand their own resolver
 * in, so they stay green over an empty table. This drives the real resolver and then asks the real
 * table, which is the only arrangement that fails when the two are disconnected.
 */

/** A real asset id: the content-shard path is derived from it and rejects anything else. */
const ASSET_ID = "11111111-2222-3333-4444-555555555555";

const requestReadRaw = vi.fn();

vi.mock("@/lib/app/privilegedFacade", () => ({
    appPrivilegedFacade: { fs: { requestReadRaw: (...args: unknown[]) => requestReadRaw(...args) } },
}));
vi.mock("@/lib/app/bridge", () => ({ getInterface: () => ({ fs: { requestReadDir: vi.fn() } }) }));

function contextWith(assetId: string): WorkspaceContext {
    return {
        project: { resolve: (...parts: unknown[]) => parts.flat().join("/") },
        services: {
            get: (id: Services) => {
                if (id === Services.Assets) {
                    return {
                        getAssets: () => ({
                            [AssetType.Image]: {
                                [assetId]: { id: assetId, type: AssetType.Image, name: "room.png", ext: "png", meta: {} },
                            },
                        }),
                    };
                }
                throw new Error(`Unexpected service ${String(id)}`);
            },
        },
    } as unknown as WorkspaceContext;
}

describe("createWorkspaceAssetUrlResolver", () => {
    beforeEach(() => {
        clearAssetUrlTokens();
        requestReadRaw.mockReset();
    });

    it("records the token it hands out against the asset it was minted for", async () => {
        requestReadRaw.mockResolvedValue({ success: true, data: { ok: true, data: "token-abc" } });

        const result = await createWorkspaceAssetUrlResolver(contextWith(ASSET_ID))(ASSET_ID);

        expect(result).toEqual({ success: true, url: "app://fs/token-abc" });
        // The round trip the index depends on: a URL that reaches a document is traceable back to
        // an asset only because this call wrote the pair down.
        expect(lookupAssetIdForUrl("app://fs/token-abc")).toBe(ASSET_ID);
    });

    it("records nothing when the grant request failed", async () => {
        // Only a URL that was actually handed out is a fact; a failed read hands out no token.
        requestReadRaw.mockResolvedValue({ success: false, error: "denied" });

        const result = await createWorkspaceAssetUrlResolver(contextWith(ASSET_ID))(ASSET_ID);

        expect(result.success).toBe(false);
        expect(lookupAssetIdForUrl("app://fs/token-abc")).toBeNull();
    });
});
