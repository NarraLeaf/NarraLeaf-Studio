// @vitest-environment jsdom
import { Blob as NodeBlob } from "node:buffer";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProjectIconSet, normalizeProjectIconSet, PROJECT_ICON_OUTPUTS, projectIconFingerprint, resolveIconFile } from "@shared/types/projectIcons";
import { FsRejectErrorCode } from "@shared/types/os";
import { fnv1a64BytesHex } from "@shared/utils/contentHash";
import { decodeProjectConfig, encodeProjectConfig } from "@shared/utils/nlproj";
import { join } from "@shared/utils/path";
import type { ProjectConfig } from "@/lib/workspace/project/project";
import { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { ProjectIconsSection } from "./ProjectIconsSection";

const ROOT = "/projects/demo";
const CONFIG = `${ROOT}/Demo.nlproj`;
const OLD_SOURCE = "resources/icons/source/master.png";
const OLD_BYTES = new Uint8Array([1, 2, 3]);
const NEW_BYTES = new Uint8Array([9, 8, 7]);
const PICKER = vi.hoisted(() => ({ path: "/picked/new.png", failDecode: false }));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({}),
    getPrivilegedInterface: () => ({ fs: {
        selectFile: async () => ({ success: true, data: { ok: true, data: [PICKER.path] } }),
    } }),
}));
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: translate }),
}));
vi.mock("@/apps/workspace/components/ui/freezeGuard", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useFreezeGuard: () => ({ frozen: false, writes: () => ({ disabled: false }) }),
    isDeferredWriteAllowed: () => true,
}));

type Failure = "source" | "bake" | "manifest" | "refused-manifest" | null;

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

function translate(key: string): string { return key; }

async function mount(options: { sharedOverride?: boolean } = {}) {
    const set = createProjectIconSet();
    set.master = { path: OLD_SOURCE, sourceName: "old.png", mediaType: "image/png", updatedAt: "" };
    if (options.sharedOverride) set.specs.windows.override = set.master;
    const files = new Map<string, Uint8Array>([
        [join(ROOT, OLD_SOURCE), OLD_BYTES],
        ["/picked/new.png", NEW_BYTES],
        ["/picked/new.svg", NEW_BYTES],
    ]);
    for (const output of PROJECT_ICON_OUTPUTS) {
        const path = `resources/icons/derived/${output.fileName}`;
        set.baked[output.id] = {
            path,
            fingerprint: projectIconFingerprint({ sourceHash: fnv1a64BytesHex(OLD_BYTES), spec: set.specs[output.target], output }),
        };
        files.set(join(ROOT, path), new Uint8Array([3, output.size % 256]));
    }
    files.set(CONFIG, encodeProjectConfig({ name: "Demo", identifier: "demo", metadata: { icons: set } } as never));
    let failure: Failure = null;
    let bakeWrites = 0;
    let faults = 0;
    const iconWrites: string[] = [];
    let held: { kind: "bake" | "manifest" | "cleanup"; started: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | null = null;
    const filesystem = {
        list: async () => ({ ok: true, data: [{ name: "Demo", ext: ".nlproj", type: "file" }] }),
        readRaw: async (path: string) => files.has(path)
            ? { ok: true, data: files.get(path)! }
            : { ok: false, error: { code: FsRejectErrorCode.NOT_FOUND, message: "missing" } },
        createDir: async () => ({ ok: true, data: undefined }),
        isFileExists: async (path: string) => ({ ok: true, data: files.has(path) }),
        deleteFile: async (path: string) => {
            if (held?.kind === "cleanup" && path === join(ROOT, OLD_SOURCE)) {
                const current = held;
                held = null;
                current.started.resolve();
                await current.release.promise;
            }
            files.delete(path);
            return { ok: true, data: undefined };
        },
        writeRaw: async (path: string, bytes: Uint8Array) => {
            if (path.includes("/icons/derived/")) bakeWrites += 1;
            if (path.includes("/icons/")) iconWrites.push(path);
            if (held && ((held.kind === "bake" && path.includes("/icons/derived/"))
                || (held.kind === "manifest" && path === CONFIG))) {
                const current = held;
                held = null;
                current.started.resolve();
                await current.release.promise;
            }
            if (failure === "refused-manifest" && path === CONFIG) {
                faults += 1;
                return { ok: true, data: undefined, refused: true };
            }
            if ((failure === "source" && path.includes("/icons/source/"))
                || (failure === "bake" && path.includes("/icons/derived/") && bakeWrites === 2)
                || (failure === "manifest" && path === CONFIG)) {
                faults += 1;
                return { ok: false, error: { code: FsRejectErrorCode.NO_SPACE, message: "disk full" } };
            }
            files.set(path, bytes);
            return { ok: true, data: undefined };
        },
    };
    const ctx = {
        project: {
            getConfig: () => ({ projectPath: ROOT }),
            resolve: (path: string | readonly string[]) => join(ROOT, ...(Array.isArray(path) ? path : [path])),
        },
        services: { get: (id: Services) => {
            if (id !== Services.FileSystem) throw new Error(`Unexpected service: ${id}`);
            return filesystem;
        } },
    } as unknown as WorkspaceContext;
    const service = new ProjectService();
    await service.initialize(ctx, async () => undefined);
    const configChanged = vi.fn();
    const notify = vi.fn();
    const uiService = { showNotification: notify } as never;
    const open = () => render(<ProjectIconsSection projectService={service} uiService={uiService}
        config={service.getProjectConfig() as ProjectConfig} onConfigChange={configChanged} />);
    const view = open();
    await waitFor(() => expect(configChanged).toHaveBeenCalled());
    return {
        files, service, notify, configChanged, view, open, iconWrites,
        fail: (next: Failure) => { failure = next; bakeWrites = 0; },
        faults: () => faults,
        hold: (kind: "bake" | "manifest" | "cleanup") => {
            const gate = { kind, started: deferred(), release: deferred() };
            held = gate;
            return gate;
        },
        iconFiles: () => new Map([...files].filter(([path]) => path.startsWith(`${ROOT}/resources/icons/`))),
        onDisk: () => decodeProjectConfig(files.get(CONFIG)!) as ProjectConfig,
    };
}

function anotherProject() {
    const root = "/projects/other";
    const config = encodeProjectConfig({ name: "Other", identifier: "other", metadata: {} } as never);
    const filesystem = {
        list: vi.fn(async () => ({ ok: true, data: [{ name: "Other", ext: ".nlproj", type: "file" }] })),
        readRaw: vi.fn(async () => ({ ok: true, data: config })),
        writeRaw: vi.fn(async () => ({ ok: true, data: undefined })),
    };
    const ctx = {
        project: {
            getConfig: () => ({ projectPath: root }),
            resolve: (path: string | readonly string[]) => join(root, ...(Array.isArray(path) ? path : [path])),
        },
        services: { get: (id: Services) => {
            if (id !== Services.FileSystem) throw new Error(`Unexpected service: ${id}`);
            return filesystem;
        } },
    } as unknown as WorkspaceContext;
    return { ctx, filesystem };
}

beforeEach(() => {
    PICKER.path = "/picked/new.png";
    PICKER.failDecode = false;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("Blob", NodeBlob);
    vi.stubGlobal("URL", class extends URL {
        static createObjectURL = vi.fn(() => "blob:icon");
        static revokeObjectURL = vi.fn();
    });
    vi.stubGlobal("Image", class {
        naturalWidth = 64;
        naturalHeight = 64;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
            queueMicrotask(() => PICKER.failDecode ? this.onerror?.() : this.onload?.());
        }
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
        const canvas = this;
        return {
            fillRect: () => undefined,
            drawImage: () => undefined,
            getImageData: () => ({ data: new Uint8ClampedArray(canvas.width * canvas.height * 4), width: canvas.width, height: canvas.height }),
        } as unknown as CanvasRenderingContext2D;
    } as unknown as typeof HTMLCanvasElement.prototype.getContext);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => {
        callback(new NodeBlob([new Uint8Array([7, 7, 7])], { type: "image/png" }) as unknown as Blob);
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("ProjectIconsSection import transaction", () => {
    it("keeps the old files when the imported source cannot be written", async () => {
        const harness = await mount();
        const oldFiles = harness.iconFiles();
        harness.fail("source");
        fireEvent.click(screen.getByRole("button", { name: "project.assets.master" }));
        await waitFor(() => expect(harness.notify).toHaveBeenCalledTimes(1));
        expect(harness.faults()).toBe(1);
        expect(harness.iconFiles()).toEqual(oldFiles);
        expect(harness.onDisk().metadata?.icons?.master?.path).toBe(OLD_SOURCE);
    });

    it("keeps the old source and outputs when a later bake write fails", async () => {
        PICKER.path = "/picked/new.svg";
        const harness = await mount();
        const oldFiles = harness.iconFiles();
        const oldOutput = harness.files.get(`${ROOT}/resources/icons/derived/macos.png`);
        const revoked = vi.mocked(URL.revokeObjectURL).mock.calls.length;
        harness.fail("bake");

        fireEvent.click(screen.getByRole("button", { name: "project.assets.master" }));
        await waitFor(() => expect(harness.notify).toHaveBeenCalled());

        expect(harness.faults()).toBe(1);
        expect(harness.files.get(join(ROOT, OLD_SOURCE))).toEqual(OLD_BYTES);
        expect(harness.files.get(`${ROOT}/resources/icons/derived/macos.png`)).toEqual(oldOutput);
        expect(harness.onDisk().metadata?.icons?.master?.path).toBe(OLD_SOURCE);
        expect(harness.iconFiles()).toEqual(oldFiles);
        expect(harness.notify).toHaveBeenCalledTimes(1);
        expect(vi.mocked(URL.revokeObjectURL).mock.calls.length).toBeGreaterThan(revoked);
    });

    it("keeps the old source and outputs when the manifest write fails", async () => {
        const harness = await mount();
        const oldFiles = harness.iconFiles();
        const oldOutput = harness.files.get(`${ROOT}/resources/icons/derived/macos.png`);
        harness.fail("manifest");

        fireEvent.click(screen.getByRole("button", { name: "project.assets.master" }));
        await waitFor(() => expect(harness.notify).toHaveBeenCalled());

        expect(harness.faults()).toBe(1);
        expect(harness.files.get(join(ROOT, OLD_SOURCE))).toEqual(OLD_BYTES);
        expect(harness.files.get(`${ROOT}/resources/icons/derived/macos.png`)).toEqual(oldOutput);
        expect(harness.onDisk().metadata?.icons?.master?.path).toBe(OLD_SOURCE);
        expect(harness.iconFiles()).toEqual(oldFiles);
        expect(harness.notify).toHaveBeenCalledTimes(1);
    });

    it("commits the new source and outputs, removes the old files, and reopens without rebaking", async () => {
        PICKER.path = "/picked/new.svg";
        const harness = await mount();
        fireEvent.click(screen.getByRole("button", { name: "project.assets.master" }));
        await waitFor(() => expect(harness.configChanged).toHaveBeenCalledTimes(2));

        const saved = normalizeProjectIconSet(harness.onDisk().metadata?.icons);
        expect(saved.master?.sourceName).toBe("new.svg");
        expect(harness.files.get(join(ROOT, saved.master!.path))).toEqual(NEW_BYTES);
        expect(harness.files.has(join(ROOT, OLD_SOURCE))).toBe(false);
        for (const output of PROJECT_ICON_OUTPUTS) {
            const path = saved.baked[output.id]!.path;
            expect(harness.files.has(join(ROOT, path))).toBe(true);
            expect(harness.files.has(`${ROOT}/resources/icons/derived/${output.fileName}`)).toBe(false);
            expect(resolveIconFile(saved, output.id)?.path).toBe(path);
        }
        expect(harness.iconFiles().size).toBe(1 + PROJECT_ICON_OUTPUTS.length);
        expect(harness.notify).not.toHaveBeenCalled();

        const writes = harness.iconWrites.length;
        harness.view.unmount();
        harness.open();
        await waitFor(() => expect(harness.configChanged).toHaveBeenCalledTimes(3));
        expect(harness.iconWrites).toHaveLength(writes);
    });

    it("retains the old icon when the manifest write is refused", async () => {
        const harness = await mount();
        const oldFiles = harness.iconFiles();
        harness.fail("refused-manifest");

        fireEvent.click(screen.getByRole("button", { name: "project.assets.master" }));
        await waitFor(() => expect(harness.faults()).toBe(1));
        await waitFor(() => expect(harness.iconFiles()).toEqual(oldFiles));
        expect(harness.onDisk().metadata?.icons?.master?.path).toBe(OLD_SOURCE);
        expect(harness.service.getProjectIconSet().master?.path).toBe(OLD_SOURCE);
        expect(harness.notify).not.toHaveBeenCalled();
    });

    it("keeps the old icon when the imported source cannot be decoded", async () => {
        const harness = await mount();
        const oldFiles = harness.iconFiles();
        PICKER.failDecode = true;

        fireEvent.click(screen.getByRole("button", { name: "project.assets.master" }));
        await waitFor(() => expect(harness.notify).toHaveBeenCalledTimes(1));
        expect(harness.iconFiles()).toEqual(oldFiles);
        expect(harness.onDisk().metadata?.icons?.master?.path).toBe(OLD_SOURCE);
    });

    it("preserves an old source and output still used by another target", async () => {
        const harness = await mount({ sharedOverride: true });
        fireEvent.click(screen.getByRole("button", { name: "project.assets.master" }));
        await waitFor(() => expect(harness.configChanged).toHaveBeenCalledTimes(2));

        const saved = normalizeProjectIconSet(harness.onDisk().metadata?.icons);
        expect(saved.master?.path).not.toBe(OLD_SOURCE);
        expect(saved.specs.windows.override?.path).toBe(OLD_SOURCE);
        expect(harness.files.get(join(ROOT, OLD_SOURCE))).toEqual(OLD_BYTES);
        expect(saved.baked.windows?.path).toBe("resources/icons/derived/windows.png");
        expect(harness.files.has(`${ROOT}/resources/icons/derived/windows.png`)).toBe(true);
    });

    it("keeps committed icon files when a configuration observer throws", async () => {
        const harness = await mount();
        const stop = harness.service.onConfigChanged(() => { throw new Error("observer failed"); });
        fireEvent.click(screen.getByRole("button", { name: "project.assets.master" }));
        await waitFor(() => expect(harness.configChanged).toHaveBeenCalledTimes(2));
        stop();

        const saved = normalizeProjectIconSet(harness.onDisk().metadata?.icons);
        expect(harness.files.get(join(ROOT, saved.master!.path))).toEqual(NEW_BYTES);
        for (const output of PROJECT_ICON_OUTPUTS) {
            expect(harness.files.has(join(ROOT, saved.baked[output.id]!.path))).toBe(true);
        }
        expect(harness.notify).not.toHaveBeenCalled();
    });

    it("cleans the first project's staged files when the project changes during a bake", async () => {
        const harness = await mount();
        const oldFiles = harness.iconFiles();
        const other = anotherProject();
        const gate = harness.hold("bake");
        fireEvent.click(screen.getByRole("button", { name: "project.assets.master" }));
        await gate.started.promise;
        await harness.service.initialize(other.ctx, async () => undefined);
        gate.release.resolve();

        await waitFor(() => expect(harness.notify).toHaveBeenCalledTimes(1));
        expect(harness.iconFiles()).toEqual(oldFiles);
        expect(harness.onDisk().metadata?.icons?.master?.path).toBe(OLD_SOURCE);
        expect(harness.service.getProjectConfig().name).toBe("Other");
        expect(other.filesystem.writeRaw).not.toHaveBeenCalled();
        expect(harness.configChanged).toHaveBeenCalledTimes(1);
    });

    it("preserves an icon change committed while the import is baking", async () => {
        const harness = await mount();
        const oldFiles = harness.iconFiles();
        const gate = harness.hold("bake");
        fireEvent.click(screen.getByRole("button", { name: "project.assets.master" }));
        await gate.started.promise;
        await harness.service.updateProjectIconSet(current => ({
            ...current,
            specs: { ...current.specs, windows: { ...current.specs.windows, inset: 0.2 } },
        }));
        gate.release.resolve();

        await waitFor(() => expect(harness.notify).toHaveBeenCalledTimes(1));
        expect(harness.iconFiles()).toEqual(oldFiles);
        const saved = normalizeProjectIconSet(harness.onDisk().metadata?.icons);
        expect(saved.master?.path).toBe(OLD_SOURCE);
        expect(saved.specs.windows.inset).toBe(0.2);
    });

    it("finishes the old project's committed import while the next project opens", async () => {
        const harness = await mount();
        const other = anotherProject();
        const gate = harness.hold("manifest");
        fireEvent.click(screen.getByRole("button", { name: "project.assets.master" }));
        await gate.started.promise;
        const switching = harness.service.initialize(other.ctx, async () => undefined);
        expect(other.filesystem.list).not.toHaveBeenCalled();
        gate.release.resolve();
        await act(async () => { await switching; });

        await waitFor(() => expect(harness.files.has(join(ROOT, OLD_SOURCE))).toBe(false));
        const saved = normalizeProjectIconSet(harness.onDisk().metadata?.icons);
        expect(harness.files.get(join(ROOT, saved.master!.path))).toEqual(NEW_BYTES);
        expect(harness.service.getProjectConfig().name).toBe("Other");
        expect(other.filesystem.writeRaw).not.toHaveBeenCalled();
        expect(harness.configChanged).toHaveBeenCalledTimes(1);
        expect(harness.notify).not.toHaveBeenCalled();
    });

    it("preserves the old project when its manifest fails during a project switch", async () => {
        const harness = await mount();
        const oldFiles = harness.iconFiles();
        const other = anotherProject();
        harness.fail("manifest");
        const gate = harness.hold("manifest");
        fireEvent.click(screen.getByRole("button", { name: "project.assets.master" }));
        await gate.started.promise;
        const switching = harness.service.initialize(other.ctx, async () => undefined);
        gate.release.resolve();
        await act(async () => { await switching; });

        await waitFor(() => expect(harness.notify).toHaveBeenCalledTimes(1));
        expect(harness.iconFiles()).toEqual(oldFiles);
        expect(harness.onDisk().metadata?.icons?.master?.path).toBe(OLD_SOURCE);
        expect(harness.service.getProjectConfig().name).toBe("Other");
        expect(other.filesystem.writeRaw).not.toHaveBeenCalled();
    });

    it("does not publish a previous project's preview after switching during cleanup", async () => {
        const harness = await mount();
        const other = anotherProject();
        const gate = harness.hold("cleanup");
        fireEvent.click(screen.getByRole("button", { name: "project.assets.master" }));
        await gate.started.promise;
        await harness.service.initialize(other.ctx, async () => undefined);
        gate.release.resolve();

        await waitFor(() => expect(harness.files.has(join(ROOT, OLD_SOURCE))).toBe(false));
        await act(async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); });
        expect(harness.service.getProjectConfig().name).toBe("Other");
        expect(other.filesystem.writeRaw).not.toHaveBeenCalled();
        expect(harness.configChanged).toHaveBeenCalledTimes(1);
        expect(harness.notify).not.toHaveBeenCalled();
    });
});
