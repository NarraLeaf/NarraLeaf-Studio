import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { SANDBOX_PROBE, type SandboxProbePlan } from "@shared/utils/runtimeStartupArguments";

/**
 * Whether this Linux machine can give Chromium a sandbox, as the game finds out for itself.
 *
 * A shipped game accepts the switch that turns the sandbox off only on a machine that cannot provide
 * one (see "Running without the sandbox" in `@shared/utils/runtimeStartupArguments`). The launcher
 * script in a Linux package makes the same examination before adding that switch, but the game does
 * not take its word for it - nor that of any other launcher, AppImage's included: it looks again,
 * and refuses the switch on a machine where a sandbox was available.
 *
 * Chromium has two sandboxes on Linux and uses the first that works, so the machine can sandbox when
 * either does:
 *
 *  1. The setuid helper beside the real Electron binary, set up the way Chromium checks it before
 *     using it: owned by root, setuid, executable by everyone, and executable by this user.
 *  2. Unprivileged user namespaces, tested by running `unshare -Ur true` - the test electron-builder's
 *     AppImage launcher makes, so that launcher and this game agree. `unshare` is taken from fixed
 *     system locations and run with a fixed environment, so that a `PATH` or library override aimed
 *     at the launch cannot answer the question in place of the kernel.
 *  3. When no `unshare` can be run, the kernel settings that rule user namespaces out are the only
 *     evidence. If none of them says no, the answer is yes: refusing the switch is the safe mistake,
 *     because on a machine that really cannot sandbox the refusal is visible and the cause is in the
 *     log, while accepting it on one that can would silently remove the sandbox.
 *
 * Every name and path here comes from the masked table, so none of them is a literal in the shipped
 * bundle for a search to land on.
 */

/** What the probe needs from the machine. Structural so a test can stand in for one. */
export interface SandboxProbeHost {
    /** The Electron binary this process is running, symlinks resolved. */
    executable(): string;
    /** What `stat` (following links) says of a file, or null when it cannot be read. */
    stat(file: string): { uid: number; mode: number } | null;
    /** Whether this user may execute a file, as `access(X_OK)` answers. */
    canExecute(file: string): boolean;
    /**
     * Run a program to completion with a fixed, minimal environment.
     *
     * `exitCode` is null when it was ended by a signal. `failed` means it never ran or did not finish
     * - missing, not executable, or out of time - and carries the error code.
     */
    run(file: string, args: readonly string[]): { exitCode: number | null } | { failed: string };
    /** A file's text, or null when it cannot be read. */
    readText(file: string): string | null;
}

export type SandboxProbeResult = {
    /** Whether Chromium could build a sandbox on this machine. */
    capable: boolean;
    /** What decided it, for the game's log. Built from the plan's names, so it is masked like them. */
    reason: string;
};

const SETUID = 0o4000;
const OTHERS_EXECUTE = 0o001;

/** Examine the machine. Only ever called on Linux. */
export function probeLinuxSandbox(host: SandboxProbeHost, plan: SandboxProbePlan = SANDBOX_PROBE): SandboxProbeResult {
    // Beside the real binary, not beside whatever was launched: Chromium looks in the directory of
    // its own executable, which is where a package's launcher script leaves it.
    const helper = path.posix.join(path.posix.dirname(host.executable()), plan.helper);
    const helperStat = host.stat(helper);
    if (helperStat
        && helperStat.uid === 0
        && (helperStat.mode & SETUID) !== 0
        && (helperStat.mode & OTHERS_EXECUTE) !== 0
        && host.canExecute(helper)) {
        return { capable: true, reason: `${helper} is usable` };
    }

    for (const program of plan.programs) {
        const ran = host.run(program, plan.programArguments);
        if ("failed" in ran) {
            continue;
        }
        const command = [program, ...plan.programArguments].join(" ");
        return ran.exitCode === 0
            ? { capable: true, reason: `${command} succeeded` }
            : { capable: false, reason: `${command} failed (${ran.exitCode ?? "signal"})` };
    }

    for (const restriction of plan.restrictions) {
        const value = host.readText(restriction.file)?.trim();
        if (value === restriction.value) {
            return { capable: false, reason: `${restriction.file} is ${value}` };
        }
    }
    return { capable: true, reason: "no setting rules it out" };
}

/**
 * How long the user-namespace test may take. It is one fork and one exec; a test still running after
 * this is treated as having given no answer, and the kernel settings decide.
 */
const UNSHARE_TIMEOUT_MS = 3000;

/** The fixed environment the test runs in: enough for `unshare` to find `true`, and nothing else. */
const UNSHARE_ENVIRONMENT = { PATH: "/usr/bin:/bin" };

/** The real machine. */
export function nodeSandboxProbeHost(): SandboxProbeHost {
    return {
        executable: () => {
            try {
                return fs.realpathSync(process.execPath);
            } catch {
                return process.execPath;
            }
        },
        stat: file => {
            try {
                const stat = fs.statSync(file);
                return { uid: stat.uid, mode: stat.mode };
            } catch {
                return null;
            }
        },
        canExecute: file => {
            try {
                fs.accessSync(file, fs.constants.X_OK);
                return true;
            } catch {
                return false;
            }
        },
        run: (file, args) => {
            const result = spawnSync(file, [...args], {
                env: UNSHARE_ENVIRONMENT,
                stdio: "ignore",
                timeout: UNSHARE_TIMEOUT_MS,
            });
            if (result.error) {
                return { failed: (result.error as NodeJS.ErrnoException).code ?? "unknown" };
            }
            return { exitCode: result.status };
        },
        readText: file => {
            try {
                return fs.readFileSync(file, "utf-8");
            } catch {
                return null;
            }
        },
    };
}
