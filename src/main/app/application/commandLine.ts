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
 * Flags whose *next* argument is a value rather than a path.
 *
 * Without this list, `--project demo` would offer "demo" to the open-request resolver as well.
 * Only the separated forms need it; `--flag=value` is one argument and never looks positional.
 */
const VALUE_TAKING_FLAGS = new Set([
    "--project",
    "--cdp-port",
    "--dev-reload-port",
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

    return {
        dev: argv.includes("--dev"),
        onboarding: argv.includes("--onboarding"),
        skipOnboarding: argv.includes("--skip-onboarding"),
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
