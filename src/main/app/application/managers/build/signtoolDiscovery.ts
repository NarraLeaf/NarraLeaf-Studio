import fs from "fs/promises";
import path from "path";

/**
 * Where the host's own signtool.exe is, when it has one.
 *
 * electron-builder resolves signtool through `getSignToolPath`
 * (`app-builder-lib/out/toolsets/windows.js`): it honours `SIGNTOOL_PATH` and
 * otherwise downloads its own Windows Kits bundle, which needs a network. A
 * machine with the Windows SDK installed already has the same binary on disk,
 * so probing for it turns a signed build into an offline operation - the only
 * network call left is the RFC 3161 timestamp, which preflight warns about.
 *
 * This is a host probe, which is why it lives in the manager: the worker is
 * handed the answer (`GameBuildWorkerWindowsSigning.signtoolPath`) rather than
 * deciding it. Finding nothing is not an error - the caller simply leaves the
 * field unset and electron-builder fetches its bundle as before.
 */

/** Windows Kits `bin` subdirectory names, by the arch of the tools inside. */
const ARCH_DIRS: Record<string, string> = {
    x64: "x64",
    arm64: "arm64",
    ia32: "x86",
};

/**
 * Which tool arch to prefer. The host's own first, then x64 and x86, which run
 * everywhere Windows does (arm64 Windows emulates both); arm64 last because an
 * arm64 signtool is useless to any other host.
 */
function archPreference(arch: string): string[] {
    const host = ARCH_DIRS[arch];
    return [...new Set([host, "x64", "x86", "arm64"].filter((value): value is string => Boolean(value)))];
}

/** `10.0.26100.0` sorts above `10.0.17134.0`; anything unparseable sorts last. */
function compareVersionsDescending(a: string, b: string): number {
    const parse = (value: string): number[] => value.split(".").map(part => Number.parseInt(part, 10));
    const left = parse(a);
    const right = parse(b);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const l = left[i] ?? -1;
        const r = right[i] ?? -1;
        if (Number.isNaN(l) || Number.isNaN(r)) {
            return Number.isNaN(l) ? 1 : -1;
        }
        if (l !== r) {
            return r - l;
        }
    }
    return 0;
}

async function isFile(candidate: string): Promise<boolean> {
    try {
        return (await fs.stat(candidate)).isFile();
    } catch {
        // A kit version this host does not have is the normal case.
        return false;
    }
}

async function versionDirs(binDir: string): Promise<string[]> {
    try {
        const entries = await fs.readdir(binDir, { withFileTypes: true });
        return entries
            .filter(entry => entry.isDirectory() && /^\d+(\.\d+)+$/.test(entry.name))
            .map(entry => entry.name)
            .sort(compareVersionsDescending);
    } catch {
        return [];
    }
}

export type SigntoolProbeInput = {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    /** `process.arch` of the host, i.e. which tool arch to prefer. */
    arch?: string;
};

/**
 * Absolute path of a signtool.exe on this host, or null when it has none.
 *
 * Order: `SIGNTOOL_PATH` (the same variable electron-builder reads, so an author
 * who set it keeps control), then the newest Windows Kits install under either
 * Program Files, preferring the host's own tool arch.
 */
export async function findSigntool(input: SigntoolProbeInput = {}): Promise<string | null> {
    const env = input.env ?? process.env;
    if ((input.platform ?? process.platform) !== "win32") {
        // signtool is a Windows binary; a Windows build from a Unix host signs
        // through electron-builder's osslsigncode path, which ignores this.
        return null;
    }
    const archs = archPreference(input.arch ?? process.arch);

    const override = env.SIGNTOOL_PATH?.trim();
    if (override) {
        // Either the binary or the directory holding it: both are what people
        // put in a variable named like a path.
        for (const candidate of [override, path.join(override, "signtool.exe")]) {
            if (await isFile(candidate)) {
                return path.resolve(candidate);
            }
        }
    }

    const programRoots = [env["ProgramFiles(x86)"], env.ProgramFiles, env.ProgramW6432]
        .map(root => root?.trim())
        .filter((root): root is string => Boolean(root));
    const kitRoots = [...new Set(
        programRoots.flatMap(root => ["10", "8.1"].map(kit => path.join(root, "Windows Kits", kit, "bin"))),
    )];

    for (const binDir of kitRoots) {
        for (const version of await versionDirs(binDir)) {
            for (const arch of archs) {
                const candidate = path.join(binDir, version, arch, "signtool.exe");
                if (await isFile(candidate)) {
                    return candidate;
                }
            }
        }
        // Pre-10.0.15063 kits put the tools straight under bin/<arch>.
        for (const arch of archs) {
            const candidate = path.join(binDir, arch, "signtool.exe");
            if (await isFile(candidate)) {
                return candidate;
            }
        }
    }
    return null;
}
