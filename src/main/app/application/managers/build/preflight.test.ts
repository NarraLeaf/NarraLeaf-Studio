import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectConfigData } from "@shared/utils/nlproj";
import type {
    NormalizedPluginManifestV2,
    PluginSidecarContribution,
    PluginSidecarTargetContribution,
} from "@shared/types/plugins";
import {
    checkIcon,
    collectSidecarRequirements,
    readMobileOrientation,
    sidecarLosesExecBit,
} from "./preflight";

const config = (app: unknown): ProjectConfigData => ({ app, metadata: {} } as ProjectConfigData);

describe("readMobileOrientation", () => {
    it("reads each configured orientation", () => {
        for (const orientation of ["landscape", "portrait", "auto"] as const) {
            expect(readMobileOrientation(config({ mobile: { orientation } }))).toBe(orientation);
        }
    });

    it("defaults to landscape for projects saved before the setting existed", () => {
        // Every pre-existing project has no app.mobile at all; they must keep
        // building the way visual novels overwhelmingly play.
        expect(readMobileOrientation(config({}))).toBe("landscape");
        expect(readMobileOrientation(config(undefined))).toBe("landscape");
        expect(readMobileOrientation(null)).toBe("landscape");
    });

    it("falls back rather than pass an unknown value to the shell", () => {
        // The shell config is a contract; a hand-edited or newer-Studio value
        // must not reach it unchecked.
        expect(readMobileOrientation(config({ mobile: { orientation: "sideways" } }))).toBe("landscape");
        expect(readMobileOrientation(config({ mobile: { orientation: 42 } }))).toBe("landscape");
        expect(readMobileOrientation(config({ mobile: "portrait" }))).toBe("landscape");
    });
});

describe("sidecar preflight", () => {
    const target: PluginSidecarTargetContribution = {
        entry: "bin/tool",
        include: ["bin/tool"],
        sha256: { "bin/tool": "a".repeat(64) },
    };

    function manifestWith(
        pluginId: string,
        sidecars: Array<Partial<PluginSidecarContribution> & { id: string }>,
    ): NormalizedPluginManifestV2 {
        return {
            manifestVersion: 2,
            id: pluginId,
            name: pluginId,
            version: "1.0.0",
            entries: { runtime: "runtime.js" },
            contributes: {
                blueprintNodes: [],
                widgets: [],
                runtimeData: [],
                locales: [],
                runtimeCapabilities: [],
                buildDependencies: [],
                sidecars: sidecars.map(sidecar => ({
                    kind: "executable",
                    transport: "stdio-jsonl",
                    autostart: "onGameStart",
                    startupTimeoutMs: 5000,
                    shutdownTimeoutMs: 3000,
                    restart: { maxRetries: 3, backoffMs: 1000 },
                    targets: {},
                    ...sidecar,
                })),
            },
            permissions: [],
        };
    }

    it("reports a pair for every platform being built, target or not", () => {
        const manifest = manifestWith("acme.p", [{
            id: "acme.p.bridge",
            targets: { "windows-x64": target },
        }]);

        const requirements = collectSidecarRequirements([manifest], ["windows-x64", "linux-x64"]);

        // The missing pair is the whole point: a plugin with no Linux binary
        // still packages, and whatever it provided is simply gone there.
        expect(requirements).toEqual([
            { pluginId: "acme.p", sidecarId: "acme.p.bridge", kind: "executable", platformKey: "windows-x64", target },
            { pluginId: "acme.p", sidecarId: "acme.p.bridge", kind: "executable", platformKey: "linux-x64" },
        ]);
    });

    it("yields nothing for plugins that contribute no sidecar at all", () => {
        expect(collectSidecarRequirements([manifestWith("acme.p", [])], ["windows-x64"])).toEqual([]);
    });

    it("blocks an executable sidecar cross-built from Windows for macOS or Linux", () => {
        const requirements = collectSidecarRequirements(
            [manifestWith("acme.p", [{
                id: "acme.p.bridge",
                targets: { "macos-arm64": target, "linux-x64": target, "windows-x64": target },
            }])],
            ["macos-arm64", "linux-x64", "windows-x64"],
        );

        // NTFS has no executable bit, so the copy inside the dmg/AppImage would
        // not be runnable. Only the Windows target itself is unaffected.
        expect(requirements.filter(requirement => sidecarLosesExecBit(requirement, "windows"))
            .map(requirement => requirement.platformKey))
            .toEqual(["macos-arm64", "linux-x64"]);
        // A Unix host carries the mode through, so nothing is blocked there.
        expect(requirements.some(requirement => sidecarLosesExecBit(requirement, "macos"))).toBe(false);
        expect(requirements.some(requirement => sidecarLosesExecBit(requirement, "linux"))).toBe(false);
    });

    it("does not block a node sidecar, which needs no executable bit", () => {
        const [requirement] = collectSidecarRequirements(
            [manifestWith("acme.p", [{
                id: "acme.p.bridge",
                kind: "node",
                targets: { "macos-arm64": target },
            }])],
            ["macos-arm64"],
        );
        expect(sidecarLosesExecBit(requirement, "windows")).toBe(false);
    });

    it("does not block a platform the plugin ships nothing for", () => {
        // Nothing is copied, so nothing loses its mode; that pair is the
        // warning's business, not the error's.
        const [requirement] = collectSidecarRequirements(
            [manifestWith("acme.p", [{ id: "acme.p.bridge", targets: { "windows-x64": target } }])],
            ["macos-arm64"],
        );
        expect(sidecarLosesExecBit(requirement, "windows")).toBe(false);
    });
});

describe("checkIcon", () => {
    let projectPath: string;

    beforeEach(async () => {
        projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "nls-preflight-icon-"));
        await fs.mkdir(path.join(projectPath, "resources", "icons", "derived"), { recursive: true });
    });

    afterEach(async () => {
        await fs.rm(projectPath, { recursive: true, force: true });
    });

    /** A PNG header is all checkIcon reads, so that is all these files hold. */
    async function writePng(relativePath: string, width: number, height: number): Promise<void> {
        const bytes = Buffer.alloc(24);
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
        bytes.write("IHDR", 12, "ascii");
        bytes.writeUInt32BE(width, 16);
        bytes.writeUInt32BE(height, 20);
        await fs.writeFile(path.join(projectPath, relativePath), bytes);
    }

    const configWith = (icons: unknown) => ({ metadata: { icons } }) as never;

    it("reports no icon at all as missing", async () => {
        expect(await checkIcon(projectPath, configWith({}), "windows")).toEqual({ status: "missing" });
    });

    it("reports a configured icon that is not on disk as missing", async () => {
        const config = configWith({ version: 2, master: { path: "resources/icons/source/master.png" } });
        expect(await checkIcon(projectPath, config, "windows")).toEqual({ status: "missing" });
    });

    it("prefers the baked file over the raw source", async () => {
        await writePng("resources/icons/derived/windows.png", 1024, 1024);
        const check = await checkIcon(projectPath, configWith({
            version: 2,
            master: { path: "resources/icons/source/master.png" },
            baked: { windows: { path: "resources/icons/derived/windows.png", fingerprint: "abc" } },
        }), "windows");
        expect(check).toMatchObject({ status: "ok", baked: true, lowResolution: false });
    });

    it("falls back to the raw source and flags it as un-baked", async () => {
        await fs.mkdir(path.join(projectPath, "resources", "icons", "source"), { recursive: true });
        await writePng("resources/icons/source/master.png", 1024, 1024);
        const check = await checkIcon(projectPath, configWith({
            version: 2,
            master: { path: "resources/icons/source/master.png" },
        }), "windows");
        expect(check).toMatchObject({ status: "ok", baked: false });
    });

    it("ships a small icon and flags it, rather than swapping in a default", async () => {
        await writePng("resources/icons/derived/windows.png", 256, 256);
        const check = await checkIcon(projectPath, configWith({
            version: 2,
            master: { path: "resources/icons/source/master.png" },
            baked: { windows: { path: "resources/icons/derived/windows.png", fingerprint: "abc" } },
        }), "windows");
        expect(check).toMatchObject({ status: "ok", lowResolution: true });
    });

    it("reports a corrupt PNG as unusable", async () => {
        await fs.writeFile(path.join(projectPath, "resources/icons/derived/windows.png"), Buffer.from("not a png"));
        const check = await checkIcon(projectPath, configWith({
            version: 2,
            master: { path: "resources/icons/source/master.png" },
            baked: { windows: { path: "resources/icons/derived/windows.png", fingerprint: "abc" } },
        }), "windows");
        expect(check).toEqual({ status: "unusable" });
    });

    it("resolves a legacy five-slot project through its promoted master", async () => {
        await fs.mkdir(path.join(projectPath, "resources", "icons"), { recursive: true });
        await writePng("resources/icons/app-icon-windows.png", 1024, 1024);
        const config = configWith({ windows: { path: "resources/icons/app-icon-windows.png" } });
        expect(await checkIcon(projectPath, config, "windows")).toMatchObject({ status: "ok", baked: false });
        // Linux never had its own slot here; it now inherits the master.
        expect(await checkIcon(projectPath, config, "linux")).toMatchObject({ status: "ok" });
    });
});
