/**
 * A save's playtime rides one trailing optional parameter through four hops, and the type checker
 * cannot insist on a single one of them.
 *
 * `GameApp` reads the stopwatch and calls `saveStore.write(…, playtimeSeconds)`; each shell's store
 * takes it and hands it to its own transport; the transport gives it to the record builder. Every
 * hop is a trailing optional argument, and TypeScript accepts a function that declares fewer
 * parameters than the type it satisfies. A shell that forgot the argument would compile, lint and
 * pass the suite, and the only symptom is a save screen showing a blank time - on that shell only,
 * for players only, months later.
 *
 * That is the same failure `hostCapabilityForwarding` was written for, and it does not cover this:
 * its subject is bridge options named after `GameAppHost` fields, and playtime is neither.
 *
 * So this reads the files as text, like that test does, and checks the hops types cannot:
 *
 *  1. `GameApp` hands the reading to the store on the way into a save.
 *  2. All three shells accept it and pass it on.
 *  3. The playtime bridge options reach **every** options block `GameApp` builds, not just one.
 */

import fs from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";

const HERE = path.resolve(__dirname);
const APP_FILE = path.join(HERE, "GameApp.tsx");
const REPO_SRC = path.resolve(HERE, "../../../../..");

/**
 * Every shell that stores a real save. The workspace story preview is absent for the reason it is
 * absent from `hostCapabilityForwarding`: it keeps no stopwatch and stores no save, and says so.
 */
const SAVE_SHELLS: Readonly<Record<string, string>> = {
    "Dev Mode": path.join(REPO_SRC, "renderer/apps/dev-mode/components/DevModeContent.tsx"),
    "packaged runtime": path.join(REPO_SRC, "runtime/renderer/GameRuntimeApp.tsx"),
    "web export": path.join(REPO_SRC, "runtime/web/web.ts"),
};

/** The transports each shell's store hands off to, and the record builder at the end of them. */
const SAVE_TRANSPORTS: Readonly<Record<string, string>> = {
    "Dev Mode preload": path.join(REPO_SRC, "main/preload/ipc/interface.ts"),
    "packaged runtime preload": path.join(REPO_SRC, "runtime/preload/preload.ts"),
    "packaged runtime main": path.join(REPO_SRC, "runtime/main/main.ts"),
    "packaged runtime storage": path.join(REPO_SRC, "runtime/main/runtimeStorage.ts"),
    "web storage": path.join(REPO_SRC, "runtime/web/webStorage.ts"),
    "Dev Mode save handler": path.join(
        REPO_SRC,
        "main/app/application/managers/window/handlers/devModeSaveAction.ts",
    ),
};

function occurrences(source: string, needle: string): number {
    return source.split(needle).length - 1;
}

/**
 * The slice of a shell's save store from `write:` to the `read:` after it.
 *
 * Counting the whole file would pass on a shell that merely mentions the word somewhere else; the
 * claim being made is specifically that the *write* path carries it.
 */
function writeMemberOf(source: string): string {
    const start = source.indexOf("write:");
    expect(start, "no save store write member found").toBeGreaterThan(-1);
    const end = source.indexOf("read:", start);
    return source.slice(start, end > start ? end : start + 2000);
}

describe("save playtime forwarding", () => {
    it("hands the stopwatch reading to the store when a save is written", async () => {
        const source = await fs.readFile(APP_FILE, "utf-8");
        // The reading, taken at the moment of the write rather than from a value captured earlier:
        // a save records the time it was taken, not the time the callback was built.
        expect(
            occurrences(source, "playtime.getRunSeconds()"),
            "GameApp does not write the run's playtime into the save",
        ).toBeGreaterThan(0);
        expect(
            occurrences(source, "playtime.seedRun("),
            "GameApp must seed the run on a new game and on a load that was applied",
        ).toBe(2);
    });

    it("has every shell accepting the reading and passing it on", async () => {
        const missing: string[] = [];
        for (const [shell, file] of Object.entries(SAVE_SHELLS)) {
            const member = writeMemberOf(await fs.readFile(file, "utf-8"));
            // Twice: once taken as a parameter, once handed to whatever this shell writes through.
            // Taking it and dropping it is the exact failure this test exists for.
            if (occurrences(member, "playtimeSeconds") < 2) {
                missing.push(`${shell} does not carry playtimeSeconds through its save write`);
            }
        }
        expect(missing, missing.join("\n")).toEqual([]);
    });

    it("has every transport between a shell and its store carrying it", async () => {
        const missing: string[] = [];
        for (const [name, file] of Object.entries(SAVE_TRANSPORTS)) {
            const source = await fs.readFile(file, "utf-8");
            if (occurrences(source, "playtimeSeconds") < 2) {
                missing.push(`${name} does not carry playtimeSeconds`);
            }
        }
        expect(missing, missing.join("\n")).toEqual([]);
    });

    it("hands the playtime readers to every bridge GameApp builds", async () => {
        const source = await fs.readFile(APP_FILE, "utf-8");
        // Counted from a capability certainly present in all of them, the way
        // `hostCapabilityForwarding` counts. A reader wired into one block and not the other is
        // broken for whichever surfaces got the other, which is indistinguishable from working
        // until an author puts the node on the wrong kind of surface.
        const blocks = occurrences(source, "onNetworkFetch: host.networkFetch");
        expect(blocks, "no bridge options block found in GameApp").toBeGreaterThan(0);

        const wrong = ["onGetPlaytime:", "onGetTotalPlaytime:", "onGetSavePlaytime:"]
            .map(option => ({ option, found: occurrences(source, option) }))
            .filter(entry => entry.found !== blocks)
            .map(entry => `${entry.option} forwarded ${entry.found}x, expected ${blocks}x`);
        expect(wrong, `GameApp does not hand these to every bridge it builds:\n${wrong.join("\n")}`)
            .toEqual([]);
    });

    it("has the Game UI slot shell forwarding them too", async () => {
        // A title screen is built out of Game UI slots, and the slot shell builds its own host API.
        // A family missing here is dead exactly where a save screen lives, while working one
        // surface above - the defect the sound transport and progress families both shipped with.
        const source = await fs.readFile(path.join(HERE, "StageSlotSurfaceShell.tsx"), "utf-8");
        for (const option of ["onGetPlaytime:", "onGetTotalPlaytime:", "onGetSavePlaytime:"]) {
            expect(
                occurrences(source, option),
                `the Game UI slot shell does not forward ${option}`,
            ).toBe(1);
        }
    });
});
