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

export function parseMainCommandLine(argv: readonly string[]): MainCommandLineOptions {
    let cdpEnabled = false;
    let cdpPort = DEFAULT_CDP_PORT;
    let portSource: CdpCommandLineOptions["portSource"] = "default";
    let error: string | null = null;
    let devReloadPort = DEFAULT_DEV_RELOAD_PORT;
    let devReloadPortSource: DevReloadCommandLineOptions["portSource"] = "default";
    let devReloadError: string | null = null;

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];

        if (arg === "--dev" || arg === "--onboarding") {
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
