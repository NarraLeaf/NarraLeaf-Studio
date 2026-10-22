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

    it("refuses a plugin path that steps up a directory, before any grant is consulted", async () => {
        // `granted/link/../x` resolves to `granted/x` for every check, while the system walks it
        // through the link and up from wherever the link points.
        const window = createWindow(WindowAppType.Launcher, {
            protectedPath: false,
            windowAllowed: true,
            pluginAllowed: true,
        });

        for (const escaping of ["/Users/test/granted/link/../x", "C:\\granted\\link\\..\\x"]) {
            await expect(authorizeActorFileSystemRequest(
                window,
                { kind: "plugin", pluginId: "studio.test.desktop-file" },
                escaping,
                "read",
            )).resolves.toMatchObject({ allowed: false });
        }
        expect(window.app.pluginPermissionManager.isPluginFileSystemAllowed).not.toHaveBeenCalled();
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
