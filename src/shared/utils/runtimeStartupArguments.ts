/**
 * What a shipped game accepts on its own command line.
 *
 * Electron has no allowlist of its own: Chromium's parser takes every switch compiled into the
 * binary, which in Electron 38 is thousands of them. Among those are switches that open a debugger
 * port, weaken the renderer sandbox, redirect name resolution, or run the browser's child processes
 * through a prefix command. A shipped game needs none of them, so it states the few it does accept
 * and refuses to start on anything else.
 *
 * This is a cost, not a boundary. A player owns the machine the game runs on: they can edit the
 * shortcut, replace the binary with a stock Electron of the same version, or attach a debugger to
 * the process. What the refusal removes is the cheapest route - a switch typed into a launcher.
 *
 * Comments in English per project convention.
 */

/**
 * The guard's tables are stored masked, and re-keyed once per shipped build.
 *
 * A shipped game's `main.js` is the one file a player can read without opening anything first, and a
 * plain list of switch names sitting in it is a map of this guard: a search for `remote-debugging-port`
 * lands on the check, and the check is a one-line edit away from gone. So the allowlist, the debug
 * list, the log switch and the refusal line all live masked inside one blob, decoded here at load and
 * never appearing as a literal a search can match. This is not secrecy - the decoder is right here -
 * it removes the cheapest read, the same thing the allowlist does for the cheapest launch.
 *
 * The blob is re-keyed with a fresh random `(seed, step)` for every shipped build (the build's
 * `reseedGuardMaskTable`), so the tokens are not byte-identical from one game to the next: reversing
 * one game hands a search no token to grep across the rest.
 *
 * The plaintext lives in the comment below and in this module's test, never in the shipped bundle.
 * To change the set: edit the plaintext, rebuild the committed blob with `buildGuardMaskTable`, and
 * the test pins the two together.
 *
 *   allowed:  disable-gpu, disable-gpu-compositing, disable-software-rasterizer, use-angle, use-gl,
 *             ozone-platform, ozone-platform-hint, force-device-scale-factor, force-color-profile,
 *             lang, use-logs           (each a statement about the player's own hardware; nothing
 *             that reaches content, network or a process boundary is here - no sandbox switches)
 *   debug:    remote-debugging-port, remote-debugging-pipe, inspect, inspect-brk, inspect-port,
 *             inspect-publish-uid
 *   logs:     use-logs                 (turns the main process's own output back on; named apart
 *             from Chromium's `--enable-logging`/`--log-file`/`--log-level` on purpose)
 *   refusal:  "refusing to start: this build does not accept "   (the log line's fixed half; its
 *             plaintext would otherwise point a search straight at the refusal)
 *   fallback: (running without the sandbox; see the section of that name below)
 *             switch        no-sandbox                (accepted only on Linux, and only on a machine
 *                                                      the game finds cannot provide a sandbox)
 *             variable      ELECTRON_DISABLE_SANDBOX  (Electron turns it into that switch)
 *             helper        chrome-sandbox            (Chromium's setuid helper, beside its executable)
 *             programs      /usr/bin/unshare, /bin/unshare   (where the user-namespace test is found)
 *             arguments     -Ur, true                 (what it is run with)
 *             restrictions  /proc/sys/kernel/unprivileged_userns_clone=0,
 *                           /proc/sys/user/max_user_namespaces=0,
 *                           /proc/sys/kernel/apparmor_restrict_unprivileged_userns=1
 *                                                     (kernel settings that rule user namespaces out)
 *             notice        "accepting a launch without the sandbox this machine cannot provide: "
 *                                                     (logged, followed by what the game found)
 *             The probe's paths are masked as well as the two names: a search for any of them would
 *             otherwise land on the code that decides whether the switch is accepted. For the same
 *             reason the property names this group travels under in the bundle, which minification
 *             keeps, avoid the words those searches would use.
 */
export type GuardMaskTable = {
    seed: number;
    step: number;
    allowed: string[];
    debugging: string[];
    logs: string;
    refusalPrefix: string;
    fallback: {
        switchName: string;
        environmentVariable: string;
        helper: string;
        programs: string[];
        programArguments: string[];
        /** Each `<file>=<value>`: a kernel setting that, holding that value, rules user namespaces out. */
        restrictions: string[];
        notice: string;
    };
};

function maskBytesWith(bytes: Buffer, seed: number, step: number): Buffer {
    const out = Buffer.alloc(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
        out[i] = bytes[i] ^ ((seed + i * step) & 0xff);
    }
    return out;
}

/** Reconstruct masked text from its token under a `(seed, step)` key. */
export function revealMaskedTextWith(token: string, seed: number, step: number): string {
    return maskBytesWith(Buffer.from(token, "base64url"), seed, step).toString("utf8");
}

/** Mask text into a token under a `(seed, step)` key. Used by the build's re-key and the test. */
export function maskTextWith(text: string, seed: number, step: number): string {
    return maskBytesWith(Buffer.from(text, "utf8"), seed, step).toString("base64url");
}

/** The distinctive prefix a built main.js carries, so the build step can find the blob to re-key it. */
export const GUARD_MASK_TABLE_PREFIX = "NLMT:";

type PackedGuardTable = {
    s: number;
    t: number;
    a: string[];
    d: string[];
    l: string;
    r: string;
    n: string;
    e: string;
    h: string;
    u: string[];
    g: string[];
    k: string[];
    o: string;
};

/** Read a masked-table blob back into its plaintext names. */
export function parseGuardMaskTable(blob: string): GuardMaskTable {
    if (!blob.startsWith(GUARD_MASK_TABLE_PREFIX)) {
        throw new Error("not a guard mask table");
    }
    const packed = JSON.parse(
        Buffer.from(blob.slice(GUARD_MASK_TABLE_PREFIX.length), "base64url").toString("utf8"),
    ) as PackedGuardTable;
    const reveal = (token: string): string => revealMaskedTextWith(token, packed.s, packed.t);
    return {
        seed: packed.s,
        step: packed.t,
        allowed: packed.a.map(reveal),
        debugging: packed.d.map(reveal),
        logs: reveal(packed.l),
        refusalPrefix: reveal(packed.r),
        fallback: {
            switchName: reveal(packed.n),
            environmentVariable: reveal(packed.e),
            helper: reveal(packed.h),
            programs: packed.u.map(reveal),
            programArguments: packed.g.map(reveal),
            restrictions: packed.k.map(reveal),
            notice: reveal(packed.o),
        },
    };
}

/** Write a table to a blob under its key. The build re-keys with a fresh `(seed, step)` per game. */
export function buildGuardMaskTable(table: GuardMaskTable): string {
    const mask = (text: string): string => maskTextWith(text, table.seed, table.step);
    const packed: PackedGuardTable = {
        s: table.seed,
        t: table.step,
        a: table.allowed.map(mask),
        d: table.debugging.map(mask),
        l: mask(table.logs),
        r: mask(table.refusalPrefix),
        n: mask(table.fallback.switchName),
        e: mask(table.fallback.environmentVariable),
        h: mask(table.fallback.helper),
        u: table.fallback.programs.map(mask),
        g: table.fallback.programArguments.map(mask),
        k: table.fallback.restrictions.map(mask),
        o: mask(table.fallback.notice),
    };
    return GUARD_MASK_TABLE_PREFIX + Buffer.from(JSON.stringify(packed), "utf8").toString("base64url");
}

/** The committed table, keyed with a fixed seed; every shipped build re-keys it. Decoded once here. */
const GUARD_TABLE = parseGuardMaskTable(
    "NLMT:eyJzIjo5MSwidCI6MzEsImEiOlsiUHhQcTJiV2FjQmswQXVRIiwiUHhQcTJiV2FjQmswQXVTZHJJRmdYQ1FaNE55dWlHSSIsIlB4UHEyYldhY0JrZ0hmZkV1STlfU1dZWTZOdXpnM2ROT1FmeiIsIkxnbjhsYmFZY2xnMiIsIkxnbjhsYkNhIiwiTkFEMjFyTGJaVmd5QnZmZnZZTSIsIk5BRDIxckxiWlZneUJ2ZmZ2WU1nUkNJRV9RIiwiUFJYcjI3TGJjVkVsR19MVjRwMXVUU2NQcE02bWhYRkxNUSIsIlBSWHIyN0xiZGxzX0hlT2R2NXhpU2lJRzdBIiwiTnh2MzN3IiwiTGduOGxidVpja2MiXSwiZCI6WyJLUl8wMTZPVE9GQTJFT1RYcUlkalMyWWE1dHF6IiwiS1JfMDE2T1RPRkEyRU9UWHFJZGpTMllhNE5paSIsIk1oVHF5TEtWWVEiLCJNaFRxeUxLVllSa3hBUG8iLCJNaFRxeUxLVllSa2pIZVBFIiwiTWhUcXlMS1ZZUmtqQl9QY3BwMWxBVDREN1EiXSwibCI6IkxnbjhsYnVaY2tjIiwiciI6IktSX196YVNmZTFOekJ2NlF2SnBzWGo5UXFkeXZqM1lFSVJmb3pOdi1tWE5lS1ZuMjJLTFZkVkF4Rk9EYjdnIiwibiI6Ik5SVzB5N2FZY1ZZOENnIiwiZSI6IkhqYmMtNE9rV25vTU50ampqcXhCYVJRNXlPYURwRXA4IiwiaCI6Ik9CTHIxN3FUT0VjeUhQWFNvSlkiLCJ1IjpbImRBX3F5dmlVZkZwOEJfX0RwNDlfU1EiLCJkQmp3MXZpRGUwYzdFLVBWIl0sImciOlsiZGlfciIsIkx3anMzUSJdLCJrIjpbImRBcnIxN1RaWmswZ1hmclZ2WUJvUUdRZjU5aTFqM05OTHdmbXhkdUJpRzllS0JmcjZMV1plMTAzVEtBIiwiZEFycjE3VFpaazBnWGVURHFwd2lRU29TMXQyMGczZDdMUVBzeGN5dW5IOWVLVVNvIiwiZEFycjE3VFpaazBnWGZyVnZZQm9RR1FMLWRpbWxHaExNVDN6eGN5cWozVllMaWJ0MmFhSGZVVTdIZlhJcTRsVFhqa00tc20xMkRVIl0sIm8iOiJPaG42M2FlQ2ZGbzBVdkNRbzQ5NFFpZ0NxZC11a20xTE5oYWgxTmU3M1c5YU5CMzYySzdWWUZzN0FyRENyNDVrUWlRTXFNU25pMnBNTmtIdzdkR3JsWDlmWTFnIn0",
);

/** The switches a shipped game still accepts. See the table comment above for the plaintext. */
export const ALLOWED_STARTUP_SWITCHES: readonly string[] = GUARD_TABLE.allowed;

/** The switch that turns the main process's own output back on. */
export const RUNTIME_LOGS_SWITCH = GUARD_TABLE.logs;

/** The fixed half of the guard's refusal log line; the refused arguments are appended to it. */
export const REFUSAL_LOG_PREFIX = GUARD_TABLE.refusalPrefix;

/*
 * Running without the sandbox.
 *
 * Chromium runs every page in a sandbox, and on Linux it builds that sandbox from one of two things:
 * unprivileged user namespaces, or a setuid-root helper called `chrome-sandbox` beside the
 * executable. Where neither is available it does not fall back - it aborts before any of this
 * script runs. Both are commonly missing: Ubuntu 23.10 and later restrict unprivileged user
 * namespaces through AppArmor out of the box, and the helper only works when it is owned by root
 * with mode 4755, which no zip, folder or AppImage can carry. On such a machine the only way the
 * game starts at all is with the sandbox switched off.
 *
 * So the switch that does that is accepted in exactly one situation: on Linux, on a machine the game
 * itself finds cannot provide a sandbox. It is refused everywhere else, as every switch outside the
 * allowlist is - a player cannot use it to take the sandbox away from a machine that has one. The
 * finding is the game's own and never the launcher's: whoever started the game is not trusted to
 * say what the machine can do. The machine is only examined when a launch asks to go without the
 * sandbox, so an ordinary launch pays nothing for it. See `src/runtime/main/sandboxProbe.ts`.
 *
 * Electron reads the same request from an environment variable, which turns into the switch on
 * Chromium's command line before the main script runs and so never appears in `process.argv`. It is
 * treated as the switch - left alone, it was a way round the allowlist on every platform.
 */

/** Chromium's switch for running with no sandbox at all. */
export const SANDBOX_SWITCH = GUARD_TABLE.fallback.switchName;

/** The environment variable Electron turns into {@link SANDBOX_SWITCH}. */
export const SANDBOX_ENVIRONMENT_VARIABLE = GUARD_TABLE.fallback.environmentVariable;

/** The fixed half of the log line written when a launch without the sandbox is accepted. */
export const SANDBOX_FALLBACK_NOTICE = GUARD_TABLE.fallback.notice;

/**
 * How a machine is examined for a sandbox Chromium could use. The game's probe and the Linux
 * launcher written into every Linux package both read it from here, so the two ask the same
 * questions of the same files and cannot come to different answers by asking differently.
 */
export type SandboxProbePlan = {
    /** The setuid helper's file name, looked for beside the real Electron binary. */
    helper: string;
    /** Where the user-namespace test program is looked for, in order. Absolute, so `PATH` plays no part. */
    programs: readonly string[];
    /** What it is run with: a new user namespace that maps the caller to root, running `true`. */
    programArguments: readonly string[];
    /**
     * Kernel settings that, holding the given value, rule unprivileged user namespaces out. Read only
     * when the test program cannot be run, as the next best evidence.
     */
    restrictions: readonly { file: string; value: string }[];
};

export const SANDBOX_PROBE: SandboxProbePlan = {
    helper: GUARD_TABLE.fallback.helper,
    programs: GUARD_TABLE.fallback.programs,
    programArguments: GUARD_TABLE.fallback.programArguments,
    restrictions: GUARD_TABLE.fallback.restrictions.map(entry => {
        const separator = entry.lastIndexOf("=");
        return { file: entry.slice(0, separator), value: entry.slice(separator + 1) };
    }),
};

/**
 * Whether the environment carries {@link SANDBOX_ENVIRONMENT_VARIABLE} in the form Electron acts on.
 *
 * Presence rather than value: measured on Electron 38, `1`, `0` and `false` all turn the switch on.
 * An empty value does not on Windows, where Chromium's environment reader treats an empty variable
 * as unset; on Linux and macOS it reads `getenv`, for which an empty variable is still set.
 */
export function environmentDisablesSandbox(
    environment: Readonly<Record<string, string | undefined>>,
    platform: NodeJS.Platform,
): boolean {
    const value = environment[SANDBOX_ENVIRONMENT_VARIABLE];
    return value !== undefined && (platform !== "win32" || value !== "");
}

/** What a launch is, as far as running without the sandbox goes. */
export type SandboxLaunchFacts = {
    /**
     * Chromium's own command line carries {@link SANDBOX_SWITCH}, however it got there - what
     * `app.commandLine.hasSwitch` answers. The authority on whether the sandbox will be off: the
     * environment variable only matters when it has put the switch here.
     */
    inEffect: boolean;
    /** {@link environmentDisablesSandbox}: named in a refusal, as the route the switch came by. */
    environment: boolean;
    /**
     * Whether this machine can give Chromium a sandbox. Asked only on Linux and only when the launch
     * asks to go without one - a function so that an ordinary launch never runs the probe behind it.
     */
    machineCapable: () => boolean;
};

/** A launch with no sandbox switch anywhere. The default, and the secure answer for every question. */
const NO_SANDBOX_SWITCH: SandboxLaunchFacts = {
    inEffect: false,
    environment: false,
    machineCapable: () => true,
};

/**
 * Chromium's switch prefixes, which are not the same on every platform.
 *
 * Windows also reads `-` and `/` and lower-cases the name; POSIX reads `--` and `-`. Matching this
 * matters in both directions: a prefix not read here is a switch that slips past, and one read here
 * that Chromium does not read is a launch refused over an ordinary argument.
 */
function switchPrefixes(platform: NodeJS.Platform): string[] {
    return platform === "win32" ? ["--", "-", "/"] : ["--", "-"];
}

export type StartupArgumentReview = {
    /**
     * The arguments this game does not accept, as they were written.
     *
     * Empty means the launch may proceed. Anything in it is the reason it may not, and is what the
     * log line names - a switch typed into a launcher is the usual cause and the only thing the
     * person reading that line can act on.
     */
    refused: string[];
    /**
     * Every switch name seen, refused or not, for taking off the command line before Chromium
     * reads it.
     *
     * Removing beats quitting on its own, and the difference is measurable. On Electron 38 with
     * `--remote-debugging-port`, quitting from the first line of the main script still left the
     * port accepting connections about 130ms in; removing the switch from that same line meant it
     * never listened at all. Several switches are read after the main script runs, and those are
     * exactly the ones a removal reaches.
     */
    removable: string[];
    /**
     * What became of a request to run without the sandbox: there was none, it was accepted because
     * this machine cannot provide one, or it was refused (and is named in `refused`).
     */
    fallback: "not-asked" | "accepted" | "refused";
};

/** One command-line argument as Chromium reads it: a switch and its name, or anything else. */
type ReadArgument = { argument: string; switchName: string | null };

function readArguments(args: readonly string[], platform: NodeJS.Platform): ReadArgument[] {
    const prefixes = switchPrefixes(platform);
    const read: ReadArgument[] = [];
    let switchesEnded = false;
    for (const argument of args) {
        if (switchesEnded) {
            read.push({ argument, switchName: null });
            continue;
        }
        // A bare `--` ends switch parsing in Chromium and everything after it is a file name. A
        // shipped game is not opened with one; it is dropped here and what follows it is refused.
        if (argument === "--") {
            switchesEnded = true;
            continue;
        }
        const prefix = prefixes.find(candidate => argument.startsWith(candidate) && argument.length > candidate.length);
        if (!prefix) {
            read.push({ argument, switchName: null });
            continue;
        }
        const body = argument.slice(prefix.length);
        const separator = body.indexOf("=");
        const rawName = separator >= 0 ? body.slice(0, separator) : body;
        read.push({ argument, switchName: platform === "win32" ? rawName.toLowerCase() : rawName });
    }
    return read;
}

/**
 * Read a command line the way Chromium reads it, and say what a shipped game will not take.
 *
 * `args` is the command line without the executable - `process.argv.slice(1)` plus `execArgv`,
 * which is where a Node-level switch lands. `launch` is what the caller can see of a request to run
 * without the sandbox beyond `args`; see "Running without the sandbox" above for when that request
 * is accepted. Left out, the request is refused like any other switch outside the allowlist.
 */
export function reviewStartupArguments(
    args: readonly string[],
    platform: NodeJS.Platform,
    allowed: readonly string[] = ALLOWED_STARTUP_SWITCHES,
    launch: SandboxLaunchFacts = NO_SANDBOX_SWITCH,
): StartupArgumentReview {
    const permitted = new Set(allowed);
    const read = readArguments(args, platform);
    const refused: string[] = [];
    const removable: string[] = [];

    const sandboxSpelled = read.some(entry => entry.switchName === SANDBOX_SWITCH);
    const sandboxAsked = sandboxSpelled || launch.inEffect;
    // Linux first, so that no other platform ever examines the machine.
    const sandboxAccepted = sandboxAsked && platform === "linux" && !launch.machineCapable();

    for (const { argument, switchName } of read) {
        if (switchName === null) {
            refused.push(argument);
            continue;
        }
        removable.push(switchName);
        // The process serial number macOS hands a Finder-launched application. Chromium ignores it;
        // refusing it would refuse the ordinary way of opening the game.
        if (platform === "darwin" && switchName.startsWith("psn_")) {
            continue;
        }
        if (switchName === SANDBOX_SWITCH ? !sandboxAccepted : !permitted.has(switchName)) {
            refused.push(argument);
        }
    }

    if (launch.inEffect && !removable.includes(SANDBOX_SWITCH)) {
        removable.push(SANDBOX_SWITCH);
    }
    if (sandboxAsked && !sandboxAccepted) {
        // Say how the switch arrived when the command line does not show it: the environment
        // variable when that is set, and the switch itself when nothing visible explains it.
        if (launch.environment) {
            refused.push(SANDBOX_ENVIRONMENT_VARIABLE);
        } else if (!sandboxSpelled) {
            refused.push(`--${SANDBOX_SWITCH}`);
        }
    }

    return {
        refused,
        removable,
        fallback: !sandboxAsked ? "not-asked" : sandboxAccepted ? "accepted" : "refused",
    };
}

/**
 * The switches that ask for a debugger, as opposed to merely not being allowed.
 *
 * A build made under the experimental debuggable condition accepts any command line, and this is
 * how it tells a launch that came to inspect it from one that came to play: DevTools opens only
 * for the first. Not a refusal list - the refusal is the allowlist above, and naming dangerous
 * switches one by one is what that replaced.
 */
export const DEBUGGING_SWITCHES: readonly string[] = GUARD_TABLE.debugging;

/** Every switch name on this command line, whatever it is called and however it is spelled. */
export function startupSwitchNames(args: readonly string[], platform: NodeJS.Platform): string[] {
    return reviewStartupArguments(args, platform, []).removable;
}

/** What a build is, as far as the debuggable marker is concerned. */
export type DebuggableBuildFacts = {
    /** The `debuggable` marker this side of the launch can see. */
    marker: boolean;
    /** Whether the content is sealed: the project turned asset protection on. */
    sealed: boolean;
    /** Whether this is a packaged application rather than an app directory someone ran by hand. */
    packaged: boolean;
};

/**
 * Whether a `debuggable` marker on this build may be acted on.
 *
 * Honoured everywhere except one combination: a build that is both **sealed and packaged** refuses
 * it, whichever of the two markers carries it and whatever it says.
 *
 * The reason is timing rather than policy. What actually keeps a debugger out is the check that
 * runs *before* app-ready, because Chromium reads `--remote-debugging-port` after this script has
 * had its turn: quitting later still leaves the port accepting connections about 130ms in, while
 * taking the switch off the command line means it never listens at all. That check has to answer
 * before anything can open the pack, so the only marker it can read is the one in the loose app
 * manifest - a plain JSON file sitting beside the archive.
 *
 * On an ordinary build that is an accepted cost: the manifest is inside an asar whose integrity is
 * validated on the platforms that can, and a player owns the machine either way. On the *shipped*
 * form of a build whose author asked for asset protection it is not, because the point of that
 * build is that reading its content should cost something, and a one-word edit to a text file is
 * the cheapest imaginable route to a debugger attached to the process holding the decrypted
 * content.
 *
 * `packaged` is what separates the shipped form from the one a developer is looking at. An app
 * directory started under a stock Electron is not something anybody received: whoever is holding it
 * already has the main script as plain JavaScript and can delete this check outright, so refusing
 * there would protect nothing and would cost the one workflow the marker exists for - inspecting a
 * real sealed build without having to turn its protection off and debug a different code path.
 *
 * `sealed` is read from the presence of the store rather than from anything inside it, because that
 * is the one fact about protection a pre-ready check can establish. Deleting the store to get past
 * this does not produce a protected build with a debugger; it produces a build with no content.
 */
export function honoursDebuggableMarker(build: DebuggableBuildFacts): boolean {
    return build.marker && !(build.sealed && build.packaged);
}

/** Whether this command line asked for a debugger. */
export function hasDebuggingSwitch(args: readonly string[], platform: NodeJS.Platform): boolean {
    const asked = new Set(DEBUGGING_SWITCHES);
    return startupSwitchNames(args, platform).some(name => asked.has(name));
}

/** Whether this command line carries one named switch, spelled any way Chromium would read it. */
export function hasStartupSwitch(args: readonly string[], platform: NodeJS.Platform, name: string): boolean {
    return startupSwitchNames(args, platform).includes(name);
}
