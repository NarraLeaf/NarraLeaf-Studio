import { describe, expect, it } from "vitest";
import {
    buildEditorLaunch,
    detectExternalScriptEditors,
    isKnownExternalScriptEditor,
    openFolderInExternalEditor,
    pickRunnablePath,
} from "./externalScriptEditors";

/**
 * Handing the scripts folder to an editor.
 *
 * Two things are worth holding still. The list of editors is what the machine has rather than what
 * Studio hopes for - an offer that fails is worse than an absence. And on Windows the thing on PATH
 * is a `.cmd` shim, which `execFile` cannot start at all; getting that wrong looks like "the button
 * does nothing", which is exactly the failure this whole feature was replacing.
 */

describe("which editors this machine has", () => {
    it("offers only what the lookup found, in the order they are listed", async () => {
        const found = await detectExternalScriptEditors("win32", async command =>
            command === "code" || command === "subl" ? `C:/bin/${command}.cmd` : null,
        );
        expect(found.map(editor => editor.id)).toEqual(["code", "subl"]);
        expect(found[0]?.name).toBe("Visual Studio Code");
    });

    it("offers nothing when nothing is installed", async () => {
        expect(await detectExternalScriptEditors("darwin", async () => null)).toEqual([]);
    });

    it("knows its own ids and no others", () => {
        expect(isKnownExternalScriptEditor("cursor")).toBe(true);
        // What the renderer sends is an id from the list above; anything else is refused rather
        // than run, which is what keeps a command line out of the renderer's reach.
        expect(isKnownExternalScriptEditor("rm -rf")).toBe(false);
        expect(isKnownExternalScriptEditor("system")).toBe(false);
    });
});

describe("which of PATH's matches is the one to run", () => {
    it("takes the runnable one on Windows, not the first", () => {
        // The two lines a real VS Code install prints, in the order `where` prints them. The first
        // is the POSIX shell script, which Windows cannot start at all - taking it produced
        // `spawn … ENOENT` the first time this was run against a real install. Separators are
        // written forward here because only the extension decides.
        expect(
            pickRunnablePath(
                ["D:/Program/Microsoft VS Code/bin/code", "D:/Program/Microsoft VS Code/bin/code.cmd"],
                "win32",
            ),
        ).toBe("D:/Program/Microsoft VS Code/bin/code.cmd");
    });

    it("falls back to the first when no match carries a runnable extension", () => {
        expect(pickRunnablePath(["C:/tools/zed"], "win32")).toBe("C:/tools/zed");
    });

    it("takes the first elsewhere, where an extension means nothing", () => {
        expect(pickRunnablePath(["/usr/local/bin/cursor", "/usr/bin/cursor"], "darwin")).toBe(
            "/usr/local/bin/cursor",
        );
    });

    it("answers with nothing for an empty listing", () => {
        expect(pickRunnablePath(["", "  "], "win32")).toBeNull();
    });
});

describe("how it is started", () => {
    const base = { directory: "D:/game/scripts", file: "D:/game/scripts/title.ts", editorName: "Cursor" };

    it("runs a real executable with an argument array", () => {
        const launch = buildEditorLaunch({ ...base, resolved: "/usr/local/bin/cursor", platform: "darwin" });
        expect(launch).toEqual({
            file: "/usr/local/bin/cursor",
            // The folder first: a script resolves its types from the tsconfig in it, and an editor
            // opened on the file alone resolves none of them.
            args: ["D:/game/scripts", "D:/game/scripts/title.ts"],
            verbatim: false,
        });
    });

    it("runs a Windows shim through cmd, quoted as one command line", () => {
        const launch = buildEditorLaunch({
            ...base,
            resolved: "C:/Users/a b/AppData/cursor.cmd",
            platform: "win32",
        });
        expect(launch.verbatim).toBe(true);
        expect(launch.args[0]).toBe("/c");
        // Every part quoted, and the whole line quoted again - `cmd /c` strips the outer pair.
        expect(launch.args[1]).toBe(
            '""C:/Users/a b/AppData/cursor.cmd" "D:/game/scripts" "D:/game/scripts/title.ts""',
        );
    });

    it("opens the folder alone when no file is named", () => {
        const launch = buildEditorLaunch({
            directory: "D:/game/scripts",
            resolved: "/usr/bin/zed",
            platform: "linux",
            editorName: "Zed",
        });
        expect(launch.args).toEqual(["D:/game/scripts"]);
    });

    it("declines rather than opening the wrong thing when a path would be rewritten by cmd", () => {
        // `cmd` expands `%NAME%` even inside quotes, so this path cannot be passed through it
        // faithfully. Declining is the honest answer; the caller still has the file manager.
        expect(() =>
            buildEditorLaunch({
                directory: "D:/%TEMP%/scripts",
                resolved: "C:/bin/code.cmd",
                platform: "win32",
                editorName: "Visual Studio Code",
            }),
        ).toThrow(/%/);
    });

    it("refuses an id it does not know, without looking anything up", async () => {
        await expect(
            openFolderInExternalEditor({
                editorId: "not-an-editor",
                directory: "D:/game/scripts",
                platform: "linux",
                lookUp: async () => {
                    throw new Error("must not be reached");
                },
            }),
        ).rejects.toThrow(/Unknown editor/);
    });

    it("says which editor is missing when it is not on PATH", async () => {
        await expect(
            openFolderInExternalEditor({
                editorId: "webstorm",
                directory: "D:/game/scripts",
                platform: "linux",
                lookUp: async () => null,
            }),
        ).rejects.toThrow(/WebStorm/);
    });
});
