import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readers = vi.hoisted(() => ({ openOverlay: vi.fn() }));

vi.mock("@narraleaf/bindings/read", () => ({
    OVERLAY_DESCRIPTOR_ENTRY: "layer",
    OVERLAY_FILE_EXTENSION: ".assetpatch",
    ASSET_ARCHIVE_FILENAME: "assets.bin",
    ARCHIVE_READER_FILENAME: "bindings.node",
    openAssetOverlay: readers.openOverlay,
    openAssetArchive: vi.fn(),
}));

import { createRuntimeResources } from "./runtimeResources";

describe("runtime layer discovery", () => {
    let root: string;
    let appDir: string;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-layer-discovery-"));
        appDir = path.join(root, "app");
        await fs.mkdir(appDir);
        await fs.writeFile(path.join(appDir, "pack.json"), JSON.stringify({ assets: { items: {} } }));
        await fs.writeFile(path.join(appDir, "bindings.node"), "");
        readers.openOverlay.mockReset();
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await fs.rm(root, { recursive: true, force: true });
    });

    it("closes a layer whose pack contribution cannot be read", async () => {
        const close = vi.fn(async () => undefined);
        readers.openOverlay.mockResolvedValue({
            proven: true,
            has: (name: string) => name === "pack.delta",
            read: async () => { throw new Error("unreadable contribution"); },
            close,
        });
        await fs.mkdir(path.join(root, "patch"));
        await fs.writeFile(path.join(root, "patch", "broken.assetpatch"), "");

        const warnings: string[] = [];
        const resources = await createRuntimeResources(appDir, {
            gameRootDir: root,
            log: (level, message) => { if (level === "warning") warnings.push(message); },
        });
        try {
            expect(warnings).toContain("patch not applied: broken.assetpatch");
            expect(close).toHaveBeenCalledOnce();
        } finally {
            await resources.dispose();
        }
    });

    it("opens distinct DLC files whose paths differ only by case", async () => {
        const lower = path.join(root, "dlc");
        const upper = path.join(root, "DLC");
        // Model a case-sensitive volume even when the host's temporary volume is case-insensitive.
        const readdir = fs.readdir.bind(fs);
        vi.spyOn(fs, "readdir").mockImplementation((async (directory: Parameters<typeof fs.readdir>[0]) => {
            if (directory === lower || directory === upper) return ["story_DLC.pak"];
            return readdir(directory);
        }) as typeof fs.readdir);
        vi.spyOn(fs, "stat").mockImplementation((async (file: Parameters<typeof fs.stat>[0]) => {
            if (typeof file === "string" && file.endsWith("story_DLC.pak")) {
                return { ino: path.dirname(file) === upper ? 2 : 1, dev: 1 };
            }
            throw new Error("Unexpected stat");
        }) as typeof fs.stat);
        readers.openOverlay.mockImplementation(async (_binary: string, file: string) => {
            const id = path.dirname(file) === upper ? "upper" : "lower";
            return {
                proven: false,
                has: (name: string) => name === "layer",
                read: async () => Buffer.from(JSON.stringify({ dlc: { id, attachTo: "main" } })),
                close: async () => undefined,
            };
        });

        const resources = await createRuntimeResources(appDir, { gameRootDir: root });
        try {
            expect(resources.installedDlcIds()).toEqual(["lower", "upper"]);
        } finally {
            await resources.dispose();
        }
    });

    it("opens a DLC only once when both directory spellings name the same file", async () => {
        const lower = path.join(root, "dlc");
        const upper = path.join(root, "DLC");
        const readdir = fs.readdir.bind(fs);
        vi.spyOn(fs, "readdir").mockImplementation((async (directory: Parameters<typeof fs.readdir>[0]) => {
            if (directory === lower || directory === upper) return ["story_DLC.pak"];
            return readdir(directory);
        }) as typeof fs.readdir);
        vi.spyOn(fs, "stat").mockResolvedValue({ ino: 1, dev: 1 } as Awaited<ReturnType<typeof fs.stat>>);
        const close = vi.fn(async () => undefined);
        readers.openOverlay.mockResolvedValue({
            proven: false,
            has: () => false,
            close,
        });

        const resources = await createRuntimeResources(appDir, { gameRootDir: root });
        expect(readers.openOverlay).toHaveBeenCalledOnce();
        await resources.dispose();
        expect(close).toHaveBeenCalledOnce();
    });
});
