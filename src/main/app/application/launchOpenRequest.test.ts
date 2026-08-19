import { describe, expect, it } from "vitest";
import { LaunchOpenLookup, resolveFirstLaunchOpenRequest, resolveLaunchOpenRequest } from "./launchOpenRequest";

/**
 * A disk described as two lists. The real lookup reads `fs`; this one has to answer the same three
 * questions and nothing else, which is the whole reason the resolver takes it as an argument.
 */
function lookupFor(options: { files?: string[]; projectDirectories?: string[]; directories?: string[] }): LaunchOpenLookup {
    const files = new Set(options.files ?? []);
    const projectDirectories = new Set(options.projectDirectories ?? []);
    const directories = new Set([...(options.directories ?? []), ...projectDirectories]);
    return {
        resolveFile: candidate => (files.has(candidate) ? candidate : null),
        resolveDirectory: candidate => (directories.has(candidate) ? candidate : null),
        isProjectDirectory: directory => projectDirectories.has(directory),
        dirname: filePath => filePath.slice(0, filePath.lastIndexOf("/")),
        extname: filePath => {
            const dot = filePath.lastIndexOf(".");
            return dot > filePath.lastIndexOf("/") ? filePath.slice(dot) : "";
        },
    };
}

describe("resolveLaunchOpenRequest", () => {
    it("opens the folder a project config sits in, never the file", () => {
        const lookup = lookupFor({ files: ["/games/demo/Demo.nlproj"] });

        expect(resolveLaunchOpenRequest("/games/demo/Demo.nlproj", lookup)).toEqual({
            kind: "project",
            projectPath: "/games/demo",
        });
    });

    it("takes a package as a package rather than as a project", () => {
        const lookup = lookupFor({ files: ["/downloads/Demo.nlspkg"] });

        expect(resolveLaunchOpenRequest("/downloads/Demo.nlspkg", lookup)).toEqual({
            kind: "package",
            packagePath: "/downloads/Demo.nlspkg",
        });
    });

    it("opens a folder that holds a project config", () => {
        const lookup = lookupFor({ projectDirectories: ["/games/demo"] });

        expect(resolveLaunchOpenRequest("/games/demo", lookup)).toEqual({
            kind: "project",
            projectPath: "/games/demo",
        });
    });

    it("refuses a folder that holds no project", () => {
        // Rather than opening a window that can only say "this is not a project": the request came
        // from outside Studio, where a wrong folder is an ordinary mistake.
        const lookup = lookupFor({ directories: ["/games"] });

        expect(resolveLaunchOpenRequest("/games", lookup)).toBeNull();
    });

    it("ignores a file of any other kind", () => {
        const lookup = lookupFor({ files: ["/games/demo/notes.txt", "/app/dist/main/index.js"] });

        expect(resolveLaunchOpenRequest("/games/demo/notes.txt", lookup)).toBeNull();
        // The development entry point reaches this resolver on every dev launch.
        expect(resolveLaunchOpenRequest("/app/dist/main/index.js", lookup)).toBeNull();
    });

    it("ignores a path that is not there at all", () => {
        expect(resolveLaunchOpenRequest("/games/gone/Gone.nlproj", lookupFor({}))).toBeNull();
        expect(resolveLaunchOpenRequest("", lookupFor({}))).toBeNull();
    });

    it("matches the extension case-insensitively", () => {
        const lookup = lookupFor({ files: ["/games/demo/Demo.NLPROJ"] });

        expect(resolveLaunchOpenRequest("/games/demo/Demo.NLPROJ", lookup)).toEqual({
            kind: "project",
            projectPath: "/games/demo",
        });
    });
});

describe("resolveFirstLaunchOpenRequest", () => {
    it("skips everything it cannot open and takes the first thing it can", () => {
        const lookup = lookupFor({
            files: ["/app/dist/main/index.js", "/games/demo/Demo.nlproj"],
        });

        expect(resolveFirstLaunchOpenRequest(
            ["--dev", "/app/dist/main/index.js", "/games/demo/Demo.nlproj"],
            lookup,
        )).toEqual({ kind: "project", projectPath: "/games/demo" });
    });

    it("answers nothing when a launch named nothing openable", () => {
        expect(resolveFirstLaunchOpenRequest(["--dev", "--cdp"], lookupFor({}))).toBeNull();
        expect(resolveFirstLaunchOpenRequest([], lookupFor({}))).toBeNull();
    });

    it("takes one project even when several were passed", () => {
        // A launch is one gesture, and two projects is not something one window can be.
        const lookup = lookupFor({ projectDirectories: ["/games/a", "/games/b"] });

        expect(resolveFirstLaunchOpenRequest(["/games/a", "/games/b"], lookup)).toEqual({
            kind: "project",
            projectPath: "/games/a",
        });
    });
});
