import path from "path";
import { describe, expect, it, vi } from "vitest";
import type { GameRuntimeLaunchEntry } from "@shared/types/gameRuntime";
import {
    deriveGameAppId,
    GameBuildManager,
    gameFusesForPlatform,
    isDesktopTarget,
    isMobileTarget,
    resolveElectronDistDirForApp,
} from "./GameBuildManager";

// The fail-fast tests below reach run()'s console emission before throwing;
// keep it away from the window plumbing.
vi.mock("../../utils/workspaceConsole", () => ({
    emitWorkspaceConsoleLog: () => undefined,
}));

describe("deriveGameAppId", () => {
    it("uses a reverse-domain identifier verbatim", () => {
        expect(deriveGameAppId("com.studio.my-game", "My Game")).toBe("com.studio.my-game");
    });

    it("falls back to a namespaced id for non-domain identifiers", () => {
        expect(deriveGameAppId("My Game!!", "My Game")).toBe("com.narraleaf.games.my-game");
    });

    it("derives from the project name when no identifier is given", () => {
        expect(deriveGameAppId(undefined, "Épica 冒険")).toBe("com.narraleaf.games.epica-mou-xian");
    });

    it("keeps a safe trailing segment for punctuation-only names", () => {
        expect(deriveGameAppId("***", "***")).toBe("com.narraleaf.games.project");
    });
});

describe("isDesktopTarget", () => {
    it("claims desktop platforms only - not web, not mobile", () => {
        // Type-predicate bodies are unchecked by TypeScript; this pins the
        // classification so a revert to `platform !== "web"` fails a test
        // instead of silently routing mobile targets into electron-builder.
        const formats = { formats: [] };
        expect(isDesktopTarget({ platform: "windows", ...formats })).toBe(true);
        expect(isDesktopTarget({ platform: "macos", ...formats })).toBe(true);
        expect(isDesktopTarget({ platform: "linux", ...formats })).toBe(true);
        expect(isDesktopTarget({ platform: "web", ...formats })).toBe(false);
        expect(isDesktopTarget({ platform: "android", ...formats })).toBe(false);
        expect(isDesktopTarget({ platform: "ios", ...formats })).toBe(false);
    });
});

describe("isMobileTarget", () => {
    it("claims mobile platforms only - not web, not desktop", () => {
        // Same reasoning as isDesktopTarget: a type-predicate body is unchecked,
        // and this one decides whether a target reaches the repack at all.
        const formats = { formats: [] };
        expect(isMobileTarget({ platform: "android", ...formats })).toBe(true);
        expect(isMobileTarget({ platform: "ios", ...formats })).toBe(true);
        expect(isMobileTarget({ platform: "web", ...formats })).toBe(false);
        expect(isMobileTarget({ platform: "windows", ...formats })).toBe(false);
        expect(isMobileTarget({ platform: "macos", ...formats })).toBe(false);
        expect(isMobileTarget({ platform: "linux", ...formats })).toBe(false);
    });
});

describe("GameBuildManager.start fail-fast guards", () => {
    const makeManager = () => new GameBuildManager({
        logger: { error: () => undefined },
    } as unknown as ConstructorParameters<typeof GameBuildManager>[0]);
    const entry = {} as GameRuntimeLaunchEntry;

    it("fails loudly for a platform outside the union", async () => {
        // Regression: with the explicit desktop/mobile/web partitions, an
        // unknown platform matches none of them - without this guard the
        // build would end "done" with zero artifacts.
        const manager = makeManager();
        const projectPath = path.join("/nonexistent", "unknown-platform-project");
        manager.start(projectPath, entry, {
            targets: [{ platform: "banana" as never, formats: ["zip"] }],
        });
        await vi.waitFor(() => {
            expect(manager.getStatus(projectPath).status).toBe("error");
        });
        expect(manager.getStatus(projectPath).error).toContain("banana");
    });
});

describe("gameFusesForPlatform", () => {
    it("hardens every platform against node/inspector abuse", () => {
        for (const platform of ["windows", "macos", "linux"] as const) {
            const fuses = gameFusesForPlatform(platform, false);
            expect(fuses.runAsNode).toBe(false);
            expect(fuses.enableNodeOptionsEnvironmentVariable).toBe(false);
            expect(fuses.enableNodeCliInspectArguments).toBe(false);
            expect(fuses.onlyLoadAppFromAsar).toBe(true);
            expect(fuses.grantFileProtocolExtraPrivileges).toBe(false);
        }
    });

    it("leaves cookie encryption off to avoid a first-launch keychain prompt", () => {
        for (const platform of ["windows", "macos", "linux"] as const) {
            expect(gameFusesForPlatform(platform, false).enableCookieEncryption).toBe(false);
        }
    });

    it("keeps asar integrity off on unsigned builds (downside-only footgun)", () => {
        for (const platform of ["windows", "macos", "linux"] as const) {
            expect(gameFusesForPlatform(platform, false).enableEmbeddedAsarIntegrityValidation).toBe(false);
        }
    });

    it("enables asar integrity once signing is configured, except on Linux", () => {
        expect(gameFusesForPlatform("windows", true).enableEmbeddedAsarIntegrityValidation).toBe(true);
        expect(gameFusesForPlatform("macos", true).enableEmbeddedAsarIntegrityValidation).toBe(true);
        expect(gameFusesForPlatform("linux", true).enableEmbeddedAsarIntegrityValidation).toBe(false);
    });

    it("only re-signs on macOS", () => {
        expect(gameFusesForPlatform("macos", false).resetAdHocDarwinSignature).toBe(true);
        expect(gameFusesForPlatform("windows", false).resetAdHocDarwinSignature).toBe(false);
        expect(gameFusesForPlatform("linux", false).resetAdHocDarwinSignature).toBe(false);
    });
});

describe("resolveElectronDistDirForApp", () => {
    it("uses the embedded preview runner when packaged", () => {
        const app = {
            isPackaged: () => true,
            resolveResource: (rel: string) => path.join("/resources", rel),
        };
        expect(resolveElectronDistDirForApp(app)).toBe(path.join("/resources", "preview-runner", "dist"));
    });

    it("walks up from the running darwin binary in development", () => {
        const app = { isPackaged: () => false, resolveResource: (rel: string) => rel };
        const original = process.platform;
        Object.defineProperty(process, "platform", { value: "darwin" });
        try {
            expect(resolveElectronDistDirForApp(app, "/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"))
                .toBe("/repo/node_modules/electron/dist");
        } finally {
            Object.defineProperty(process, "platform", { value: original });
        }
    });
});
