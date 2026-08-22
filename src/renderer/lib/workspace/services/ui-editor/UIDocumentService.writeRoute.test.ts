import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode } from "@shared/types/os";
import {
    freezeProjectWrites,
    holdProjectWritesForReload,
    thawProjectWrites,
} from "@/lib/app/writeFreeze";
import { FileSystemService } from "../core/FileSystem";
import { Services } from "../services";
import { UIDocumentService } from "./UIDocumentService";
import { UIGraphService } from "./UIGraphService";

/**
 * The route `editor/ui/uidoc.json` and `editor/ui/uigraphs.json` go out by, asserted end to end.
 *
 * Neither service writes through `fs.write` any more - no write grant, no protocol `PUT`, just the
 * one IPC call `Fs.writeFileNoFollowOrCreate` sits behind. The real `FileSystemService`, the real
 * privileged facade and the real freeze latch are all in the path here; only the host at the far end
 * of the IPC is stubbed, so a layer that dropped `refused` on the way back would show up as a write
 * that reached a host it should never have reached.
 */

const PROJECT = "D:/projects/my-game";
const UIDOC = `${PROJECT}/editor/ui/uidoc.json`;
const UIGRAPHS = `${PROJECT}/editor/ui/uigraphs.json`;

const privilegedFs = vi.hoisted(() => ({
    writeFileNoFollowOrCreate: vi.fn(),
    requestWrite: vi.fn(),
    isDirExists: vi.fn(),
    createDir: vi.fn(),
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({}),
    getPrivilegedInterface: () => ({ fs: privilegedFs }),
}));

/** The bytes the host accepted, by path. */
const disk = new Map<string, string>();

function createContext() {
    const filesystem = new FileSystemService();
    let nextId = 0;
    return {
        project: {
            resolve: (...parts: (string | string[])[]) =>
                [PROJECT, ...parts.flatMap(part => (Array.isArray(part) ? part : [part]))].join("/"),
            getProjectConfig: () => ({ metadata: { resolution: { width: 1280, height: 720 } } }),
        },
        services: {
            get(serviceId: Services) {
                switch (serviceId) {
                    case Services.FileSystem: return filesystem;
                    case Services.Uuid: return { generate: () => `generated-${++nextId}` };
                    case Services.Project: return { getProjectConfig: () => ({ metadata: { resolution: { width: 1280, height: 720 } } }) };
                    default: throw new Error(`Unexpected service ${serviceId}`);
                }
            },
        },
    } as never;
}

/** A service holding a freshly built empty document, without running `init`'s load. */
function createDocumentService() {
    const service = new UIDocumentService();
    service.setContext(createContext());
    (service as never as { document: unknown }).document =
        (service as never as { createEmptyDocument: () => unknown }).createEmptyDocument();
    return service;
}

function createGraphService() {
    const service = new UIGraphService();
    service.setContext(createContext());
    (service as never as { document: unknown }).document =
        (service as never as { createEmptyDocument: () => unknown }).createEmptyDocument();
    return service;
}

/** "Save whatever this service is holding" - the one call both services answer alike. */
function saverFor(service: UIDocumentService): () => Promise<void>;
function saverFor(service: UIGraphService): () => Promise<void>;
function saverFor(service: UIDocumentService | UIGraphService): () => Promise<void> {
    return service instanceof UIDocumentService
        ? () => service.save(service.getDocument())
        : () => service.save(service.getDocument());
}

/** Paths the host was actually asked to write, in order. */
function hostWrites(): string[] {
    return privilegedFs.writeFileNoFollowOrCreate.mock.calls.map(call => call[1] as string);
}

describe("the interface documents take the no-grant write route", () => {
    beforeEach(() => {
        disk.clear();
        privilegedFs.writeFileNoFollowOrCreate.mockReset();
        privilegedFs.writeFileNoFollowOrCreate.mockImplementation(
            async (_actor: unknown, path: string, data: string) => {
                disk.set(path, data);
                return { success: true, data: { ok: true, data: undefined } };
            },
        );
        privilegedFs.requestWrite.mockReset();
        privilegedFs.isDirExists.mockResolvedValue({ success: true, data: { ok: true, data: true } });
        privilegedFs.createDir.mockResolvedValue({ success: true, data: { ok: true, data: undefined } });
    });

    afterEach(() => {
        thawProjectWrites();
    });

    it("writes uidoc.json without asking for a write grant", async () => {
        const service = createDocumentService();

        await service.save(service.getDocument());

        expect(hostWrites()).toEqual([UIDOC]);
        expect(disk.get(UIDOC)).toContain("\"schemaVersion\"");
        // The whole point of the change: the grant round trip and the protocol PUT are gone.
        expect(privilegedFs.requestWrite).not.toHaveBeenCalled();
    });

    it("writes uigraphs.json without asking for a write grant", async () => {
        const service = createGraphService();

        await service.save(service.getDocument());

        expect(hostWrites()).toEqual([UIGRAPHS]);
        expect(privilegedFs.requestWrite).not.toHaveBeenCalled();
    });

    /**
     * The latch still stops both of them, and stops them *before* the IPC call. The service's own
     * dirty flag does not read `refused` - it never did, on either route - so what is asserted here
     * is the property the swap could actually have broken: nothing reaches the disk, and the write
     * that reports the refusal is the same call the service made.
     */
    it.each([
        ["the interface document", () => saverFor(createDocumentService()), UIDOC],
        ["the interface graphs", () => saverFor(createGraphService()), UIGRAPHS],
    ])("keeps %s off the disk while the workspace is frozen", async (_label, create, path) => {
        const save = create();
        freezeProjectWrites({ projectPath: PROJECT, reason: { kind: "manual" } });

        await save();

        expect(hostWrites()).toEqual([]);
        expect(disk.get(path)).toBeUndefined();

        thawProjectWrites();
        await save();
        expect(hostWrites()).toEqual([path]);
    });

    it("keeps the interface document off the disk while the working tree is being re-read", async () => {
        const service = createDocumentService();
        const release = holdProjectWritesForReload(PROJECT);

        await service.save(service.getDocument());
        expect(hostWrites()).toEqual([]);

        release();
        await service.save(service.getDocument());
        expect(hostWrites()).toEqual([UIDOC]);
    });

    /** A real failure still throws out of `save`, and still reaches the save-status surface. */
    it("reports a refused-by-contract path as a failure, not as a refusal", async () => {
        const service = createDocumentService();
        const outcomes: { path: string; ok: boolean; code?: FsRejectErrorCode }[] = [];
        const stop = new FileSystemService().observeWrites(outcome =>
            outcomes.push({ path: outcome.path, ok: outcome.ok, code: outcome.error?.code }));

        privilegedFs.writeFileNoFollowOrCreate.mockResolvedValue({
            success: true,
            // What a symlinked or hard-linked uidoc.json now answers, where the grant route wrote
            // straight through it.
            data: { ok: false, error: { code: FsRejectErrorCode.INVALID_PATH, message: "unsafe file path" } },
        });

        await expect(service.save(service.getDocument())).rejects.toThrow(/unsafe file path/);
        stop();

        const failure = outcomes.find(outcome => !outcome.ok);
        expect(failure?.path).toBe(UIDOC);
        expect(failure?.code).toBe(FsRejectErrorCode.INVALID_PATH);
    });
});
