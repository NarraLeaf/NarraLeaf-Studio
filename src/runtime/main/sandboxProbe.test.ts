import path from "path";
import { describe, expect, it } from "vitest";
import { SANDBOX_PROBE } from "@shared/utils/runtimeStartupArguments";
import { nodeSandboxProbeHost, probeLinuxSandbox, type SandboxProbeHost } from "./sandboxProbe";

/**
 * How a shipped game decides whether this Linux machine can sandbox.
 *
 * The probe is what stands between a launch asking to go without the sandbox and that request being
 * granted, so every way it can say "cannot" is pinned here, and so is the order: a usable helper
 * decides before any program is run, a program that ran decides before any kernel setting is read,
 * and a machine about which nothing says "cannot" is one that can.
 */

const [UNSHARE, SECOND_UNSHARE] = SANDBOX_PROBE.programs;
const HELPER = `/opt/game/${SANDBOX_PROBE.helper}`;
const restriction = (index: number) => SANDBOX_PROBE.restrictions[index];

type FakeMachine = {
    helper?: { uid: number; mode: number; executable?: boolean };
    /** What running each program does; a program not listed is missing. */
    programs?: Record<string, { exitCode: number | null } | { failed: string }>;
    files?: Record<string, string>;
};

function fakeHost(machine: FakeMachine) {
    const ran: string[] = [];
    const read: string[] = [];
    const host: SandboxProbeHost = {
        executable: () => "/opt/game/demo.bin",
        stat: file => (file === HELPER && machine.helper ? { uid: machine.helper.uid, mode: machine.helper.mode } : null),
        canExecute: file => file === HELPER && machine.helper?.executable !== false,
        run: (file, args) => {
            ran.push([file, ...args].join(" "));
            return machine.programs?.[file] ?? { failed: "ENOENT" };
        },
        readText: file => {
            read.push(file);
            return machine.files?.[file] ?? null;
        },
    };
    return { host, ran, read };
}

/** A regular file's mode bits, as `stat` reports them. */
const regular = (permissions: number) => 0o100000 | permissions;

describe("the setuid helper", () => {
    it("is enough on its own when it is set up the way Chromium checks it", () => {
        const machine = fakeHost({ helper: { uid: 0, mode: regular(0o4755) } });
        expect(probeLinuxSandbox(machine.host).capable).toBe(true);
        expect(machine.ran).toEqual([]);
    });

    it("is looked for beside the real binary", () => {
        const machine = fakeHost({ helper: { uid: 0, mode: regular(0o4755) } });
        expect(probeLinuxSandbox(machine.host).reason).toContain(HELPER);
    });

    it("does not count when anything Chromium checks is missing", () => {
        const unusable = [
            { uid: 1000, mode: regular(0o4755) }, // what a zip or a folder leaves: the player's own file
            { uid: 0, mode: regular(0o755) }, // root's, but not setuid
            { uid: 0, mode: regular(0o4750) }, // not executable by everyone
            { uid: 0, mode: regular(0o4755), executable: false }, // not executable by this user
        ];
        for (const helper of unusable) {
            const machine = fakeHost({ helper, programs: { [UNSHARE]: { exitCode: 1 } } });
            expect(probeLinuxSandbox(machine.host).capable).toBe(false);
            expect(machine.ran).toHaveLength(1);
        }
    });
});

describe("the user-namespace test", () => {
    it("decides by its exit status", () => {
        expect(probeLinuxSandbox(fakeHost({ programs: { [UNSHARE]: { exitCode: 0 } } }).host).capable).toBe(true);
        expect(probeLinuxSandbox(fakeHost({ programs: { [UNSHARE]: { exitCode: 1 } } }).host).capable).toBe(false);
        // Killed by a signal is not a success either.
        expect(probeLinuxSandbox(fakeHost({ programs: { [UNSHARE]: { exitCode: null } } }).host).capable).toBe(false);
    });

    it("runs with the plan's arguments, from the plan's places, in order", () => {
        const machine = fakeHost({ programs: { [SECOND_UNSHARE]: { exitCode: 1 } } });
        const result = probeLinuxSandbox(machine.host);
        expect(machine.ran).toEqual([
            [UNSHARE, ...SANDBOX_PROBE.programArguments].join(" "),
            [SECOND_UNSHARE, ...SANDBOX_PROBE.programArguments].join(" "),
        ]);
        expect(result.capable).toBe(false);
        expect(machine.read).toEqual([]);
    });

    it("lets a test that ran overrule every kernel setting", () => {
        const files = { [restriction(2).file]: `${restriction(2).value}\n` };
        expect(probeLinuxSandbox(fakeHost({ programs: { [UNSHARE]: { exitCode: 0 } }, files }).host).capable).toBe(true);
    });
});

describe("the kernel settings", () => {
    const noProgram = { programs: {} };

    it("are read only when no test program could be run", () => {
        const timedOut = fakeHost({ programs: { [UNSHARE]: { failed: "ETIMEDOUT" }, [SECOND_UNSHARE]: { failed: "EACCES" } } });
        probeLinuxSandbox(timedOut.host);
        expect(timedOut.read).toEqual(SANDBOX_PROBE.restrictions.map(entry => entry.file));
    });

    it("say cannot when any one of them rules user namespaces out", () => {
        for (let index = 0; index < SANDBOX_PROBE.restrictions.length; index++) {
            const { file, value } = restriction(index);
            const result = probeLinuxSandbox(fakeHost({ ...noProgram, files: { [file]: `${value}\n` } }).host);
            expect(result).toEqual({ capable: false, reason: `${file} is ${value}` });
        }
    });

    it("say can when none does, or none can be read", () => {
        const permissive = Object.fromEntries(SANDBOX_PROBE.restrictions.map(({ file, value }) => [file, value === "0" ? "1" : "0"]));
        expect(probeLinuxSandbox(fakeHost({ ...noProgram, files: permissive }).host).capable).toBe(true);
        expect(probeLinuxSandbox(fakeHost(noProgram).host).capable).toBe(true);
    });
});

describe("the real machine", () => {
    const host = nodeSandboxProbeHost();

    it("reports a program that is not there as not having run", () => {
        expect(host.run(path.join(__dirname, "no-such-program"), [])).toEqual({ failed: "ENOENT" });
    });

    it("answers null for files that cannot be read", () => {
        expect(host.stat(path.join(__dirname, "no-such-file"))).toBeNull();
        expect(host.readText(path.join(__dirname, "no-such-file"))).toBeNull();
        expect(host.canExecute(path.join(__dirname, "no-such-file"))).toBe(false);
    });

    it("names the binary this process runs", () => {
        expect(path.isAbsolute(host.executable())).toBe(true);
    });
});
