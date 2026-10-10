import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `assets_import` over stand-ins for the filesystem and the asset service: a path with no file is
 * reported as not found (not as a permission problem), a byte-identical file is reported under
 * `duplicates` with the existing asset's name, and an opaque portrait image - a CG as often as a
 * sprite - imports without a sprite warning.
 */

const disk = new Map<string, string>();

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));
vi.mock("./agentFolderRequest", () => ({ ensureAgentMayReadPaths: async () => undefined }));
vi.mock("@/lib/app/privilegedFacade", () => ({
    appPrivilegedFacade: {
        fs: {
            isFileExists: async (path: string) => ({ success: true, data: { ok: true, data: disk.has(path) } }),
            hash: async (path: string) => disk.has(path)
                ? { success: true, data: { ok: true, data: `hash:${disk.get(path)}` } }
                : { success: true, data: { ok: false, error: { code: "NOT_FOUND", message: "missing" } } },
        },
    },
}));

import type { AgentCallResult } from "@shared/agent/protocol";
import { AssetType } from "../assets/assetTypes";
import { Services } from "../services";
import type { AgentToolContext } from "./agentCall";
import { assetsImport } from "./tools/assetTools";

type FakeAsset = { id: string; name: string; type: AssetType; hash: string; groupId?: string };

function harness(existing: FakeAsset[] = []) {
    const images: Record<string, FakeAsset> = Object.fromEntries(existing.map(asset => [asset.id, asset]));
    const importFromPaths = vi.fn(async (type: AssetType, paths: string[]) => {
        const id = `a${Object.keys(images).length + 1}`;
        const asset: FakeAsset = { id, name: paths[0].split("/").pop()!, type, hash: `hash:${disk.get(paths[0])}` };
        images[id] = asset;
        return { success: true, data: [{ success: true, data: asset }] };
    });
    const service = {
        getAssets: () => ({ [AssetType.Image]: images }),
        importFromPaths,
        renameAsset: async (asset: FakeAsset, name: string) => { images[asset.id].name = name; return { success: true }; },
        getGroupAssetsManager: () => ({ getGroups: () => [] }),
    };
    const tool = {
        ctx: { services: { get: (name: string) => (name === Services.Assets ? service : undefined) }, project: { getConfig: () => ({ projectPath: "/project" }) } },
        request: { callId: "call", policy: { allowedImportRoots: [] } },
        follow: { describeCall: vi.fn() },
        log: vi.fn(),
    } as unknown as AgentToolContext;
    const run = async (args: Record<string, unknown>) => {
        const result = await assetsImport(args, tool) as Extract<AgentCallResult, { ok: true }>;
        return { structured: result.structured as Record<string, any>, text: JSON.stringify(result.content) };
    };
    return { run, importFromPaths, images };
}

beforeEach(() => {
    disk.clear();
});

describe("assets_import", () => {
    it("reports a path with no file as not found, without trying to import it", async () => {
        const { run, importFromPaths } = harness();
        const { structured } = await run({ paths: ["/art/missing.png"] });
        expect(structured.failed).toEqual([{ path: "/art/missing.png", reason: expect.stringMatching(/^File not found/) }]);
        expect(structured.failed[0].reason).not.toMatch(/allowed to read/);
        expect(importFromPaths).not.toHaveBeenCalled();
    });

    it("reports a byte-identical file under duplicates with the existing asset's name", async () => {
        disk.set("/art/copy.png", "same-bytes");
        const { run, importFromPaths } = harness([{ id: "bg", name: "bg_street", type: AssetType.Image, hash: "hash:same-bytes" }]);
        const { structured, text } = await run({ paths: ["/art/copy.png"], names: ["bg_street_copy"] });
        expect(structured.imported).toEqual([]);
        expect(structured.duplicates).toEqual([{ path: "/art/copy.png", existing: expect.objectContaining({ name: "bg_street" }) }]);
        expect(text).toMatch(/use the existing asset's name/);
        expect(importFromPaths).not.toHaveBeenCalled();
    });

    it("imports an opaque portrait image without a sprite warning", async () => {
        disk.set("/art/cg_01.jpg", "cg-bytes");
        const { run } = harness();
        const { structured } = await run({ paths: ["/art/cg_01.jpg"], folder: undefined });
        expect(structured.imported).toEqual([expect.objectContaining({ name: "cg_01" })]);
        expect(structured.warnings).toBeUndefined();
    });
});
