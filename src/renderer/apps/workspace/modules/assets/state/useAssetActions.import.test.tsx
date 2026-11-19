// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetCategory, AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { createEmptyAssetCategoryRecord } from "./assetCategoryRecord";
import { useAssetActions } from "./useAssetActions";

const io = vi.hoisted(() => ({
    selectFile: vi.fn(async () => ({ success: true, data: { ok: true, data: ["original.tif"] } })),
    deleteDir: vi.fn(async () => ({ success: true })),
    bucket: vi.fn(),
    showAlert: vi.fn(),
}));
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key, tn: (key: string) => key, locale: "en" }),
}));
vi.mock("@/apps/workspace/components/ui/freezeGuard", async () => {
    const actual = await vi.importActual<typeof import("@/apps/workspace/components/ui/freezeGuard")>(
        "@/apps/workspace/components/ui/freezeGuard",
    );
    return { ...actual, useFreezeGuard: () => actual.makeFreezeGuard(false, "") };
});
vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ fs: { selectFile: io.selectFile, deleteDir: io.deleteDir } }),
}));
vi.mock("@/lib/workspace/projectTrust", () => ({ isProjectTrusted: async () => false }));
vi.mock("../dnd/openDraggedAssetsInEditor", () => ({ openAssetPreviewTabsInEditor: () => undefined }));

afterEach(() => {
    cleanup();
    Object.values(io).forEach(mock => mock.mockClear());
    vi.restoreAllMocks();
});

describe("importing converted assets", () => {
    it("removes the conversion scratch directory when the import throws", async () => {
        io.bucket.mockRejectedValueOnce(new Error("import failed"));
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const context = {
            project: { resolve: () => "project" },
            services: { get: (id: string) => id === "ui"
                ? { showAlert: io.showAlert }
                : { bucketPathsByAssetType: io.bucket } },
        };
        const hook = renderHook(() => useAssetActions({
            context: context as never,
            inputDialog: null,
            assets: createEmptyAssetCategoryRecord(),
            groups: createEmptyAssetCategoryRecord(),
            selectedItems: new Set(),
            clipboard: null,
            contextMenuTarget: null,
            focusedItemId: null,
            onActionComplete: () => undefined,
            setClipboard: () => undefined,
        }));

        await act(async () => hook.result.current.handleImport(AssetCategory.Image));
        expect(hook.result.current.mediaImportRequest).not.toBeNull();
        await act(async () => hook.result.current.completeMediaImport({
            paths: ["converted.png"], scratchDirs: ["scratch"], failures: [],
        }));

        expect(io.deleteDir).toHaveBeenCalledWith("scratch");
        expect(io.showAlert).toHaveBeenCalled();
    });

    it("retries a failed converted file from its original source through conversion", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const finish = vi.fn();
        const assets = {
            bucketPathsByAssetType: async () => [{ type: AssetType.Image, paths: ["scratch/converted.png"] }],
            importFromPaths: async () => ({ success: true, data: [{ success: false }] }),
            transaction: async (run: (service: unknown) => Promise<void>) => run(assets),
        };
        const context = {
            project: { resolve: () => "project" },
            services: { get: (id: string) => id === "ui" ? { showAlert: io.showAlert } : assets },
        };
        const hook = renderHook(() => useAssetActions({
            context: context as never,
            inputDialog: null,
            assets: createEmptyAssetCategoryRecord(),
            groups: createEmptyAssetCategoryRecord(),
            selectedItems: new Set(),
            clipboard: null,
            contextMenuTarget: null,
            focusedItemId: null,
            onActionComplete: () => undefined,
            setClipboard: () => undefined,
            importQueue: { start: () => undefined, progress: () => undefined, finish },
        }));

        await act(async () => hook.result.current.handleImport(AssetCategory.Image));
        await act(async () => hook.result.current.completeMediaImport({
            paths: ["scratch/converted.png"],
            scratchDirs: ["scratch"],
            failures: [],
            sourcesByConvertedPath: { "scratch/converted.png": "original.tif" },
        } as never));

        expect(finish).toHaveBeenLastCalledWith([{ path: "original.tif", needsMediaTriage: true }]);
        expect(io.deleteDir).toHaveBeenCalledWith("scratch");
        await act(async () => hook.result.current.handleRetryImport(AssetCategory.Image, [{ path: "original.tif", needsMediaTriage: true }]));
        expect(hook.result.current.mediaImportRequest?.plan.problems[0]?.path).toBe("original.tif");
    });

    it("reopens conversion when a conversion itself failed", async () => {
        const context = { project: { resolve: () => "project" }, services: { get: () => ({}) } };
        const finish = vi.fn();
        const hook = renderHook(() => useAssetActions({
            context: context as never,
            inputDialog: null,
            assets: createEmptyAssetCategoryRecord(),
            groups: createEmptyAssetCategoryRecord(),
            selectedItems: new Set(),
            clipboard: null,
            contextMenuTarget: null,
            focusedItemId: null,
            onActionComplete: () => undefined,
            setClipboard: () => undefined,
            importQueue: { start: () => undefined, progress: () => undefined, finish },
        }));
        await act(async () => hook.result.current.handleImport(AssetCategory.Image));
        await act(async () => hook.result.current.completeMediaImport({
            paths: [], scratchDirs: ["scratch"], failures: [{ path: "original.tif" }],
        }));

        expect(finish).toHaveBeenCalledWith([{ path: "original.tif", needsMediaTriage: true }]);
        await act(async () => hook.result.current.handleRetryImport(AssetCategory.Image, [{ path: "original.tif", needsMediaTriage: true }]));
        expect(hook.result.current.mediaImportRequest?.plan.problems[0]?.path).toBe("original.tif");
    });

    it("retries an ordinary failed import without repeating media triage", async () => {
        const assets = {
            bucketPathsByAssetType: async () => [{ type: AssetType.Image, paths: ["image.png"] }],
            importFromPaths: vi.fn(async () => ({ success: true, data: [{ success: false }] })),
            transaction: async (run: (service: unknown) => Promise<void>) => run(assets),
        };
        const context = {
            project: { resolve: () => "project" },
            services: { get: (id: string) => id === "ui" ? { showAlert: io.showAlert } : assets },
        };
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const hook = renderHook(() => useAssetActions({
            context: context as never,
            inputDialog: null,
            assets: createEmptyAssetCategoryRecord(),
            groups: createEmptyAssetCategoryRecord(),
            selectedItems: new Set(),
            clipboard: null,
            contextMenuTarget: null,
            focusedItemId: null,
            onActionComplete: () => undefined,
            setClipboard: () => undefined,
            importQueue: { start: () => undefined, progress: () => undefined, finish: () => undefined },
        }));

        await act(async () => hook.result.current.handleRetryImport(AssetCategory.Image, [{ path: "image.png" }]));

        expect(assets.importFromPaths).toHaveBeenCalledTimes(1);
        expect(hook.result.current.mediaImportRequest).toBeNull();
    });
});
