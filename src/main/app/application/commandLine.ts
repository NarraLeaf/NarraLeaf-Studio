import {
    EXPERIMENTAL_CONDITION_FLAG_PREFIX,
    EXPERIMENTAL_CONDITION_IDS,
    EXPERIMENTAL_FLAG,
    isExperimentalConditionId,
    type ExperimentalConditionId,
} from "@shared/types/experimental";

export const DEFAULT_CDP_PORT = 9222;

/**
 * Must match DEV_RELOAD_PORT's fallback in project/build/utils.js. The dev server
 * passes its actual port with --dev-reload-port, so this default only applies to a
 * main process launched by hand against a plain `yarn dev` session.
 */
export const DEFAULT_DEV_RELOAD_PORT = 5588;

export interface CdpCommandLineOptions {
    enabled: boolean;
    port: number;
    portSource: "default" | "argument";
    error: string | null;
}

export interface DevReloadCommandLineOptions {
    port: number;
    portSource: "default" | "argument";
    error: string | null;
}

export interface StartupProjectCommandLineOptions {
    /**
     * What `--project` asked for: a directory path, or a name to look up in the recently-opened
     * list. Resolved against the disk and that list by `resolveStartupProject`, not here - parsing
     * has no business touching the file system.
     */
    selector: string | null;
    error: string | null;
}

/**
 * What `--build` and its companion flags asked for.
 *
 * Every value is kept as the raw string it was typed as. Whether "windows" is a platform, whether
 * this host can build for it and whether the project has a variant by that name are all decided
 * later - parsing has no business knowing the platform table, and none of it may touch the disk
 * (the same rule `--project` follows).
 */
export interface BuildCommandLineOptions {
    /**
     * `--build` appeared, whatever else was wrong with the line.
     *
     * Separate from {@link selector} because the two failures are different: a launch that asked
     * for a build and got the flags wrong must exit as a bad invocation, not quietly open the home
     * screen. Nothing else on the command line can turn this off.
     */
    requested: boolean;
    /**
     * What `--build` named: a project directory, or a name to look up in the recently-opened list.
     * Resolved by `resolveStartupProject`, exactly as `--project`'s value is.
     */
    selector: string | null;
    /** `--build-variant`: which build variant to produce. Null means the release variant. */
    variantId: string | null;
    /** `--build-target`: one platform. Null means the host's own. */
    platform: string | null;
    /** `--build-format`: one format of that platform. Null means the platform's first. */
    format: string | null;
    /** `--build-arch`: desktop only. Null means the host's arch for a host build, x64 otherwise. */
    arch: string | null;
    /** `--build-output`: absolute or relative to the working directory. Null means `<project>/dist`. */
    outputDir: string | null;
    /** `--build-report`: where to write the JSON report. Null means no report file. */
    reportPath: string | null;
    /**
     * `--build-user-data-dir`: the profile directory this launch runs against.
     *
     * Read far earlier than anything else here - `BaseApp` acts on it before it has a global state
     * to read - and honoured only for a build, which is why it is a build flag rather than a
     * general one. Electron keys the single-instance lock on this directory, so a build agent that
     * is also somebody's own machine can build while its owner has Studio open; without it the
     * second process is refused the lock and exits.
     *
     * A different profile is a different everything: no signing credentials, none of the machine's
     * build settings. `--build-signing` and `--build-setting` are how a run puts back the two a
     * build actually needs.
     */
    userDataDir: string | null;
    /**
     * `--build-signing`: a JSON file naming the credentials to sign this build with.
     *
     * For this run only - nothing is imported into the machine's vault - and it overrides what the
     * project points at for every platform the file names. See `commandLineSigning.ts`.
     */
    signingPath: string | null;
    /**
     * `--build-setting key=value`, repeatable: build settings this run reads instead of the
     * profile's.
     *
     * Kept as the raw strings they were typed as, like every other value here; the shape and which
     * keys are allowed are decided by `planCommandLineBuild`.
     */
    settings: string[];
    /**
     * `--build-allow-unsigned`: this launch accepts an artifact with no code signature.
     *
     * Without it a build whose target could carry a signature and has no credential configured is
     * refused. The Build dialog shows that as a finding an author reads before they commit; a
     * command line has nobody reading, so the acceptance has to be stated.
     */
    allowUnsigned: boolean;
    /** The first thing wrong with the build flags, in the words the launch prints. */
    error: string | null;
}

/**
 * What `--test` or `--lint` and their companion flags asked for.
 *
 * One shape for both checks rather than one each: they take the same five things (a project, a
 * report, a profile, and for `--test` a test to run and values to run it with), and a launch may
 * only ask for one of them, so a second interface would exist only to be checked against the first.
 * {@link kind} says which was named.
 *
 * Every value is kept as the raw string it was typed as. Whether a test id exists, and whether a
 * parameter value is one the test offers, are decided in the workspace - the only side that has the
 * registry - and none of it may touch the disk (the same rule `--build` follows).
 */
export interface CheckCommandLineOptions {
    /**
     * `--test` or `--lint` appeared, whatever else was wrong with the line.
     *
     * Separate from {@link selector} for the reason `BuildCommandLineOptions.requested` is: a launch
     * that asked for a check and got the flags wrong must exit as a bad invocation, not quietly open
     * the home screen.
     */
    requested: boolean;
    /** Which check was named. Null when none was, or when both were and the line is refused. */
    kind: "test" | "lint" | null;
    /** The project folder, or a name to look up in the recently-opened list. */
    selector: string | null;
    /** `--test-id`: which registered test to run. */
    testId: string | null;
    /** `--test-list`: report what the registry holds instead of running anything. */
    list: boolean;
    /** `--test-parameter key=value`, repeatable, as typed. */
    parameters: string[];
    /** `--test-report` / `--lint-report`: where to write the JSON report. */
    reportPath: string | null;
    /** `--test-user-data-dir` / `--lint-user-data-dir`: the profile this launch runs against. */
    userDataDir: string | null;
    /** The first thing wrong with the check flags, in the words the launch prints. */
    error: string | null;
}

export interface ExperimentalCommandLineOptions {
    /**
     * `--experimental` was given. Whether it is honoured is a second question - a packaged Studio
     * never enters the mode. See `BaseApp.getExperimentalState`.
     */
    requested: boolean;
    /** Conditions named by `--x-<id>` flags, in registry order and without duplicates. */
    conditions: ExperimentalConditionId[];
    /** `--x-` flags that name no registered condition, so the launch can report them. */
    unknownConditionFlags: string[];
}

export interface MainCommandLineOptions {
    dev: boolean;
    /**
     * Open the launcher in first-run setup, whatever this profile has already been through.
     *
     * Meaningful only in development - `BaseApp.wantsOnboardingRerun` is the single reader and it
     * gates on {@link isMainDevMode}. A packaged build ignores it, because argv reaches Studio from
     * shortcuts and file associations and those are not a place to redirect the interface from.
     */
    onboarding: boolean;
    /**
     * Open the launcher on its home screen even if this profile has never been through first-run
     * setup - the inverse of {@link onboarding}, and dev-only for the same reason.
     *
     * This exists for scripted runs (`tools/ui-verify`): a fresh `.dev/temp/userData-dev` is a
     * genuine first run, so every worktree session otherwise opens on the setup flow and has to
     * click its way out before it can reach anything. It records nothing - the profile is still
     * "has not been through setup" on the next launch, which is what keeps this from quietly
     * standing in for having answered.
     *
     * `--onboarding` wins if both are given: asking for a screen is more specific than asking not
     * to be interrupted by one.
     */
    skipOnboarding: boolean;
    /**
     * Open this project's workspace instead of the launcher's home screen.
     *
     * Dev-only, like the two above and for the same reason: in a packaged build argv is where
     * shortcuts and file associations arrive, and this is not the mechanism that should answer
     * them. See `App.openStartupWindow` for what the value can be and what happens when it does
     * not resolve.
     */
    project: StartupProjectCommandLineOptions;
    /**
     * Start on the home screen, whatever `workspace.reopenLastProject` says.
     *
     * The escape hatch for the reopen, and the one startup flag here that is NOT dev-gated: a
     * project that hangs or crashes the workspace as it loads would otherwise be reopened by every
     * launch, leaving no way to reach the home screen and open a different one. A packaged build is
     * exactly where that happens, and this flag opens nothing and reads no path - it only declines
     * to restore - so argv arriving from a shortcut has nothing to abuse here.
     *
     * `--project` still wins: naming a project is a more specific request than declining to
     * restore one.
     */
    launcher: boolean;
    /**
     * Produce a build of this project and exit, with no interface at all.
     *
     * **NOT dev-gated**, unlike `--project`, and the difference is the whole point: this exists for
     * a machine that has installed Studio and has nobody at the keyboard. The reasoning that gates
     * `--project` does not reach it. That flag redirects the interface, so a shortcut or a file
     * association carrying it would put an author somewhere they did not ask to be; this one opens
     * no interface, takes no positional path, and ends in the process exiting. Studio registers no
     * association and writes no shortcut that passes it, so a launch carrying it was written by
     * somebody who meant it.
     *
     * See `commandLineBuild.ts` for what the flags come to and `runCommandLineBuild` for the run.
     */
    build: BuildCommandLineOptions;
    /**
     * Run one check against this project and exit, with no interface at all.
     *
     * `--test` runs a test from the registry the Run > Test picker reads; `--lint` sweeps the rules
     * the Lint tab and the build gate run. **NOT dev-gated**, for the reason `--build` is not: this
     * exists for a machine with nobody at the keyboard. Neither opens an interface, neither takes a
     * positional path, and both end in the process exiting.
     *
     * See `commandLineCheck.ts` for what the flags come to and `runCommandLineCheck` for the run.
     */
    check: CheckCommandLineOptions;
    cdp: CdpCommandLineOptions;
    devReload: DevReloadCommandLineOptions;
    /**
     * Development launch that unlocks test conditions which are not part of the product.
     *
     * Parsed unconditionally and refused later for a packaged build, the same way `--cdp` is. See
     * `@shared/types/experimental` for what the flags are and why there are two levels of them.
     */
    experimental: ExperimentalCommandLineOptions;
    /**
     * Bare paths the launch was given, in the order they appeared - a double-clicked `.nlproj`, a
     * `.nlspkg` dropped on the icon, a folder passed on the command line.
     *
     * Kept as strings and nothing more. What a path *is* is decided by `resolveLaunchOpenRequest`
     * against the disk, and this file has no business touching the disk (same rule `--project`
     * follows). Anything that is not a project, a project folder or a package is ignored there,
     * which is what makes it safe to collect every positional argument here without knowing where
     * it came from.
     *
     * NOT dev-gated, unlike `--project`. This is the mechanism a packaged Studio is supposed to
     * answer file associations with; `--project`'s doc comment names it as the one that is not.
     */
    openPaths: string[];
}

export function isMainDevMode(options: MainCommandLineOptions, isPackaged: boolean): boolean {
    return !isPackaged && options.dev;
}

function parsePort(value: string | undefined): number | null {
    if (!value) {
        return null;
    }

    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return null;
    }

    return port;
}

/**
 * A value that follows a flag, or null when the flag was given without one.
 *
 * `--project --cdp` is a missing value rather than a project called "--cdp": swallowing the next
 * flag would take it out of the parse as well, so one typo would silently disable a second switch.
 */
function takeValue(value: string | undefined): string | null {
    if (value === undefined || value.startsWith("--") || value.trim() === "") {
        return null;
    }
    return value;
}

/**
 * The `--build` flags that take a value, and the field each one fills.
 *
 * A table rather than a branch per flag, so the seven of them cannot drift apart in how they read
 * a value, how they report a missing one, or whether their value is mistaken for a path to open.
 * {@link VALUE_TAKING_FLAGS} is built from these keys for that last reason.
 */
type BuildValueField = "selector" | "variantId" | "platform" | "format" | "arch" | "outputDir"
    | "reportPath" | "userDataDir" | "signingPath";

const BUILD_VALUE_FLAGS = {
    "--build": "selector",
    "--build-variant": "variantId",
    "--build-target": "platform",
    "--build-format": "format",
    "--build-arch": "arch",
    "--build-output": "outputDir",
    "--build-report": "reportPath",
    "--build-user-data-dir": "userDataDir",
    "--build-signing": "signingPath",
} as const satisfies Record<string, BuildValueField>;

type BuildValueFlag = keyof typeof BUILD_VALUE_FLAGS;

/**
 * The build flags that may be given more than once, and the list each one fills.
 *
 * Separate from the table above because "the last one wins" is wrong for them: two
 * `--build-setting` flags name two different settings, and dropping the first would be an argument
 * silently thrown away.
 */
const BUILD_LIST_FLAGS = {
    "--build-setting": "settings",
} as const satisfies Record<string, "settings">;

type BuildListFlag = keyof typeof BUILD_LIST_FLAGS;

function isBuildValueFlag(candidate: string): candidate is BuildValueFlag {
    return Object.prototype.hasOwnProperty.call(BUILD_VALUE_FLAGS, candidate);
}

function isBuildListFlag(candidate: string): candidate is BuildListFlag {
    return Object.prototype.hasOwnProperty.call(BUILD_LIST_FLAGS, candidate);
}

/**
 * Read one argument as a build flag, in either the `--flag value` or the `--flag=value` form.
 *
 * Answers null for anything that is not one, so the caller's branch reads like the branches around
 * it. `consumedNext` says whether the following argument was the value, which is what the caller
 * skips - the `=` form is one argument and skips nothing.
 */
function readBuildFlag(
    arg: string,
    next: string | undefined,
): { flag: BuildValueFlag | BuildListFlag; value: string | null; consumedNext: boolean } | null {
    if (isBuildValueFlag(arg) || isBuildListFlag(arg)) {
        const value = takeValue(next);
        return { flag: arg, value, consumedNext: value !== null };
    }
    const separator = arg.indexOf("=");
    if (separator === -1) {
        return null;
    }
    const flag = arg.slice(0, separator);
    if (!isBuildValueFlag(flag) && !isBuildListFlag(flag)) {
        return null;
    }
    // Only the first "=" separates the flag from its value: `--build-setting=key=value` carries a
    // second one, and splitting on that too would hand the caller half a setting.
    const value = arg.slice(separator + 1).trim();
    return { flag, value: value === "" ? null : value, consumedNext: false };
}

/** `--build-allow-unsigned`, which carries no value. */
const BUILD_ALLOW_UNSIGNED_FLAG = "--build-allow-unsigned";

/** What each build flag says it wants, for the "missing value" message. */
const BUILD_VALUE_DESCRIPTIONS: Record<BuildValueFlag | BuildListFlag, string> = {
    "--build": "a project path or a recent project's name",
    "--build-variant": "a build variant id",
    "--build-target": "a platform",
    "--build-format": "a format",
    "--build-arch": "an architecture",
    "--build-output": "an output folder",
    "--build-report": "a file to write the report to",
    "--build-user-data-dir": "a profile folder for this build to run in",
    "--build-signing": "a file naming the signing credentials",
    "--build-setting": "a setting, as key=value",
};

/**
 * The `--test` and `--lint` flags that take a value: which check each belongs to, and which field it
 * fills.
 *
 * One table for both checks, for the reason {@link CheckCommandLineOptions} is one interface. The
 * `check` half is what refuses a line that names both, and what lets `--lint-report` be recognised
 * as naming a lint report rather than as a report for whatever ran.
 */
const CHECK_VALUE_FLAGS = {
    "--test": { check: "test", field: "selector" },
    "--test-id": { check: "test", field: "testId" },
    "--test-report": { check: "test", field: "reportPath" },
    "--test-user-data-dir": { check: "test", field: "userDataDir" },
    "--lint": { check: "lint", field: "selector" },
    "--lint-report": { check: "lint", field: "reportPath" },
    "--lint-user-data-dir": { check: "lint", field: "userDataDir" },
} as const satisfies Record<string, { check: "test" | "lint"; field: "selector" | "testId" | "reportPath" | "userDataDir" }>;

type CheckValueFlag = keyof typeof CHECK_VALUE_FLAGS;

/** `--test-parameter key=value`, which may be given once per parameter. */
const CHECK_PARAMETER_FLAG = "--test-parameter";

/** `--test-list`, which carries no value. */
const CHECK_LIST_FLAG = "--test-list";

/** What each check flag says it wants, for the "missing value" message. */
const CHECK_VALUE_DESCRIPTIONS: Record<CheckValueFlag | typeof CHECK_PARAMETER_FLAG, string> = {
    "--test": "a project path or a recent project's name",
    "--test-id": "the id of a registered test",
    "--test-report": "a file to write the report to",
    "--test-user-data-dir": "a profile folder for this run",
    "--test-parameter": "a value the test declared, as id=value",
    "--lint": "a project path or a recent project's name",
    "--lint-report": "a file to write the report to",
    "--lint-user-data-dir": "a profile folder for this run",
};

function isCheckValueFlag(candidate: string): candidate is CheckValueFlag {
    return Object.prototype.hasOwnProperty.call(CHECK_VALUE_FLAGS, candidate);
}

/**
 * Read one argument as a check flag, in either the `--flag value` or the `--flag=value` form.
 *
 * The same shape `readBuildFlag` has, and deliberately a separate function rather than a shared
 * generic one: the two families fill different records, and the branch that would unify them would
 * be longer than both.
 */
function readCheckFlag(
    arg: string,
    next: string | undefined,
): { flag: CheckValueFlag | typeof CHECK_PARAMETER_FLAG; value: string | null; consumedNext: boolean } | null {
    if (isCheckValueFlag(arg) || arg === CHECK_PARAMETER_FLAG) {
        const value = takeValue(next);
        return { flag: arg, value, consumedNext: value !== null };
    }
    const separator = arg.indexOf("=");
    if (separator === -1) {
        return null;
    }
    const flag = arg.slice(0, separator);
    if (!isCheckValueFlag(flag) && flag !== CHECK_PARAMETER_FLAG) {
        return null;
    }
    // Only the first "=" separates the flag from its value: `--test-parameter=ending=good` carries a
    // second one, and splitting on that too would hand the caller half a parameter.
    const value = arg.slice(separator + 1).trim();
    return { flag, value: value === "" ? null : value, consumedNext: false };
}

/** Whether anything but `--test`/`--lint` themselves asked for something about a check. */
function hasCheckCompanionFlag(check: CheckCommandLineOptions): boolean {
    return check.testId !== null
        || check.list
        || check.parameters.length > 0
        || check.reportPath !== null
        || check.userDataDir !== null;
}

/**
 * Flags whose *next* argument is a value rather than a path.
 *
 * Without this list, `--project demo` would offer "demo" to the open-request resolver as well.
 * Only the separated forms need it; `--flag=value` is one argument and never looks positional.
 */
const VALUE_TAKING_FLAGS = new Set<string>([
    "--project",
    "--cdp-port",
    "--dev-reload-port",
    ...Object.keys(BUILD_VALUE_FLAGS),
    ...Object.keys(BUILD_LIST_FLAGS),
    ...Object.keys(CHECK_VALUE_FLAGS),
    CHECK_PARAMETER_FLAG,
]);

/**
 * Whether `argv[1]` is the app script rather than something the launch was asked to open.
 *
 * Only development has one: `electron dist/main/index.js --dev` puts the entry point where a
 * packaged launch puts the first real argument. Matching on the extension rather than on
 * `process.defaultApp` keeps this file pure, and costs nothing in the packaged case that matters -
 * neither a project folder nor a `.nlproj` nor a `.nlspkg` ends in `.js`.
 */
function isAppScriptArgument(argument: string | undefined): boolean {
    return argument !== undefined && /\.(?:js|mjs|cjs)$/i.test(argument);
}

/** Whether anything but `--build` itself asked for something about a build. */
function hasBuildCompanionFlag(build: BuildCommandLineOptions): boolean {
    return build.variantId !== null
        || build.platform !== null
        || build.format !== null
        || build.arch !== null
        || build.outputDir !== null
        || build.reportPath !== null
        || build.userDataDir !== null
        || build.signingPath !== null
        || build.settings.length > 0
        || build.allowUnsigned;
}

export function parseMainCommandLine(argv: readonly string[]): MainCommandLineOptions {
    let cdpEnabled = false;
    let cdpPort = DEFAULT_CDP_PORT;
    let portSource: CdpCommandLineOptions["portSource"] = "default";
    let error: string | null = null;
    let devReloadPort = DEFAULT_DEV_RELOAD_PORT;
    let devReloadPortSource: DevReloadCommandLineOptions["portSource"] = "default";
    let devReloadError: string | null = null;
    let projectSelector: string | null = null;
    let projectError: string | null = null;
    const experimentalConditions = new Set<ExperimentalConditionId>();
    const unknownConditionFlags = new Set<string>();
    const openPaths: string[] = [];
    const build: BuildCommandLineOptions = {
        requested: false,
        selector: null,
        variantId: null,
        platform: null,
        format: null,
        arch: null,
        outputDir: null,
        reportPath: null,
        userDataDir: null,
        signingPath: null,
        settings: [],
        allowUnsigned: false,
        error: null,
    };
    const buildFlagErrors = new Map<BuildValueFlag | BuildListFlag, string>();
    const check: CheckCommandLineOptions = {
        requested: false,
        kind: null,
        selector: null,
        testId: null,
        list: false,
        parameters: [],
        reportPath: null,
        userDataDir: null,
        error: null,
    };
    const checkFlagErrors = new Map<string, string>();
    /** Both checks named on one line: kept so the refusal survives whichever was read last. */
    let bothChecksNamed = false;

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];

        // Index 0 is the executable and index 1 may be the app script, neither of which is an
        // argument. Everything else that is not a switch and does not follow one is a candidate
        // path - `resolveLaunchOpenRequest` decides whether it is anything at all, so a Chromium
        // positional or a stray word costs nothing here.
        const isPositional = i > (isAppScriptArgument(argv[1]) ? 1 : 0)
            && !arg.startsWith("-")
            && !VALUE_TAKING_FLAGS.has(argv[i - 1] ?? "");
        if (isPositional) {
            openPaths.push(arg);
        }

        if (arg === "--dev" || arg === "--onboarding" || arg === "--skip-onboarding"
            || arg === "--launcher") {
            continue;
        }

        if (arg === BUILD_ALLOW_UNSIGNED_FLAG) {
            build.allowUnsigned = true;
            continue;
        }

        // One branch for all seven value-taking build flags. `--build` additionally records that a
        // build was asked for at all, before its value is read: the launch has to exit as a bad
        // invocation rather than open the home screen even when the value is the thing missing.
        const buildFlag = readBuildFlag(arg, argv[i + 1]);
        if (buildFlag) {
            if (buildFlag.flag === "--build") {
                build.requested = true;
            }
            if (buildFlag.value === null) {
                // Kept per flag, so a `--build-format` given twice - once wrong, once right - is
                // forgiven, while a `--build-target` that was never given a value is not.
                buildFlagErrors.set(
                    buildFlag.flag,
                    `Missing ${buildFlag.flag} value: expected ${BUILD_VALUE_DESCRIPTIONS[buildFlag.flag]}`,
                );
            } else if (isBuildListFlag(buildFlag.flag)) {
                build[BUILD_LIST_FLAGS[buildFlag.flag]].push(buildFlag.value);
                buildFlagErrors.delete(buildFlag.flag);
            } else {
                build[BUILD_VALUE_FLAGS[buildFlag.flag]] = buildFlag.value;
                buildFlagErrors.delete(buildFlag.flag);
            }
            if (buildFlag.consumedNext) {
                i += 1;
            }
            continue;
        }

        if (arg === CHECK_LIST_FLAG) {
            check.requested = true;
            if (check.kind === "lint") {
                bothChecksNamed = true;
            }
            check.kind ??= "test";
            check.list = true;
            continue;
        }

        // One branch for every check flag. `--test` and `--lint` additionally record that a check
        // was asked for at all, and which one, before the value is read: the launch has to exit as a
        // bad invocation rather than open the home screen even when the value is the thing missing.
        const checkFlag = readCheckFlag(arg, argv[i + 1]);
        if (checkFlag) {
            if (checkFlag.flag !== CHECK_PARAMETER_FLAG) {
                const entry = CHECK_VALUE_FLAGS[checkFlag.flag];
                if (checkFlag.flag === "--test" || checkFlag.flag === "--lint") {
                    check.requested = true;
                }
                if (check.kind !== null && check.kind !== entry.check) {
                    bothChecksNamed = true;
                }
                check.kind ??= entry.check;
            }
            if (checkFlag.value === null) {
                checkFlagErrors.set(
                    checkFlag.flag,
                    `Missing ${checkFlag.flag} value: expected ${CHECK_VALUE_DESCRIPTIONS[checkFlag.flag]}`,
                );
            } else if (checkFlag.flag === CHECK_PARAMETER_FLAG) {
                check.parameters.push(checkFlag.value);
                checkFlagErrors.delete(checkFlag.flag);
            } else {
                check[CHECK_VALUE_FLAGS[checkFlag.flag].field] = checkFlag.value;
                checkFlagErrors.delete(checkFlag.flag);
            }
            if (checkFlag.consumedNext) {
                i += 1;
            }
            continue;
        }

        if (arg === "--project") {
            const value = takeValue(argv[i + 1]);
            if (value === null) {
                projectError = "Missing --project value: expected a project path or a recent project's name";
                continue;
            }

            projectSelector = value;
            projectError = null;
            i += 1;
            continue;
        }

        if (arg.startsWith("--project=")) {
            const value = arg.slice("--project=".length).trim();
            if (value === "") {
                projectError = "Missing --project value: expected a project path or a recent project's name";
                continue;
            }

            projectSelector = value;
            projectError = null;
            continue;
        }

        if (arg === EXPERIMENTAL_FLAG) {
            continue;
        }

        if (arg.startsWith(EXPERIMENTAL_CONDITION_FLAG_PREFIX)) {
            const id = arg.slice(EXPERIMENTAL_CONDITION_FLAG_PREFIX.length);
            if (isExperimentalConditionId(id)) {
                experimentalConditions.add(id);
            } else {
                unknownConditionFlags.add(arg);
            }
            continue;
        }

        if (arg === "--cdp") {
            cdpEnabled = true;
            continue;
        }

        if (arg.startsWith("--cdp=")) {
            const value = arg.slice("--cdp=".length);
            cdpEnabled = value !== "false" && value !== "0";
            continue;
        }

        if (arg === "--cdp-port") {
            const port = parsePort(argv[i + 1]);
            if (port === null) {
                error = `Invalid --cdp-port value: ${argv[i + 1] ?? ""}`;
                continue;
            }

            cdpPort = port;
            portSource = "argument";
            error = null;
            i += 1;
            continue;
        }

        if (arg.startsWith("--cdp-port=")) {
            const value = arg.slice("--cdp-port=".length);
            const port = parsePort(value);
            if (port === null) {
                error = `Invalid --cdp-port value: ${value}`;
                continue;
            }

            cdpPort = port;
            portSource = "argument";
            error = null;
            continue;
        }

        if (arg === "--dev-reload-port") {
            const port = parsePort(argv[i + 1]);
            if (port === null) {
                devReloadError = `Invalid --dev-reload-port value: ${argv[i + 1] ?? ""}`;
                continue;
            }

            devReloadPort = port;
            devReloadPortSource = "argument";
            devReloadError = null;
            i += 1;
            continue;
        }

        if (arg.startsWith("--dev-reload-port=")) {
            const value = arg.slice("--dev-reload-port=".length);
            const port = parsePort(value);
            if (port === null) {
                devReloadError = `Invalid --dev-reload-port value: ${value}`;
                continue;
            }

            devReloadPort = port;
            devReloadPortSource = "argument";
            devReloadError = null;
        }
    }

    // The first flag still missing a value, in the order the table lists them rather than the order
    // they were typed, so two launches with the same mistakes print the same sentence.
    const orderedBuildFlags = [
        ...Object.keys(BUILD_VALUE_FLAGS),
        ...Object.keys(BUILD_LIST_FLAGS),
    ] as Array<BuildValueFlag | BuildListFlag>;
    build.error = orderedBuildFlags
        .map(flag => buildFlagErrors.get(flag))
        .find((message): message is string => message !== undefined) ?? null;
    // A companion flag without `--build` names a build that was never asked for. Refusing rather
    // than ignoring it: the alternative is a launch that opens the editor while the script that
    // wrote the line believes it is building.
    if (!build.requested && (build.error !== null || hasBuildCompanionFlag(build))) {
        build.requested = true;
        build.error ??= "Missing --build: the build flags name a build nothing asked for";
    }

    // The same three refusals for the checks, in the same order and for the same reasons.
    const orderedCheckFlags: Array<CheckValueFlag | typeof CHECK_PARAMETER_FLAG> = [
        ...(Object.keys(CHECK_VALUE_FLAGS) as CheckValueFlag[]),
        CHECK_PARAMETER_FLAG,
    ];
    check.error = orderedCheckFlags
        .map(flag => checkFlagErrors.get(flag))
        .find((message): message is string => message !== undefined) ?? null;
    if (!check.requested && (check.error !== null || hasCheckCompanionFlag(check))) {
        check.requested = true;
        check.error ??= "Missing --test or --lint: the check flags name a check nothing asked for";
    }
    // Two checks on one line, or a check beside a build. Refused rather than resolved in some order:
    // both would run against the same profile and only one exit code can leave the process, so any
    // answer here would report a result the launch never asked about.
    if (bothChecksNamed) {
        check.requested = true;
        check.error = "Both --test and --lint were given: one launch answers one question";
    } else if (check.requested && build.requested) {
        check.error ??= "A build and a check were given on one line: one launch answers one question";
    }

    return {
        dev: argv.includes("--dev"),
        onboarding: argv.includes("--onboarding"),
        skipOnboarding: argv.includes("--skip-onboarding"),
        build,
        check,
        project: {
            selector: projectSelector,
            error: projectError,
        },
        launcher: argv.includes("--launcher"),
        cdp: {
            enabled: cdpEnabled,
            port: cdpPort,
            portSource,
            error,
        },
        devReload: {
            port: devReloadPort,
            portSource: devReloadPortSource,
            error: devReloadError,
        },
        experimental: {
            requested: argv.includes(EXPERIMENTAL_FLAG),
            // Registry order rather than the order they were typed, so two launches with the same
            // conditions produce the same list wherever it is printed.
            conditions: EXPERIMENTAL_CONDITION_IDS.filter(id => experimentalConditions.has(id)),
            unknownConditionFlags: [...unknownConditionFlags],
        },
        openPaths,
    };
}
