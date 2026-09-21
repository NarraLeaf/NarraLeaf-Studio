import { describe, expect, it } from "vitest";
import { createTranslator, SUPPORTED_LOCALES } from "@shared/i18n";
import { FsRejectErrorCode, type FsRejectError } from "@shared/types/os";
import { decodeProjectConfig, encodeProjectConfig } from "@shared/utils/nlproj";
import { describeProjectFileWriteFailure, ProjectFileWriteError, ProjectService } from "./ProjectService";
import { Services, type WorkspaceContext } from "../services";
import type { ProjectConfig } from "../../project/project";
import type { FsWriteReport } from "../autosave/writeReport";

const PROJECT_PATH = "D:/projects/demo";

function config(encryptAssets: boolean): ProjectConfig {
    return {
        name: "Demo",
        identifier: "demo",
        metadata: {},
        app: {
            network: { allowHttp: false, allowRemoteResource: false, allowRemoteScript: false },
            security: { encryptAssets },
        },
    } as ProjectConfig;
}

/**
 * A .nlproj on a fake disk, plus the WorkspaceContext the service needs to find
 * it. `write` stands in for any other writer - a second Studio window, the
 * packaging pipeline, a hand edit - none of which the service is told about.
 */
function mount(initial: ProjectConfig) {
    const disk = { bytes: encodeProjectConfig(initial as never) };
    const filesystem = {
        list: async () => ({ ok: true, data: [{ name: "Demo", ext: ".nlproj", type: "file" }] }),
        readRaw: async () => ({ ok: true, data: disk.bytes }),
    };
    const ctx = {
        project: { getConfig: () => ({ projectPath: PROJECT_PATH }) } as unknown as WorkspaceContext["project"],
        services: {
            get: (serviceId: Services) => {
                if (serviceId === Services.FileSystem) {
                    return filesystem;
                }
                throw new Error(`Unexpected service lookup: ${serviceId}`);
            },
        },
    } as WorkspaceContext;

    return {
        ctx,
        write: (next: ProjectConfig) => {
            disk.bytes = encodeProjectConfig(next as never);
        },
    };
}

describe("ProjectService security configuration", () => {
    it("reads the effective policy from the manifest it loaded", async () => {
        const service = new ProjectService();
        const { ctx } = mount(config(true));

        await service.initialize(ctx, async () => undefined);

        expect(service.getSecurityConfiguration().encryptAssets).toBe(true);
    });

    it("picks up a manifest change made outside this window only on reload", async () => {
        const service = new ProjectService();
        const { ctx, write } = mount(config(true));
        await service.initialize(ctx, async () => undefined);

        write(config(false));

        // The cache is deliberately not a file watcher, so the stale read is
        // expected - it is why the build dialog reloads before describing the
        // package it is about to produce.
        expect(service.getSecurityConfiguration().encryptAssets).toBe(true);

        await service.reloadProjectConfig();

        expect(service.getSecurityConfiguration().encryptAssets).toBe(false);
    });
});

/**
 * A disk whose writes the test lets through one at a time, or refuses.
 *
 * A real write is a grant and a `PUT`, a few milliseconds each and not ordered between two callers,
 * which is exactly the window these tests hold open on purpose.
 */
function mountHeldDisk(initial: ProjectConfig) {
    const disk = { bytes: encodeProjectConfig(initial as never) };
    /** What each manifest write told the save-status surface about itself. */
    const reports: (FsWriteReport | undefined)[] = [];
    const held: { bytes: Uint8Array; settle: (ok: boolean, error?: Partial<FsRejectError>) => void }[] = [];
    let inFlight = 0;
    let mostInFlight = 0;
    let reads = 0;
    const filesystem = {
        list: async () => ({ ok: true, data: [{ name: "Demo", ext: ".nlproj", type: "file" }] }),
        readRaw: async () => {
            reads += 1;
            return { ok: true, data: disk.bytes };
        },
        writeRaw: (_path: string, bytes: Uint8Array, report?: FsWriteReport) => new Promise(resolve => {
            reports.push(report);
            inFlight += 1;
            mostInFlight = Math.max(mostInFlight, inFlight);
            held.push({
                bytes,
                settle: (ok, error) => {
                    inFlight -= 1;
                    if (ok) {
                        disk.bytes = bytes;
                        resolve({ ok: true, data: undefined });
                    } else {
                        resolve({ ok: false, error: error ?? { message: "disk full" } });
                    }
                },
            });
        }),
    };
    const ctx = {
        project: { getConfig: () => ({ projectPath: PROJECT_PATH }) } as unknown as WorkspaceContext["project"],
        services: {
            get: (serviceId: Services) => {
                if (serviceId === Services.FileSystem) {
                    return filesystem;
                }
                throw new Error(`Unexpected service lookup: ${serviceId}`);
            },
        },
    } as WorkspaceContext;

    /** Let the next queued write through (or refuse it), then give the queue a turn to move on. */
    async function release(ok = true, error?: Partial<FsRejectError>): Promise<void> {
        await flush();
        const next = held.shift();
        if (!next) {
            throw new Error("No write is waiting");
        }
        next.settle(ok, error);
        await flush();
    }

    return {
        ctx,
        reports,
        release,
        pending: () => held.length,
        mostInFlight: () => mostInFlight,
        reads: () => reads,
        onDisk: () => decodeProjectConfig(disk.bytes) as ProjectConfig,
    };
}

async function flush(): Promise<void> {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
}

describe("ProjectService manifest writes", () => {
    it("lands two changes asked for together, both of them", async () => {
        const service = new ProjectService();
        const disk = mountHeldDisk(config(false));
        await service.initialize(disk.ctx, async () => undefined);

        // Two sections of the project panel, one click each, the second before the first has landed.
        const window = service.updateWindowConfiguration({ resizable: false });
        const preferences = service.updatePlayerPreferences({ autoForward: true });

        await disk.release();
        await disk.release();
        await Promise.all([window, preferences]);

        expect(disk.onDisk().app?.window?.resizable).toBe(false);
        expect(disk.onDisk().app?.preferences?.autoForward).toBe(true);
        expect(service.getWindowConfiguration().resizable).toBe(false);
        expect(service.getPlayerPreferences().autoForward).toBe(true);
        expect(disk.mostInFlight()).toBe(1);
    });

    it("builds each change on the one before it, so the last one asked for is what stays", async () => {
        const service = new ProjectService();
        const disk = mountHeldDisk(config(false));
        await service.initialize(disk.ctx, async () => undefined);

        const results = [
            service.updateWindowConfiguration({ resizable: false }),
            service.updateWindowConfiguration({ startFullscreen: true }),
            service.updateWindowConfiguration({ resizable: true }),
        ];
        // Only one write is ever on its way; the next is not even built until it lands.
        await flush();
        expect(disk.pending()).toBe(1);

        await disk.release();
        await disk.release();
        await disk.release();
        const [first, second, third] = await Promise.all(results);

        expect(first.app?.window).toMatchObject({ resizable: false, startFullscreen: false });
        expect(second.app?.window).toMatchObject({ resizable: false, startFullscreen: true });
        expect(third.app?.window).toMatchObject({ resizable: true, startFullscreen: true });
        expect(disk.onDisk().app?.window).toMatchObject({ resizable: true, startFullscreen: true });
    });

    it("reports a refused write and carries on with the ones behind it, from what is on disk", async () => {
        const service = new ProjectService();
        const disk = mountHeldDisk(config(false));
        await service.initialize(disk.ctx, async () => undefined);

        const refused = service.updateWindowConfiguration({ startFullscreen: true });
        const after = service.updatePlayerPreferences({ skip: false });
        const refusal = refused.then(() => null, (error: Error) => error.message);

        await disk.release(false);
        await disk.release();

        expect(await refusal).toBe("Could not save the project file.");
        await after;
        // The refused change is on neither the disk nor the copy the panel reads back.
        expect(disk.onDisk().app?.window?.startFullscreen ?? false).toBe(false);
        expect(service.getWindowConfiguration().startFullscreen).toBe(false);
        expect(disk.onDisk().app?.preferences?.skip).toBe(false);
        expect(service.getPlayerPreferences().skip).toBe(false);
    });

    it("re-reads the manifest only after a write in flight has landed", async () => {
        const service = new ProjectService();
        const disk = mountHeldDisk(config(false));
        await service.initialize(disk.ctx, async () => undefined);
        const readsAtStart = disk.reads();

        const write = service.updateSecurityConfiguration({ encryptAssets: true });
        const reload = service.reloadProjectConfig();
        await flush();
        expect(disk.reads()).toBe(readsAtStart);

        await disk.release();
        await Promise.all([write, reload]);

        // A read that overtook the write would have put `false` back, for the next write to build on.
        expect(service.getSecurityConfiguration().encryptAssets).toBe(true);
    });
});

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe("ProjectService when the project file cannot be written", () => {
    it("hands the refusal back as the sentence an author reads, with what the disk said", async () => {
        const service = new ProjectService();
        const disk = mountHeldDisk(config(false));
        await service.initialize(disk.ctx, async () => undefined);

        const refused = service.updateWindowConfiguration({ resizable: false }).then(() => null, (error: unknown) => error);
        await disk.release(false, {
            code: FsRejectErrorCode.PERMISSION_DENIED,
            message: "EPERM: operation not permitted, rename 'D:/projects/demo/Demo.nlproj.nltmp' -> 'D:/projects/demo/Demo.nlproj'",
        });
        const error = await refused;

        expect(error).toBeInstanceOf(ProjectFileWriteError);
        expect((error as ProjectFileWriteError).message).toBe(
            "Could not save the project file. The file is read-only, or Studio is not allowed to write to it.",
        );
        // The system's own message is kept for the log, and only there.
        expect((error as ProjectFileWriteError).fsError.code).toBe(FsRejectErrorCode.PERMISSION_DENIED);
    });

    it("never repeats the transport's message, which named the one-use grant URL", async () => {
        const service = new ProjectService();
        const disk = mountHeldDisk(config(false));
        await service.initialize(disk.ctx, async () => undefined);

        const refused = service.updateWindowConfiguration({ resizable: false }).then(() => null, (error: Error) => error.message);
        await disk.release(false, {
            code: FsRejectErrorCode.IPC_ERROR,
            message: "Failed to write file to app://fs/3f2a9c: Internal Server Error",
        });

        expect(await refused).toBe("Could not save the project file.");
    });

    it("tells the save-status surface that a failed write of this file is its own to report", async () => {
        const service = new ProjectService();
        const disk = mountHeldDisk(config(false));
        await service.initialize(disk.ctx, async () => undefined);

        const refused = service.updateWindowConfiguration({ resizable: false }).catch(() => undefined);
        await disk.release(false, { code: FsRejectErrorCode.PERMISSION_DENIED, message: "EPERM" });
        await refused;

        // Nothing retries the manifest, so the notice's "still retrying" would be false: the
        // surface that changed the setting says it was not saved, and the notice only logs it.
        expect(disk.reports).toEqual([
            { name: { store: "workspace.shell.save.stores.project" }, afterFailure: "handledByWriter" },
        ]);
    });

    it.each(SUPPORTED_LOCALES)("says it without a URL or an id, and names the reason where there is one (%s)", locale => {
        const t = createTranslator(locale).t;
        const plain = describeProjectFileWriteFailure({ code: FsRejectErrorCode.IPC_ERROR }, t);
        const readOnly = describeProjectFileWriteFailure({ code: FsRejectErrorCode.PERMISSION_DENIED }, t);
        const full = describeProjectFileWriteFailure({ code: FsRejectErrorCode.NO_SPACE }, t);

        expect(plain).toBe(t("project.writeFailed.plain"));
        expect(readOnly).toContain(t("workspace.shell.save.reason.permissionDenied"));
        expect(full).toContain(t("workspace.shell.save.reason.diskFull"));
        for (const sentence of [plain, readOnly, full]) {
            expect(sentence).not.toMatch(/app:\/\//);
            expect(sentence).not.toMatch(UUID);
            expect(sentence).not.toMatch(/\{\w+\}/);
        }
    });
});
