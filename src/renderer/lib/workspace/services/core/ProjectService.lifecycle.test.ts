import { describe, expect, it, vi } from "vitest";
import { decodeProjectConfig, encodeProjectConfig } from "@shared/utils/nlproj";
import type { ProjectConfig } from "../../project/project";
import { Services, type WorkspaceContext } from "../services";
import { ProjectService } from "./ProjectService";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

function project(name: string, heldWrite?: { started: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> }) {
    let bytes = encodeProjectConfig({ name, identifier: name.toLowerCase(), metadata: {} } as never);
    let writes = 0;
    const filesystem = {
        list: vi.fn(async () => ({ ok: true, data: [{ name, ext: ".nlproj", type: "file" }] })),
        readRaw: vi.fn(async () => ({ ok: true, data: bytes })),
        writeRaw: vi.fn(async (_path: string, next: Uint8Array) => {
            writes += 1;
            if (writes === 1 && heldWrite) {
                heldWrite.started.resolve();
                await heldWrite.release.promise;
            }
            bytes = next;
            return { ok: true, data: undefined };
        }),
    };
    const ctx = {
        project: { getConfig: () => ({ projectPath: `/projects/${name}` }) },
        services: {
            get: (id: Services) => {
                if (id !== Services.FileSystem) throw new Error(`Unexpected service: ${id}`);
                return filesystem;
            },
        },
    } as unknown as WorkspaceContext;
    return {
        ctx,
        filesystem,
        saved: () => decodeProjectConfig(bytes) as ProjectConfig,
    };
}

describe("ProjectService lifecycle", () => {
    it("finishes queued changes for the old project before loading the next one", async () => {
        const held = { started: deferred(), release: deferred() };
        const firstProject = project("First", held);
        const nextProject = project("Next");
        const service = new ProjectService();
        await service.initialize(firstProject.ctx, async () => undefined);

        const first = service.updateProjectName("First renamed");
        await held.started.promise;
        const second = service.updateProjectMetadata({ description: "first project" });
        const switching = service.initialize(nextProject.ctx, async () => undefined);
        for (let i = 0; i < 10; i += 1) await Promise.resolve();
        const nextLoadedBeforeWrite = nextProject.filesystem.list.mock.calls.length > 0;
        held.release.resolve();
        await Promise.all([first, second, switching]);

        expect(nextProject.saved()).toMatchObject({ name: "Next", metadata: {} });
        expect(firstProject.saved()).toMatchObject({ name: "First renamed", metadata: { description: "first project" } });
        expect(service.getProjectConfig().name).toBe("Next");
        expect(nextLoadedBeforeWrite).toBe(false);
    });

    it("rejects new changes while the previous project is closing", async () => {
        const held = { started: deferred(), release: deferred() };
        const firstProject = project("First", held);
        const nextProject = project("Next");
        const service = new ProjectService();
        await service.initialize(firstProject.ctx, async () => undefined);

        const first = service.updateProjectName("First renamed");
        await held.started.promise;
        const switching = service.initialize(nextProject.ctx, async () => undefined);
        const late = service.updateProjectName("Late change").then(() => null, error => error);
        held.release.resolve();
        await Promise.all([first, switching]);

        expect(await late).toBeInstanceOf(Error);
        expect(firstProject.saved().name).toBe("First renamed");
        expect(nextProject.saved().name).toBe("Next");
        expect(service.getProjectConfig().name).toBe("Next");
    });

    it("drains writes during teardown and accepts changes after reopening", async () => {
        const held = { started: deferred(), release: deferred() };
        const current = project("First", held);
        const service = new ProjectService();
        await service.initialize(current.ctx, async () => undefined);

        const writing = service.updateProjectName("First saved");
        await held.started.promise;
        let closed = false;
        const closing = service.teardown(current.ctx).then(() => { closed = true; });
        for (let i = 0; i < 10; i += 1) await Promise.resolve();
        const closedBeforeWrite = closed;
        held.release.resolve();
        await Promise.all([writing, closing]);

        expect(closedBeforeWrite).toBe(false);
        await service.initialize(current.ctx, async () => undefined);
        await service.updateProjectName("First reopened");
        expect(current.saved().name).toBe("First reopened");
    });
});
