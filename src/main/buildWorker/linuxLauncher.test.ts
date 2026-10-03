import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SANDBOX_PROBE, type SandboxProbePlan } from "@shared/utils/runtimeStartupArguments";
import { installLinuxLauncher, LINUX_PROGRAM_SUFFIX, renderLinuxLauncher } from "./linuxLauncher";

/**
 * The script every Linux game package starts through.
 *
 * What matters about it is behaviour on a player's machine, so where a POSIX shell is available the
 * script is run for real, against a stand-in program that prints the arguments it was given and a
 * probe plan that points at stand-in test programs and kernel settings in a scratch directory. The
 * plan is the only thing replaced: the script under test is the one a package carries.
 */

const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);

let scratch: string;

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "nl-linux-launcher-"));
});

afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
});

describe("renderLinuxLauncher", () => {
    it("is a POSIX shell script with nothing but LF line ends", () => {
        const script = renderLinuxLauncher("demo");
        expect(script.startsWith("#!/bin/sh\n")).toBe(true);
        expect(script).not.toContain("\r");
    });

    it("runs the renamed binary beside itself", () => {
        expect(renderLinuxLauncher("demo")).toContain(`program="$here"/'demo${LINUX_PROGRAM_SUFFIX}'`);
    });

    it("quotes the executable's name so nothing in it is expanded", () => {
        // A game's name reaches the executable with `$`, backticks and quotes intact.
        expect(renderLinuxLauncher("it's $HOME`id`")).toContain(`program="$here"/'it'\\''s $HOME\`id\`.bin'`);
    });

    it("asks every question the game's own probe asks, of the same files", () => {
        const script = renderLinuxLauncher("demo");
        expect(script).toContain(`'${SANDBOX_PROBE.helper}'`);
        for (const program of SANDBOX_PROBE.programs) {
            expect(script).toContain(`'${program}'`);
        }
        for (const { file, value } of SANDBOX_PROBE.restrictions) {
            expect(script).toContain(`"$(cat '${file}' 2>/dev/null)" = '${value}' ] && return 1`);
        }
    });

    it("adds the switch in front of everything else, so it is never read as a file name", () => {
        expect(renderLinuxLauncher("demo").trimEnd().split("\n").at(-1)).toBe(`exec "$program" '--no-sandbox' "$@"`);
    });
});

describe("installLinuxLauncher", () => {
    it("moves the binary aside and takes its name", async () => {
        fs.writeFileSync(path.join(scratch, "demo"), ELF);
        await installLinuxLauncher(scratch, "demo");
        expect(fs.readFileSync(path.join(scratch, `demo${LINUX_PROGRAM_SUFFIX}`))).toEqual(ELF);
        expect(fs.readFileSync(path.join(scratch, "demo"), "utf-8")).toBe(renderLinuxLauncher("demo"));
        if (process.platform !== "win32") {
            expect(fs.statSync(path.join(scratch, "demo")).mode & 0o777).toBe(0o755);
        }
    });

    it("refuses to wrap anything that is not the Electron binary, a second pass included", async () => {
        fs.writeFileSync(path.join(scratch, "demo"), ELF);
        await installLinuxLauncher(scratch, "demo");
        await expect(installLinuxLauncher(scratch, "demo")).rejects.toThrow(/not the Electron binary/);
        expect(fs.readFileSync(path.join(scratch, `demo${LINUX_PROGRAM_SUFFIX}`))).toEqual(ELF);
    });

    it("refuses a name that is not a file name", async () => {
        for (const name of ["", ".", "..", "a/b"]) {
            await expect(installLinuxLauncher(scratch, name)).rejects.toThrow(/Not a file name/);
        }
    });
});

/** Whether a POSIX shell can be started from here (Git's, on Windows). */
const shell = spawnSync("sh", ["-c", "exit 0"]).status === 0;

/** A path the shell reads the same way on every platform. */
const shellPath = (file: string) => file.replace(/\\/g, "/");

function writeScript(file: string, body: string): void {
    fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
    fs.chmodSync(file, 0o755);
}

/**
 * A packed app directory with the launcher installed in front of a program that prints its
 * arguments one per line, and a plan whose test programs and kernel settings live in `scratch`.
 */
async function launcherWith(machine: { unshareExit?: number; restriction?: string; helper?: boolean }) {
    const appDir = path.join(scratch, "app");
    fs.mkdirSync(appDir);
    fs.writeFileSync(path.join(appDir, "demo"), ELF);
    const unshare = path.join(scratch, "unshare");
    if (machine.unshareExit !== undefined) {
        writeScript(unshare, `exit ${machine.unshareExit}`);
    }
    const setting = path.join(scratch, "restricted");
    if (machine.restriction !== undefined) {
        fs.writeFileSync(setting, `${machine.restriction}\n`);
    }
    if (machine.helper) {
        // Present, but the player's own file without the setuid bit - what an archive leaves.
        writeScript(path.join(appDir, SANDBOX_PROBE.helper), "exit 0");
    }
    const plan: SandboxProbePlan = {
        helper: SANDBOX_PROBE.helper,
        programs: [shellPath(path.join(scratch, "missing-unshare")), shellPath(unshare)],
        programArguments: SANDBOX_PROBE.programArguments,
        restrictions: [{ file: shellPath(setting), value: "1" }],
    };
    await installLinuxLauncher(appDir, "demo", plan);
    // The stand-in for Electron, written over the moved binary once the ELF check has passed.
    writeScript(path.join(appDir, `demo${LINUX_PROGRAM_SUFFIX}`), `for a in "$@"; do printf '%s\\n' "$a"; done`);
    return (args: string[]) => {
        const result = spawnSync("sh", [shellPath(path.join(appDir, "demo")), ...args], { encoding: "utf-8" });
        expect(result.stderr).toBe("");
        expect(result.status).toBe(0);
        return result.stdout.split("\n").slice(0, -1);
    };
}

describe.skipIf(!shell)("the launcher, run", () => {
    it("starts the game as it was asked where a user namespace can be made", async () => {
        const run = await launcherWith({ unshareExit: 0 });
        expect(run([])).toEqual([]);
        expect(run(["--disable-gpu", "two words", "it's \"quoted\" $HOME"])).toEqual(["--disable-gpu", "two words", "it's \"quoted\" $HOME"]);
    });

    it("adds the switch first where one cannot", async () => {
        const run = await launcherWith({ unshareExit: 1 });
        expect(run([])).toEqual(["--no-sandbox"]);
        expect(run(["--lang=ja", "--"])).toEqual(["--no-sandbox", "--lang=ja", "--"]);
    });

    it("does not count a helper that is not set up as root's setuid program", async () => {
        const run = await launcherWith({ unshareExit: 1, helper: true });
        expect(run([])).toEqual(["--no-sandbox"]);
    });

    it("passes a switch that is already there straight through, as from an AppImage's own launcher", async () => {
        const run = await launcherWith({ unshareExit: 1 });
        expect(run(["--no-sandbox", "--lang=ja"])).toEqual(["--no-sandbox", "--lang=ja"]);
    });

    it("falls back on the kernel settings when no test program is there", async () => {
        expect((await launcherWith({ restriction: "1" }))([])).toEqual(["--no-sandbox"]);
    });

    it("assumes a sandbox when nothing says otherwise", async () => {
        expect((await launcherWith({ restriction: "0" }))([])).toEqual([]);
    });
});

describe.skipIf(!shell || process.platform === "win32")("the launcher, started through a link", () => {
    it("still finds the program beside the file the link points at", async () => {
        const run = await launcherWith({ unshareExit: 0 });
        expect(run(["x"])).toEqual(["x"]);
        const link = path.join(scratch, "linked-demo");
        fs.symlinkSync(path.join(scratch, "app", "demo"), link);
        const result = spawnSync("sh", [link, "y"], { encoding: "utf-8" });
        expect(result.stdout).toBe("y\n");
    });
});
