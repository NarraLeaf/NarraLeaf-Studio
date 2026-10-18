import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetSource, type Asset } from "@/lib/workspace/services/assets/types";
import { Services } from "@/lib/workspace/services/services";
import { runReplaceAssetContentFlow } from "./replaceAssetContentFlow";

/**
 * Replace File…, from either entry point: pick a file, and the asset's bytes are replaced as one step
 * of undo. Picking is the whole decision outside a live session; inside one the replacement cannot
 * be taken back, and the confirm says so with its button hierarchy.
 */

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        fs: {
            selectFile: async () => ({ success: true, data: { ok: true, data: ["C:/incoming/room.jpg"] } }),
            selectDirectory: async () => ({ success: true, data: { ok: true, data: ["C:/incoming/model"] } }),
        },
    }),
}));

const t = ((key: string) => key) as never;

const asset = {
    id: "asset-1",
    type: AssetType.Image,
    name: "room.png",
    source: AssetSource.Local,
} as unknown as Asset;

function harness(options: { sharedLive?: boolean; confirm?: boolean; answer?: unknown } = {}) {
    const showDestructiveConfirm = vi.fn(async () => options.confirm ?? true);
    const showAlert = vi.fn(async () => undefined);
    const replaceAssetContentUndoably = vi.fn(async () => options.answer ?? { success: true, data: asset });
    const replaceAssetContent = vi.fn(async () => ({ success: true, data: asset }));
    const assets = { sharedLive: options.sharedLive ?? false, replaceAssetContentUndoably, replaceAssetContent };
    const context = {
        services: {
            get: (id: Services) => (id === Services.UI ? { showDestructiveConfirm, showAlert } : assets),
        },
    } as never;
    return { context, showDestructiveConfirm, showAlert, replaceAssetContentUndoably, replaceAssetContent };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("Replace File…", () => {
    it("replaces the file as one step of undo, named after the asset, without asking again", async () => {
        const { context, showDestructiveConfirm, replaceAssetContentUndoably, replaceAssetContent } = harness();

        await expect(runReplaceAssetContentFlow(context, asset, t)).resolves.toBe("replaced");

        expect(showDestructiveConfirm).not.toHaveBeenCalled();
        expect(replaceAssetContentUndoably).toHaveBeenCalledWith(asset, "C:/incoming/room.jpg", {
            key: "assets.history.replaceContent",
            params: { name: "room.png" },
        });
        expect(replaceAssetContent).not.toHaveBeenCalled();
    });

    it("says why nothing was replaced when the current file could not be kept for undo", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const { context, showAlert } = harness({
            answer: { success: false, error: "log only", refusal: { kind: "notKept" } },
        });

        await expect(runReplaceAssetContentFlow(context, asset, t)).resolves.toBe("failed");

        expect(showAlert).toHaveBeenCalledWith("assets.replace.failedTitle", "assets.replace.reason.notKept");
        expect(warn).toHaveBeenCalled();
    });

    it("asks first inside a live session, where the replacement cannot be taken back", async () => {
        const { context, showDestructiveConfirm, replaceAssetContentUndoably } = harness({ sharedLive: true, confirm: false });

        await expect(runReplaceAssetContentFlow(context, asset, t)).resolves.toBe("cancelled");

        expect(showDestructiveConfirm).toHaveBeenCalledWith(
            "assets.replace.confirmTitle",
            undefined,
            "assets.replace.confirmAction",
        );
        expect(replaceAssetContentUndoably).not.toHaveBeenCalled();
    });
});
