import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WINDOW_PROJECT_MISMATCH_CODE } from "@shared/types/window";
import { encodeProjectConfig } from "@shared/utils/nlproj";
import { forgetProjectStoreIdentifiers, requireWindowProjectStore } from "./windowProjectStore";

type Window = Parameters<typeof requireWindowProjectStore>[0];

let root: string;
/** The project the window has open. */
let mine: string;
/** A project it does not. */
let theirs: string;

function windowOn(projectPath?: string): Window {
    return { getProps: () => (projectPath === undefined ? {} : { projectPath }) } as unknown as Window;
}

async function writeConfig(projectPath: string, identifier: string): Promise<void> {
    await fs.writeFile(
        path.join(projectPath, "game.nlproj"),
        encodeProjectConfig({ name: "Game", identifier, metadata: {} }),
    );
}

async function makeProject(name: string, identifier: string | null): Promise<string> {
    const dir = path.join(root, name);
    await fs.mkdir(dir, { recursive: true });
    if (identifier !== null) {
        await writeConfig(dir, identifier);
    }
    return dir;
}

async function codeOf(pending: Promise<unknown>): Promise<string | undefined> {
    try {
        await pending;
    } catch (error) {
        return (error as { code?: string }).code ?? "(no code)";
    }
    return undefined;
}

beforeEach(async () => {
    forgetProjectStoreIdentifiers();
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-window-store-"));
    mine = await makeProject("mine", "game.mine");
    theirs = await makeProject("theirs", "game.theirs");
});

afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
});

describe("requireWindowProjectStore", () => {
    it("names the window's project by the identifier in its own configuration", async () => {
        await expect(requireWindowProjectStore(windowOn(mine), { projectPath: mine }))
            .resolves.toEqual({ projectPath: mine, projectIdentifier: "game.mine" });
    });

    /**
     * The hole this exists for. The stores hash the identifier in preference to the path, so a
     * request that reported its own path and another project's identifier reached the other
     * project's saves - and an assertion on the path alone would have waved it through.
     */
    it("ignores an identifier the request carries", async () => {
        const forged = { projectPath: mine, projectIdentifier: "game.theirs" };

        await expect(requireWindowProjectStore(windowOn(mine), forged))
            .resolves.toEqual({ projectPath: mine, projectIdentifier: "game.mine" });
    });

    it("refuses a project this window does not have open", async () => {
        expect(await codeOf(requireWindowProjectStore(windowOn(mine), { projectPath: theirs })))
            .toBe(WINDOW_PROJECT_MISMATCH_CODE);
    });

    it("refuses a window that has no project, and a request that names none", async () => {
        expect(await codeOf(requireWindowProjectStore(windowOn(), { projectPath: mine })))
            .toBe(WINDOW_PROJECT_MISMATCH_CODE);
        expect(await codeOf(requireWindowProjectStore(windowOn(mine), undefined)))
            .toBe(WINDOW_PROJECT_MISMATCH_CODE);
        expect(await codeOf(requireWindowProjectStore(windowOn(mine), { projectPath: 7 })))
            .toBe(WINDOW_PROJECT_MISMATCH_CODE);
    });

    /** Answered in the window's spelling, which is the string the stores hash when there is no id. */
    it("answers with the window's own spelling of its project", async () => {
        const ref = await requireWindowProjectStore(windowOn(mine), { projectPath: mine + path.sep });

        expect(ref.projectPath).toBe(mine);
    });

    it("keys a project with no identifier by its path, as before", async () => {
        const bare = await makeProject("bare", "   ");
        const unconfigured = await makeProject("unconfigured", null);

        await expect(requireWindowProjectStore(windowOn(bare), { projectPath: bare }))
            .resolves.toEqual({ projectPath: bare });
        await expect(requireWindowProjectStore(windowOn(unconfigured), { projectPath: unconfigured }))
            .resolves.toEqual({ projectPath: unconfigured });
    });

    /** A fresh read always wins, so an author who changes the identifier is on it by the next request. */
    it("follows a changed identifier on the next request", async () => {
        await requireWindowProjectStore(windowOn(mine), { projectPath: mine });
        await writeConfig(mine, "game.renamed");

        await expect(requireWindowProjectStore(windowOn(mine), { projectPath: mine }))
            .resolves.toEqual({ projectPath: mine, projectIdentifier: "game.renamed" });
    });

    /**
     * The configuration is rewritten while Dev Mode runs. A read that lands on a half-written file
     * must not fall back to the path - that would move the author's saves to another directory for
     * one request - so the identifier last read stands in.
     */
    it("keeps the last identifier through a configuration that cannot be read", async () => {
        await requireWindowProjectStore(windowOn(mine), { projectPath: mine });
        await fs.writeFile(path.join(mine, "game.nlproj"), Buffer.from([0xc1]));

        await expect(requireWindowProjectStore(windowOn(mine), { projectPath: mine }))
            .resolves.toEqual({ projectPath: mine, projectIdentifier: "game.mine" });

        await fs.rm(path.join(mine, "game.nlproj"));
        await expect(requireWindowProjectStore(windowOn(mine), { projectPath: mine }))
            .resolves.toEqual({ projectPath: mine, projectIdentifier: "game.mine" });
    });

    /** With nothing to stand in, an unreadable configuration is a failed request rather than a guess. */
    it("fails rather than guesses when the configuration was never read", async () => {
        await fs.writeFile(path.join(mine, "game.nlproj"), Buffer.from([0xc1]));

        const code = await codeOf(requireWindowProjectStore(windowOn(mine), { projectPath: mine }));

        expect(code).toBeDefined();
        expect(code).not.toBe(WINDOW_PROJECT_MISMATCH_CODE);
    });
});
