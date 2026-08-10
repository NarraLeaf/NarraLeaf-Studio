import { describe, expect, it } from "vitest";
import { WindowAppType } from "@shared/types/window";
import { decideDetachedWindowOpen, detachedWindowFrameName } from "./detachedWindowGuard";

describe("decideDetachedWindowOpen", () => {
    const request = (over: Partial<Parameters<typeof decideDetachedWindowOpen>[0]> = {}) => ({
        url: "about:blank",
        frameName: detachedWindowFrameName("blueprint-entry:bp-1"),
        windowType: WindowAppType.Workspace,
        ...over,
    });

    it("allows a blank popup named as a detached editor from the workspace", () => {
        const decision = decideDetachedWindowOpen(request());
        expect(decision).toEqual({ allowed: true, key: "blueprint-entry:bp-1" });
    });

    it("allows the empty url Electron reports for window.open(\"\")", () => {
        expect(decideDetachedWindowOpen(request({ url: "" })).allowed).toBe(true);
    });

    it("denies a popup that loads anything, however local", () => {
        // A popup with a document of its own is a second renderer on the same project - the
        // double-write the detached-editor design exists to avoid.
        for (const url of [
            "app://windows/workspace/index.html",
            "https://narraleaf.com",
            "file:///etc/passwd",
        ]) {
            expect(decideDetachedWindowOpen(request({ url })).allowed).toBe(false);
        }
    });

    it("denies a frame name that does not declare the intent", () => {
        expect(decideDetachedWindowOpen(request({ frameName: "" })).allowed).toBe(false);
        expect(decideDetachedWindowOpen(request({ frameName: "popup" })).allowed).toBe(false);
        expect(decideDetachedWindowOpen(request({ frameName: "nls-detached:" })).allowed).toBe(false);
    });

    it("denies every window type that does not detach editors", () => {
        for (const windowType of [
            WindowAppType.Launcher,
            WindowAppType.Settings,
            WindowAppType.DevMode,
            WindowAppType.ProjectWizard,
            WindowAppType.PluginPermissionPrompt,
            WindowAppType.Raw,
        ]) {
            expect(decideDetachedWindowOpen(request({ windowType })).allowed).toBe(false);
        }
    });
});
