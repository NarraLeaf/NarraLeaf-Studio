// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { AssetSource } from "@/lib/workspace/services/assets/types";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { AssetsMetadataManager } from "@/lib/workspace/services/assets/mgr/AssetsMetadataManager";
import { markReportedToAuthor } from "@/lib/workspace/services/autosave/reportedFailure";
import { SaveStatusService } from "@/lib/workspace/services/autosave/SaveStatusService";
import type { FsWriteOutcome } from "@/lib/workspace/services/core/FileSystem";
import type { FsWriteReport } from "@/lib/workspace/services/autosave/writeReport";
import { FsRejectErrorCode } from "@shared/types/os";
import type { WorkspaceContext } from "@/lib/workspace/services/services";
import { AssetSetWizard } from "./AssetSetWizard";

const environment = vi.hoisted(() => ({ context: null as unknown }));
const saveStatuses: SaveStatusService[] = [];

vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => ({ context: environment.context }),
}));
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key, tn: (key: string) => key, locale: "en" }),
}));
vi.mock("./AssetThumbnail", () => ({ AssetThumbnail: () => null }));
vi.mock("./AssetSelector", () => ({ AssetSelector: () => null }));

afterEach(() => {
    cleanup();
    saveStatuses.splice(0).forEach(status => status.dispose());
    environment.context = null;
    vi.restoreAllMocks();
});

function asset(id: string, name: string): Asset<AssetType.Image> {
    return { id, name, type: AssetType.Image, source: AssetSource.Local, hash: id, ext: "png", tags: [], description: "", meta: {} };
}

async function openWizard({ failWrite = false } = {}) {
    const en = asset("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "title_en.png");
    const ja = asset("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "title_ja.png");
    const createSet = vi.fn();
    const onClose = vi.fn();
    const showSticky = vi.fn(() => "notice");
    let observer: ((outcome: FsWriteOutcome) => void) | null = null;
    const filesystem = {
        observeWrites: (listener: (outcome: FsWriteOutcome) => void) => {
            observer = listener;
            return () => { observer = null; };
        },
        ensureRegularFile: async () => ({ ok: true, data: undefined }),
        readJSON: async (path: string) => ({
            ok: true,
            data: path.includes("assets.metadata.image.json")
                ? { [en.id]: structuredClone(en), [ja.id]: structuredClone(ja) }
                : {},
        }),
        writeFileNoFollow: async (path: string, _data: string, _encoding: string, report?: FsWriteReport) => {
            if (failWrite) {
                const error = { code: FsRejectErrorCode.PERMISSION_DENIED, message: "write failed" };
                observer?.({ path, ok: false, error, report });
                return { ok: false as const, error };
            }
            observer?.({ path, ok: true, report });
            return { ok: true as const, data: undefined };
        },
    };
    const assetsService = new AssetsService();
    const context = {
        project: { resolve: (parts: string[]) => parts.join("/") },
        services: {
            get: (id: string) => {
                if (id === "assets") return assetsService;
                if (id === "fileSystem") return filesystem;
                if (id === "assetSets") return { createSet };
                if (id === "uuid") return { generate: () => "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
                if (id === "localization") return { getConfiguration: () => ({
                    sourceLocale: "en", locales: [{ code: "en", displayName: "English" }, { code: "ja", displayName: "Japanese" }],
                }) };
                if (id === "appTags") return { listTags: () => [] };
                if (id === "ui") return { notifications: { showSticky, close: vi.fn() } };
                if (id === "console") return { log: vi.fn() };
                throw new Error(`Unexpected service ${id}`);
            },
        },
    } as unknown as WorkspaceContext;
    assetsService.setContext(context);
    const manager = await new AssetsMetadataManager(assetsService, context).init();
    Object.assign(assetsService, { assetsMetadataManager: manager });
    const saveStatus = new SaveStatusService();
    saveStatus.setContext(context);
    await saveStatus.initialize(context, async () => undefined);
    saveStatuses.push(saveStatus);
    environment.context = context;
    const selected = [manager.getAssets().image[en.id], manager.getAssets().image[ja.id]];
    render(<AssetSetWizard assets={selected} onClose={onClose} />);
    expect((screen.getByRole("button", { name: "common.create" }) as HTMLButtonElement).disabled).toBe(false);
    return { en, ja, manager, assetsService, createSet, onClose, saveStatus, showSticky };
}

describe("creating an asset set", () => {
    it("does not create a set or change surviving assets when a chosen member was deleted", async () => {
        const { en, ja, manager, createSet, onClose } = await openWizard();
        delete manager.getAssets().image[ja.id];

        await act(async () => fireEvent.click(screen.getByRole("button", { name: "common.create" })));

        expect(createSet).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        expect(manager.getAssets().image[en.id].tags).toEqual([]);
        expect(screen.getByRole("alert").textContent).toContain("assets.reference.missing");

        manager.getAssets().image[ja.id] = ja;
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "common.create" })));
        expect(createSet).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("tags the selected files and creates the declared set when both still exist", async () => {
        const { en, ja, manager, createSet, onClose } = await openWizard();

        await act(async () => fireEvent.click(screen.getByRole("button", { name: "common.create" })));

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(createSet).toHaveBeenCalledTimes(1);
        expect(manager.getAssets().image[en.id].tags).toContain("locale:en");
        expect(manager.getAssets().image[ja.id].tags).toContain("locale:ja");
    });

    it("does not create a set when a member disappears during tagging", async () => {
        const { en, ja, manager, assetsService, createSet, onClose } = await openWizard();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const off = assetsService.getEvents().on("updated", updated => {
            if (updated.id === en.id) delete manager.getAssets().image[ja.id];
        });

        await act(async () => fireEvent.click(screen.getByRole("button", { name: "common.create" })));

        off();
        expect(createSet).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByRole("alert").textContent).toContain("assets.reference.missing");
        expect(screen.getByRole("alert").textContent).toContain(ja.name);
        // The asset library batches writes but does not roll back the first edit.
        expect(manager.getAssets().image[en.id].tags).toContain("locale:en");
    });

    it("reports an unclassified refusal without exposing the service message", async () => {
        const { assetsService, createSet, onClose } = await openWizard();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        vi.spyOn(assetsService, "updateAssetTags").mockResolvedValueOnce({ success: false, error: "private service detail" });

        await act(async () => fireEvent.click(screen.getByRole("button", { name: "common.create" })));

        expect(createSet).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByRole("alert").textContent).toContain("assets.unknownError");
        expect(screen.getByRole("alert").textContent).not.toContain("private service detail");
    });

    it("does not duplicate an error the save-status surface already reported", async () => {
        const { assetsService, createSet, onClose } = await openWizard();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        vi.spyOn(assetsService, "transaction").mockRejectedValueOnce(markReportedToAuthor(new Error("already reported")));

        await act(async () => fireEvent.click(screen.getByRole("button", { name: "common.create" })));

        expect(createSet).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.queryByRole("alert")).toBeNull();
    });

    it("reports a thrown tagging failure inside the still-open wizard", async () => {
        const { assetsService, createSet, onClose } = await openWizard();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        vi.spyOn(assetsService, "updateAssetTags").mockRejectedValueOnce(new Error("internal failure"));

        await act(async () => fireEvent.click(screen.getByRole("button", { name: "common.create" })));

        expect(createSet).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByRole("alert").textContent).toContain("assets.unknownError");
        expect(screen.getByRole("alert").textContent).not.toContain("internal failure");
    });

    it("leaves a failed metadata write to the save-status surface", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const { createSet, onClose, showSticky } = await openWizard({ failWrite: true });

        await act(async () => fireEvent.click(screen.getByRole("button", { name: "common.create" })));

        expect(createSet).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(showSticky).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole("alert")).toBeNull();
    });
});
