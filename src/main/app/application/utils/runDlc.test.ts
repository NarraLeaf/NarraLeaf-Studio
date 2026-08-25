import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APP_TAG_ID_RELEASE } from "@shared/types/appTag";
import { DLC_SCHEMA_VERSION } from "@shared/types/dlc";
import { normalizeProjectPath } from "@shared/utils/recentProject";
import { resolveRunDlc, RUN_DLC_ON_SETTINGS_KEY } from "./runDlc";

/**
 * Which DLC a run of a project has installed, read from the machine's own settings.
 *
 * The default is none, and that is the whole shape of this: a run is the game a player bought until
 * the author ticks an extra. So every kind of absence answers the empty list rather than the whole
 * project, and the answer is always a list - never "say nothing", which the assembly would read as
 * "every DLC there is".
 */

let projectPath: string;

beforeEach(async () => {
    projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "nls-run-dlc-"));
    await fs.mkdir(path.join(projectPath, "editor"), { recursive: true });
});

afterEach(async () => {
    await fs.rm(projectPath, { recursive: true, force: true });
});

async function writeDlc(ids: string[]): Promise<void> {
    await fs.writeFile(
        path.join(projectPath, "editor", "dlc.json"),
        JSON.stringify({
            schemaVersion: DLC_SCHEMA_VERSION,
            dlcs: ids.map(id => ({ id, name: id, attachTo: APP_TAG_ID_RELEASE })),
        }),
        "utf-8",
    );
}

function settings(value: unknown) {
    return { get: (key: string) => (key === RUN_DLC_ON_SETTINGS_KEY ? value : undefined) };
}

function onFor(ids: string[]) {
    return settings({ [normalizeProjectPath(projectPath)]: ids });
}

describe("resolveRunDlc", () => {
    it("answers the ones ticked", async () => {
        await writeDlc(["summer", "winter", "voices"]);
        expect(await resolveRunDlc(onFor(["summer", "voices"]), projectPath)).toEqual(["summer", "voices"]);
    });

    it("answers none for every kind of absence", async () => {
        await writeDlc(["summer"]);
        // A run with nothing ticked is the game a player buys, which is the state an author ships -
        // and the only one where a forgotten guard shows itself.
        expect(await resolveRunDlc(settings(undefined), projectPath)).toEqual([]);
        expect(await resolveRunDlc(settings("nonsense"), projectPath)).toEqual([]);
        expect(await resolveRunDlc(settings({}), projectPath)).toEqual([]);
        expect(await resolveRunDlc(onFor([]), projectPath)).toEqual([]);
    });

    it("leaves a DLC created since the choice was made switched off", async () => {
        await writeDlc(["summer", "autumn"]);
        // The cost of this direction, and it is the harmless one: off is the default anyway, so
        // nothing is withheld that the author was not already running without.
        expect(await resolveRunDlc(onFor(["summer"]), projectPath)).toEqual(["summer"]);
    });

    it("drops an id the project no longer has", async () => {
        await writeDlc(["summer"]);
        // Intersected with what exists, so a deleted DLC leaves nothing for the assembly to look for.
        expect(await resolveRunDlc(onFor(["summer", "gone"]), projectPath)).toEqual(["summer"]);
    });

    it("answers none when the DLC document cannot be read", async () => {
        await fs.writeFile(path.join(projectPath, "editor", "dlc.json"), "{ not json", "utf-8");
        expect(await resolveRunDlc(onFor(["summer"]), projectPath)).toEqual([]);
    });

    it("buckets by a comparison key, so two spellings of one path are one project", async () => {
        await writeDlc(["summer", "winter"]);
        const other = projectPath.replace(/\\/g, "/");
        expect(await resolveRunDlc(onFor(["winter"]), other)).toEqual(["winter"]);
    });
});
