export const DEFAULT_CDP_PORT = 9222;

export interface CdpCommandLineOptions {
    enabled: boolean;
    port: number;
    portSource: "default" | "argument";
    error: string | null;
}

export interface MainCommandLineOptions {
    dev: boolean;
    cdp: CdpCommandLineOptions;
}

export function isMainDevMode(options: MainCommandLineOptions, isPackaged: boolean): boolean {
    return !isPackaged && options.dev;
}

function parseCdpPort(value: string | undefined): number | null {
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

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];

        if (arg === "--dev") {
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
            const port = parseCdpPort(argv[i + 1]);
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
            const port = parseCdpPort(value);
            if (port === null) {
                error = `Invalid --cdp-port value: ${value}`;
                continue;
            }

            cdpPort = port;
            portSource = "argument";
            error = null;
        }
    }

    return {
        dev: argv.includes("--dev"),
        cdp: {
            enabled: cdpEnabled,
            port: cdpPort,
            portSource,
            error,
        },
    };
}
