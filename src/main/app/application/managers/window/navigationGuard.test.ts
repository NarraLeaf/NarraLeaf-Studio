import path from "path";
import { pathToFileURL } from "url";
import { describe, expect, it } from "vitest";
import { AppHost, AppProtocol } from "@shared/types/constants";
import { WindowAppType } from "@shared/types/window";
import { decideWindowNavigation } from "./navigationGuard";

const workspaceEntry = path.resolve("/Applications/NarraLeaf Studio.app/Contents/Resources/app.asar/dist/windows/workspace/index.html");

describe("decideWindowNavigation", () => {
    it("allows a window to navigate to its own file entry", () => {
        expect(decideWindowNavigation({
            url: pathToFileURL(workspaceEntry).href,
            isMainFrame: true,
            windowType: WindowAppType.Workspace,
            appEntryPath: workspaceEntry,
        })).toEqual({ allowed: true });
    });

    it("allows a window to navigate to its own app://windows entry", () => {
        expect(decideWindowNavigation({
            url: `${AppProtocol}://${AppHost.Windows}/${WindowAppType.Workspace}/index.html`,
            isMainFrame: true,
            windowType: WindowAppType.Workspace,
            appEntryPath: workspaceEntry,
        })).toEqual({ allowed: true });
    });

    it("blocks cross-window app://windows main frame navigation", () => {
        expect(decideWindowNavigation({
            url: `${AppProtocol}://${AppHost.Windows}/${WindowAppType.Launcher}/index.html`,
            isMainFrame: true,
            windowType: WindowAppType.Workspace,
            appEntryPath: workspaceEntry,
        })).toEqual({
            allowed: false,
            reason: "Main frame navigation is restricted to the window application entry",
        });
    });

    it("blocks plugin protocol URLs as main frame navigation targets", () => {
        for (const url of [
            `${AppProtocol}://${AppHost.Plugins}/acme.sample-plugin/1.0.0/main.js`,
            `${AppProtocol}://${AppHost.PluginApi}/plugin.js`,
        ]) {
            expect(decideWindowNavigation({
                url,
                isMainFrame: true,
                windowType: WindowAppType.Workspace,
                appEntryPath: workspaceEntry,
            })).toEqual({
                allowed: false,
                reason: "Main frame navigation is restricted to the window application entry",
            });
        }
    });

    it("blocks app://fs as a main frame navigation target without changing resource access semantics", () => {
        expect(decideWindowNavigation({
            url: `${AppProtocol}://${AppHost.Fs}/allocated-file-hash`,
            isMainFrame: true,
            windowType: WindowAppType.Workspace,
            appEntryPath: workspaceEntry,
        })).toEqual({
            allowed: false,
            reason: "Main frame navigation is restricted to the window application entry",
        });
    });

    it("blocks arbitrary external documents", () => {
        for (const url of [
            "https://example.com/",
            "data:text/html,<script>window.__NLS_RENDERER_INTERFACE__</script>",
            "file:///tmp/attacker.html",
        ]) {
            expect(decideWindowNavigation({
                url,
                isMainFrame: true,
                windowType: WindowAppType.Workspace,
                appEntryPath: workspaceEntry,
            })).toEqual({
                allowed: false,
                reason: "Main frame navigation is restricted to the window application entry",
            });
        }
    });

    it("allows same-document navigation", () => {
        expect(decideWindowNavigation({
            url: `${AppProtocol}://${AppHost.Windows}/${WindowAppType.Workspace}/index.html#asset-browser`,
            currentUrl: `${AppProtocol}://${AppHost.Windows}/${WindowAppType.Workspace}/index.html`,
            isMainFrame: true,
            windowType: WindowAppType.Workspace,
            appEntryPath: workspaceEntry,
        })).toEqual({ allowed: true });
    });

    it("blocks subframe navigation except about:blank", () => {
        expect(decideWindowNavigation({
            url: "about:blank",
            isMainFrame: false,
            windowType: WindowAppType.Workspace,
            appEntryPath: workspaceEntry,
        })).toEqual({ allowed: true });

        expect(decideWindowNavigation({
            url: "https://example.com/",
            isMainFrame: false,
            windowType: WindowAppType.Workspace,
            appEntryPath: workspaceEntry,
        })).toEqual({
            allowed: false,
            reason: "Subframe navigation is not allowed",
        });
    });
});
