import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APP_TAG_ID_RELEASE } from "@shared/types/appTag";
import { DLC_SCHEMA_VERSION } from "@shared/types/dlc";
import { normalizeProjectPath } from "@shared/utils/recentProject";
import { resolveRunDlc, RUN_DLC_OFF_SETTINGS_KEY } from "./runDlc";

/**
 * Which DLC a run of a project has installed, read from the machine's own settings.
 *
 * Two things are defended here. Every kind of absence answers null - "carry them all" - because the
 * other direction is a run that silently withholds content from an author who never asked it to. And
 * the setting stores what is OFF, so a DLC created after the choice was made arrives switched on
 * rather than missing.
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
    return { get: (key: string) => (key === RUN_DLC_OFF_SETTINGS_KEY ? value : undefined) };
}

function offFor(ids: string[]) {
    return settings({ [normalizeProjectPath(projectPath)]: ids });
}

describe("resolveRunDlc", () => {
    it("answers the ones left on", async () => {
        await writeDlc(["summer", "winter", "voices"]);
        expect(await resolveRunDlc(offFor(["winter"]), projectPath)).toEqual(["summer", "voices"]);
    });

    it("answers an empty list when every one is off, because that is a real run", async () => {
        await writeDlc(["summer", "winter"]);
        // "As a player who bought none" has to survive as an empty list rather than collapsing into
        // "carry everything", which is the opposite run.
        expect(await resolveRunDlc(offFor(["summer", "winter"]), projectPath)).toEqual([]);
    });

    it("carries a DLC created since the choice was made", async () => {
        await writeDlc(["summer", "winter", "autumn"]);
        // `autumn` is not in the stored off-set, so it is on. The other storage direction would have
        // it silently absent from a run nobody configured that way.
        expect(await resolveRunDlc(offFor(["winter"]), projectPath)).toEqual(["summer", "autumn"]);
    });

    it("carries everything for every kind of absence", async () => {
        await writeDlc(["summer"]);
        expect(await resolveRunDlc(settings(undefined), projectPath)).toBeNull();
        expect(await resolveRunDlc(settings("nonsense"), projectPath)).toBeNull();
        expect(await resolveRunDlc(settings({}), projectPath)).toBeNull();
        expect(await resolveRunDlc(offFor([]), projectPath)).toBeNull();
        // An id no DLC answers to - one that was deleted - leaves nothing switched off.
        expect(await resolveRunDlc(offFor(["gone"]), projectPath)).toBeNull();
    });

    it("carries everything when the DLC document cannot be read", async () => {
        await fs.writeFile(path.join(projectPath, "editor", "dlc.json"), "{ not json", "utf-8");
        expect(await resolveRunDlc(offFor(["summer"]), projectPath)).toBeNull();
    });

    it("buckets by a comparison key, so two spellings of one path are one project", async () => {
        await writeDlc(["summer", "winter"]);
        const other = projectPath.replace(/\\/g, "/");
        expect(await resolveRunDlc(offFor(["winter"]), other)).toEqual(["summer"]);
    });
});
