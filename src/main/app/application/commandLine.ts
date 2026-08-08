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
    cdp: CdpCommandLineOptions;
    devReload: DevReloadCommandLineOptions;
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

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];

        if (arg === "--dev" || arg === "--onboarding" || arg === "--skip-onboarding") {
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
    };
}
