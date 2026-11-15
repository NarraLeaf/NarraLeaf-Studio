import { beforeEach, describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode } from "@shared/types/os";
import { encodeProjectConfig } from "@shared/utils/nlproj";
import { join } from "@shared/utils/path";
import { Services, type WorkspaceContext } from "../services";
import { ProjectFileAccessError, ProjectService } from "./ProjectService";

const ROOT = "/projects/demo";
const OLD = join(ROOT, "resources/icons/source/master.png");
const NEW = join(ROOT, "resources/icons/source/master.svg");
const PICKED = "/picked/master.svg";
const selectFile = vi.hoisted(() => vi.fn());

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({}),
    getPrivilegedInterface: () => ({ fs: { selectFile } }),
}));

function mount(failWrite: boolean, root = ROOT) {
    const files = new Map<string, Uint8Array>([
        [join(root, "resources/icons/source/master.png"), new Uint8Array([1, 2, 3])],
        [PICKED, new Uint8Array([4, 5, 6])],
    ]);
    const config = encodeProjectConfig({ name: "Demo", identifier: "demo", metadata: {} } as never);
    const filesystem = {
        list: async () => ({ ok: true, data: [{ name: "Demo", ext: ".nlproj", type: "file" }] }),
        readRaw: async (path: string) => ({ ok: true, data: path.endsWith(".nlproj") ? config : files.get(path)! }),
        createDir: async () => ({ ok: true, data: undefined }),
        isFileExists: async (path: string) => ({ ok: true, data: files.has(path) }),
        deleteFile: async (path: string) => {
            files.delete(path);
            return { ok: true, data: undefined };
        },
        writeRaw: async (path: string, bytes: Uint8Array) => {
            if (failWrite) {
                return { ok: false, error: { code: FsRejectErrorCode.NO_SPACE, message: "disk full" } };
            }
            files.set(path, bytes);
            return { ok: true, data: undefined };
        },
    };
    const ctx = {
        project: {
            getConfig: () => ({ projectPath: root }),
            resolve: (path: string | readonly string[]) => join(root, ...(Array.isArray(path) ? path : [path])),
        },
        services: {
            get: (id: Services) => {
                if (id !== Services.FileSystem) throw new Error(`Unexpected service: ${id}`);
                return filesystem;
            },
        },
    } as unknown as WorkspaceContext;
    return { ctx, files, filesystem };
}

describe("ProjectService icon import", () => {
    beforeEach(() => {
        selectFile.mockReset();
        selectFile.mockResolvedValue({ success: true, data: { ok: true, data: [PICKED] } });
    });

    it("keeps the existing source when writing its replacement fails", async () => {
        const { ctx, files } = mount(true);
        const service = new ProjectService();
        await service.initialize(ctx, async () => undefined);

        await expect(service.importProjectIconSource("master")).rejects.toBeInstanceOf(ProjectFileAccessError);

        expect(files.get(OLD)).toEqual(new Uint8Array([1, 2, 3]));
        expect(files.has(NEW)).toBe(false);
    });

    it("removes the previous format after writing the new source", async () => {
        const { ctx, files } = mount(false);
        const service = new ProjectService();
        await service.initialize(ctx, async () => undefined);

        const result = await service.importProjectIconSource("master");

        expect(result?.source.path).toBe("resources/icons/source/master.svg");
        expect(files.get(NEW)).toEqual(new Uint8Array([4, 5, 6]));
        expect(files.has(OLD)).toBe(false);
    });

    it("does not import a selection from a closed project into the next project", async () => {
        const firstProject = mount(false);
        const nextProject = mount(false, "/projects/next");
        const service = new ProjectService();
        await service.initialize(firstProject.ctx, async () => undefined);
        let finishSelection!: (value: unknown) => void;
        selectFile.mockImplementationOnce(() => new Promise(resolve => { finishSelection = resolve; }));

        const importing = service.importProjectIconSource("master").then(() => null, error => error);
        await service.initialize(nextProject.ctx, async () => undefined);
        finishSelection({ success: true, data: { ok: true, data: [PICKED] } });

        expect(await importing).toBeInstanceOf(Error);
        expect(firstProject.files.get(OLD)).toEqual(new Uint8Array([1, 2, 3]));
        expect(nextProject.files.has("/projects/next/resources/icons/source/master.svg")).toBe(false);
        expect(nextProject.files.has("/projects/next/resources/icons/source/master.png")).toBe(true);
    });

    it("does not finish a derived write after its project has closed", async () => {
        const firstProject = mount(false);
        const nextProject = mount(false, "/projects/next");
        const service = new ProjectService();
        await service.initialize(firstProject.ctx, async () => undefined);
        const read = firstProject.filesystem.readRaw;
        let finishRead!: () => void;
        let readStarted!: () => void;
        const started = new Promise<void>(resolve => { readStarted = resolve; });
        firstProject.filesystem.readRaw = async path => {
            const result = await read(path);
            if (path === OLD) {
                readStarted();
                await new Promise<void>(resolve => { finishRead = resolve; });
            }
            return result;
        };

        const writing = service.writeProjectDerivedFile(
            "resources/icons/source/master.png", new Uint8Array([7]),
            { store: "workspace.shell.save.stores.projectIcon" },
        ).then(() => null, error => error);
        await started;
        await service.initialize(nextProject.ctx, async () => undefined);
        finishRead();

        expect(await writing).toBeInstanceOf(Error);
        expect(firstProject.files.get(OLD)).toEqual(new Uint8Array([1, 2, 3]));
        expect(nextProject.files.get("/projects/next/resources/icons/source/master.png"))
            .toEqual(new Uint8Array([1, 2, 3]));
    });

    it("does not resume a file selection from an earlier opening of the same workspace", async () => {
        const current = mount(false);
        const service = new ProjectService();
        await service.initialize(current.ctx, async () => undefined);
        let finishSelection!: (value: unknown) => void;
        selectFile.mockImplementationOnce(() => new Promise(resolve => { finishSelection = resolve; }));

        const importing = service.importProjectIconSource("master").then(() => null, error => error);
        await service.teardown(current.ctx);
        await service.initialize(current.ctx, async () => undefined);
        finishSelection({ success: true, data: { ok: true, data: [PICKED] } });

        expect(await importing).toBeInstanceOf(Error);
        expect(current.files.get(OLD)).toEqual(new Uint8Array([1, 2, 3]));
        expect(current.files.has(NEW)).toBe(false);
    });
});
