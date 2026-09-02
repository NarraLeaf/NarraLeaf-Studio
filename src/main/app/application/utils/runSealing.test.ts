/**
 * Whether a run seals its content, from the project's own setting and this machine's choice.
 *
 * Both hosts that launch a game outside a build - the preview and the headless test run - answer
 * this here, and the case that matters is the one the test run used not to have: a project with
 * asset protection on, on a machine that has not asked for the shipped form. It has to come out
 * loose, because a store is written whole and sealing it again on every launch is seconds paid per
 * run for an artifact nobody receives.
 *
 * A real `.nlproj` on disk rather than a stubbed reader: what is being checked includes reading the
 * flag out of the file the author's project actually holds.
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeProjectPath } from "@shared/utils/recentProject";
import { encodeProjectConfig, getProjectConfigFileName } from "@shared/utils/nlproj";
import { PREVIEW_AS_SHIPPED_SETTINGS_KEY } from "./previewAsShipped";
import { resolveRunSealing, runSealingLogLine } from "./runSealing";

const PROJECT_NAME = "Tiny Shadows";
const KEY = "the-pack-key";

let projectPath = "";
let keyCalls = 0;

/** A project directory whose config says whether its assets are protected. */
async function writeProject(encryptAssets: boolean | undefined): Promise<void> {
    const config = {
        name: PROJECT_NAME,
        app: encryptAssets === undefined ? {} : { security: { encryptAssets } },
    };
    await fs.writeFile(
        path.join(projectPath, getProjectConfigFileName(PROJECT_NAME)),
        encodeProjectConfig(config as never),
    );
}

function settings(previewAsShipped: boolean) {
    const stored = previewAsShipped ? { [normalizeProjectPath(projectPath)]: true } : {};
    return { get: (key: string) => (key === PREVIEW_AS_SHIPPED_SETTINGS_KEY ? stored : undefined) };
}

function sealing(previewAsShipped: boolean) {
    return resolveRunSealing({
        projectPath,
        settings: settings(previewAsShipped),
        resolveKey: async () => {
            keyCalls += 1;
            return KEY;
        },
    });
}

beforeEach(async () => {
    projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "nls-run-sealing-"));
    keyCalls = 0;
});

afterEach(async () => {
    await fs.rm(projectPath, { recursive: true, force: true });
});

describe("a project that protects its assets", () => {
    beforeEach(async () => {
        await writeProject(true);
    });

    it("runs loose files while this machine has not asked for the shipped form", async () => {
        const result = await sealing(false);

        expect(result).toEqual({ kind: "loose-by-choice" });
        // Not merely "no key in the result": deriving one reads and, on first use, writes the
        // machine secret and the project salt, which a run that is not sealing has no business
        // touching.
        expect(keyCalls).toBe(0);
        expect(runSealingLogLine(result)).toContain("Preview as shipped is off");
    });

    it("seals when this machine has asked for it, and says so", async () => {
        const result = await sealing(true);

        expect(result).toEqual({ kind: "sealed", key: KEY });
        expect(keyCalls).toBe(1);
        expect(runSealingLogLine(result)).toContain("encrypting pack");
    });
});

describe("a project that does not protect its assets", () => {
    it("has nothing to seal, whatever the machine asked for", async () => {
        await writeProject(false);

        for (const asShipped of [false, true]) {
            const result = await sealing(asShipped);
            expect(result).toEqual({ kind: "unprotected" });
        }
        expect(keyCalls).toBe(0);
        // No line: a project that never turned protection on has no second state to be in, and a
        // sentence about it on every launch would be noise.
        expect(runSealingLogLine({ kind: "unprotected" })).toBeNull();
    });

    it("is the answer for a config that says nothing about protection, and for no config at all", async () => {
        await writeProject(undefined);
        expect(await sealing(true)).toEqual({ kind: "unprotected" });

        await fs.rm(path.join(projectPath, getProjectConfigFileName(PROJECT_NAME)));
        expect(await sealing(true)).toEqual({ kind: "unprotected" });
    });
});
