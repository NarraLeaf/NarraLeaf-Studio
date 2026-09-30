import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Every place the main process can start a child process, and why each one is or is not governed by
 * project trust.
 *
 * A spawn is the sharpest primitive Studio has: it leaves the sandbox, it outlives the request, and
 * on this codebase a dozen files import `child_process` for themselves. There is no funnel, and
 * inventing one they all had to pass through would be wrong - some of them have nothing to do with
 * a project. `security find-identity` asks the machine
 * about its own signing certificates; `certutil` installs an authority the author chose. Neither
 * takes a project and neither becomes safe or unsafe because of one.
 *
 * So the rule this file enforces is narrower and true: **a spawn started on behalf of a project is
 * governed, and adding one is a decision somebody has to write down.** The list below is that
 * writing-down. A new file reaching for `child_process` fails here until it is classified, which is
 * the closest a test can get to "gate the primitive, not the feature" when the primitive has no
 * single door.
 */

const MAIN_ROOT = path.resolve(__dirname, "../../..");

type Classification = "gated" | "not-project-scoped";

/** file (posix, relative to src/main) -> why it may spawn. */
const SPAWN_SITES: Record<string, { kind: Classification; why: string }> = {
    "app/application/managers/media/mediaProbe.ts": {
        kind: "gated",
        why: "ffprobe, reached from the asset panel on mount; refused at MediaProbeHandler",
    },
    "app/application/managers/media/mediaTranscode.ts": {
        kind: "gated",
        why: "ffmpeg; refused at MediaConvertStartHandler",
    },
    "app/application/managers/weather/weatherBake.ts": {
        kind: "gated",
        why: "ffmpeg; refused in WeatherBakeManager.ensure, ahead of the claim",
    },
    "app/application/managers/preview/PreviewManager.ts": {
        kind: "gated",
        why: "the preview runtime; refused in launch",
    },
    "app/application/managers/gameTest/GameTestManager.ts": {
        kind: "gated",
        why: "the test runner; refused in launch",
    },
    "buildWorker/gpgSign.ts": {
        kind: "gated",
        why: "inside a build, and the whole build is refused in GameBuildManager.start",
    },
    "buildWorker/mobile/signIpa.ts": {
        kind: "gated",
        why: "zsign, inside a build; the build worker only ever runs behind GameBuildManager.start",
    },
    "buildWorker/packageWebSite.ts": {
        kind: "gated",
        why: "7za writing the web export, inside a build that was already refused if distrusted",
    },
    "buildWorker/winCodeSignCache.ts": {
        kind: "gated",
        why: "7za extracting the signing cache, inside a build; never reached without one",
    },
    "buildWorker/zigToolchain.ts": {
        kind: "gated",
        why: "7za extracting the C toolchain, inside a build; never reached without one",
    },
    "app/application/managers/window/handlers/externalScriptEditors.ts": {
        kind: "gated",
        why: "the author's editor, on this project's scripts folder; refused in ProjectOpenScriptHandler",
    },
    "app/application/managers/build/macSigningIdentity.ts": {
        kind: "not-project-scoped",
        why: "asks the machine which signing identities it holds; no project involved",
    },
    "app/application/managers/vcs/authorityTrust.ts": {
        kind: "not-project-scoped",
        why: "installs a certificate authority the author explicitly accepted, into the OS store",
    },
};

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full, out);
        } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
            out.push(full);
        }
    }
    return out;
}

function spawningFiles(): string[] {
    const found: string[] = [];
    for (const file of walk(MAIN_ROOT)) {
        const source = fs.readFileSync(file, "utf-8");
        if (/from ["']child_process["']|require\(["']child_process["']\)/.test(source)) {
            found.push(path.relative(MAIN_ROOT, file).replaceAll(path.sep, "/"));
        }
    }
    return found.sort();
}

describe("main-process spawn sites", () => {
    it("are exactly the ones classified here", () => {
        // Failing because a file was ADDED means: decide whether the new spawn is started on behalf
        // of a project. If it is, gate it and mark it `gated`; if it is not, say why in `why`.
        // Failing because a file was REMOVED means the entry below is stale - delete it.
        expect(spawningFiles()).toEqual(Object.keys(SPAWN_SITES).sort());
    });

    it("says why every one of them is allowed to", () => {
        for (const [file, entry] of Object.entries(SPAWN_SITES)) {
            expect(entry.why.length, `${file} has no reason recorded`).toBeGreaterThan(20);
        }
    });

    it("still has spawns that project trust governs", () => {
        // If this ever reaches zero, either every spawn moved behind something else - in which case
        // this file should follow it - or a refactor quietly took the gates off.
        const gated = Object.values(SPAWN_SITES).filter(entry => entry.kind === "gated");
        expect(gated.length).toBeGreaterThan(0);
    });
});
