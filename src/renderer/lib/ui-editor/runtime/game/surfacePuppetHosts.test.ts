import { afterEach, describe, expect, it, vi } from "vitest";
import type { PuppetSize } from "narraleaf-react";
import { GAME_RUNTIME_BRIDGE_KEY } from "@shared/types/gameRuntime";
import type { GameRuntimePackV1, GameRuntimePreloadBridge } from "@shared/types/gameRuntime";
import type { PuppetBackendModuleSource } from "./puppetBackendHost";
import {
    __resetDevModePuppetHost,
    __resetPackagedPuppetHost,
    createPackagedPuppetHost,
    createPuppetHostOpener,
    getDevModePuppetHost,
    registerDevModePuppetHost,
    resolveSurfacePuppetOpener,
    type SurfacePuppetHost,
} from "./surfacePuppetHosts";
import { SurfacePuppetUnavailableError, type SurfacePuppetOpener } from "./surfacePuppetSession";

const SIZE: PuppetSize = { width: 320, height: 480 };

function fakeHost(kind: SurfacePuppetHost["kind"], sources: PuppetBackendModuleSource[] = []): SurfacePuppetHost {
    return {
        kind,
        listBackendModules: () => Promise.resolve(sources),
        resolveModelBundleUrl: assetId => Promise.resolve(`resolved://${assetId}`),
    };
}

function installBridge(pack: GameRuntimePackV1 | null): void {
    const bridge = {
        readPack: () => (pack ? Promise.resolve(pack) : Promise.reject(new Error("no pack"))),
        pluginEntryUrl: (relativePath: string) => `nlgame://runtime/${relativePath}`,
        assetUrl: (key: string) => `nlgame://asset/${key}`,
    } as unknown as GameRuntimePreloadBridge;
    (globalThis as unknown as Record<string, unknown>).window = { [GAME_RUNTIME_BRIDGE_KEY]: bridge };
}

afterEach(() => {
    __resetDevModePuppetHost();
    __resetPackagedPuppetHost();
    delete (globalThis as unknown as Record<string, unknown>).window;
});

describe("resolveSurfacePuppetOpener", () => {
    it("prefers workspace services over everything else", () => {
        // Not merely a preference: it is the only arm that also caches the model's description, so the
        // inspector's motion/skin dropdowns fill from the same mount instead of paying a second one.
        const workspace = vi.fn() as unknown as SurfacePuppetOpener;
        registerDevModePuppetHost(fakeHost("dev-mode"));
        installBridge(null);

        expect(resolveSurfacePuppetOpener(workspace)).toBe(workspace);
    });

    it("falls through to the Dev Mode registry when there are no services", async () => {
        const source: PuppetBackendModuleSource = {
            id: "renderer-a",
            url: "app://fs/grant-a",
            resolveFile: path => Promise.resolve(`app://fs/${path}`),
        };
        const listBackendModules = vi.fn(() => Promise.resolve([source]));
        registerDevModePuppetHost({ ...fakeHost("dev-mode"), listBackendModules });

        const opener = resolveSurfacePuppetOpener(null);
        expect(opener).not.toBeNull();
        // Reached through the registry rather than through a prop, because a widget renderer is mounted
        // deep inside a GameApp surface tree that knows nothing about the Dev Mode shell.
        await opener!({
            request: { assetId: "model-alice", backend: "renderer-a" },
            container: {} as HTMLDivElement,
            size: SIZE,
            onWarn: () => undefined,
        }).catch(() => undefined);
        expect(listBackendModules).toHaveBeenCalled();
    });

    it("falls through past a withdrawn Dev Mode registry to the packaged bridge", () => {
        const withdraw = registerDevModePuppetHost(fakeHost("dev-mode"));
        expect(getDevModePuppetHost()?.kind).toBe("dev-mode");
        // A project close must not leave the next project served by the previous one's grants.
        withdraw();
        expect(getDevModePuppetHost()).toBeNull();

        installBridge({ puppetRuntimes: [], assets: { items: {} } } as unknown as GameRuntimePackV1);
        expect(createPackagedPuppetHost()?.kind).toBe("packaged");
        expect(resolveSurfacePuppetOpener(null)).not.toBeNull();
    });

    it("answers null when no arm can look a runtime up at all", () => {
        // The workspace window with no project open, and every Surface before any arm arrives. The mount
        // machine turns this into a quiet `missing-backend`; see surfacePuppetSession.test.ts.
        expect(resolveSurfacePuppetOpener(null)).toBeNull();
    });
});

describe("createPuppetHostOpener", () => {
    it("reports a backend the host cannot see as missing-backend, never as an error", async () => {
        const opener = createPuppetHostOpener(fakeHost("dev-mode", []));

        await expect(opener({
            request: { assetId: "model-alice", backend: "renderer-a" },
            container: {} as HTMLDivElement,
            size: SIZE,
            onWarn: () => undefined,
        })).rejects.toMatchObject({
            name: "SurfacePuppetUnavailableError",
            reason: "backend-missing",
        });
    });

    it("reports a model the host cannot resolve as no-model", async () => {
        const host: SurfacePuppetHost = {
            ...fakeHost("dev-mode", [{
                id: "renderer-a",
                url: "app://fs/grant-a",
                resolveFile: () => Promise.reject(new Error("nope")),
            }]),
            resolveModelBundleUrl: () => Promise.resolve(null),
        };

        await expect(createPuppetHostOpener(host)({
            request: { assetId: "model-gone", backend: "renderer-a" },
            container: {} as HTMLDivElement,
            size: SIZE,
            onWarn: () => undefined,
        })).rejects.toBeInstanceOf(SurfacePuppetUnavailableError);
    });
});
