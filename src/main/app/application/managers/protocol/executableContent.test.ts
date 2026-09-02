import { describe, expect, it } from "vitest";
import { INERT_CONTENT_TYPE, isExecutableContentType } from "./executableContent";
import { createProjectCodePolicy } from "./projectCodePolicy";

describe("executable content types", () => {
    it.each([
        "application/javascript",
        "text/javascript",
        "text/javascript; charset=utf-8",
        "application/x-javascript",
        "application/ecmascript",
        "text/jscript",
        "application/wasm",
        "text/html",
        "text/html; charset=utf-8",
        "application/xhtml+xml",
    ])("treats %s as something a page would run", contentType => {
        expect(isExecutableContentType(contentType)).toBe(true);
    });

    it.each([
        "image/png",
        "image/svg+xml",
        "audio/ogg",
        "video/webm",
        "font/woff2",
        "application/json",
        "text/plain",
        "application/octet-stream",
        "application/node",
        "text/css",
    ])("leaves %s as something a page only displays or parses", contentType => {
        expect(isExecutableContentType(contentType)).toBe(false);
    });

    it("serves a refused file as text a page cannot run", () => {
        expect(isExecutableContentType(INERT_CONTENT_TYPE)).toBe(false);
    });
});

/**
 * The chain from a grant's owner to the ledger, and the fact that every broken link answers no.
 */
describe("project code policy", () => {
    function policy(options: { windows: Record<number, { projectPath?: string }>; trusted: string[] }) {
        return createProjectCodePolicy({
            windowManager: {
                getWindowByWebContentsId: (id: number) => {
                    const props = options.windows[id];
                    return props ? { getProps: () => props } : undefined;
                },
            },
            projectTrustManager: {
                isTrusted: (projectPath: string) => options.trusted.includes(projectPath),
            },
        } as never);
    }

    it("lets a window on a trusted project run its code", () => {
        const decide = policy({ windows: { 1: { projectPath: "D:/games/mine" } }, trusted: ["D:/games/mine"] });
        expect(decide.mayRunProjectCode(1)).toBe(true);
    });

    it("refuses a window on a distrusted project", () => {
        const decide = policy({ windows: { 1: { projectPath: "D:/games/theirs" } }, trusted: [] });
        expect(decide.mayRunProjectCode(1)).toBe(false);
    });

    it("refuses a grant nobody owns", () => {
        // A grant with no window is a grant with no project to ask about. Not "allowed because
        // nothing forbids it": code nobody vouched for is not run on that account.
        const decide = policy({ windows: {}, trusted: ["D:/games/mine"] });
        expect(decide.mayRunProjectCode(undefined)).toBe(false);
    });

    it("refuses a grant whose window is gone", () => {
        const decide = policy({ windows: {}, trusted: ["D:/games/mine"] });
        expect(decide.mayRunProjectCode(1)).toBe(false);
    });

    it("refuses a window that has no project", () => {
        // The launcher and the settings window declare no file system access, so nothing they
        // fetch through a grant is code they were meant to run.
        const decide = policy({ windows: { 1: {} }, trusted: [] });
        expect(decide.mayRunProjectCode(1)).toBe(false);
    });
});
