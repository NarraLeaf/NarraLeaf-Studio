import { describe, expect, it, vi } from "vitest";
import { WindowAppType } from "@shared/types/window";
import { authorizeActorFileSystemRequest } from "./actorAuthorization";
import type { AppWindow } from "./appWindow";

describe("authorizeActorFileSystemRequest", () => {
    it("allows Launcher plugin actors to use plugin filesystem grants as their path policy", async () => {
        const window = createWindow(WindowAppType.Launcher, {
            protectedPath: false,
            windowAllowed: false,
            pluginAllowed: true,
        });

        await expect(authorizeActorFileSystemRequest(
            window,
            { kind: "plugin", pluginId: "studio.test.desktop-file" },
            "/Users/test/Desktop/narraleaf-plugin-permission-test.txt",
            "write",
        )).resolves.toEqual({ allowed: true });
    });

    it("keeps non-Launcher plugin actors bound to the window filesystem policy", async () => {
        const window = createWindow(WindowAppType.Settings, {
            protectedPath: false,
            windowAllowed: false,
            pluginAllowed: true,
        });

        await expect(authorizeActorFileSystemRequest(
            window,
            { kind: "plugin", pluginId: "studio.test.desktop-file" },
            "/Users/test/Desktop/narraleaf-plugin-permission-test.txt",
            "write",
        )).resolves.toEqual({
            allowed: false,
            reason: "Window file system policy denied access",
        });
    });

    it("denies protected storage paths before checking plugin grants", async () => {
        const window = createWindow(WindowAppType.Launcher, {
            protectedPath: true,
            windowAllowed: true,
            pluginAllowed: true,
        });

        await expect(authorizeActorFileSystemRequest(
            window,
            { kind: "plugin", pluginId: "studio.test.desktop-file" },
            "/Users/test/Library/Application Support/NarraLeaf/authorization/plugin-permissions.config",
            "read",
        )).resolves.toEqual({
            allowed: false,
            reason: "Protected application storage cannot be accessed",
        });
    });
});

function createWindow(
    type: WindowAppType,
    options: {
        protectedPath: boolean;
        windowAllowed: boolean;
        pluginAllowed: boolean;
    },
): AppWindow {
    return {
        getWindowType: () => type,
        getProps: () => ({}),
        app: {
            storageManager: {
                isPathProtected: vi.fn().mockResolvedValue(options.protectedPath),
                isPathAllowed: vi.fn().mockResolvedValue(options.windowAllowed),
            },
            pluginPermissionManager: {
                isPluginFileSystemAllowed: vi.fn().mockReturnValue(options.pluginAllowed),
            },
        },
    } as unknown as AppWindow;
}
