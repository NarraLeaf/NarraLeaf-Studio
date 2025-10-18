import { ValuesOf } from "../utils/types";

export const PlatformSystem = {
    aix: "aix",
    android: "android",
    darwin: "darwin",
    freebsd: "freebsd",
    haiku: "haiku",
    linux: "linux",
    openbsd: "openbsd",
    sunos: "sunos",
    win32: "win32",
    cygwin: "cygwin",
    netbsd: "netbsd"
} as const;

export type PlatformInfo = {
    isPackaged: boolean;
    system: ValuesOf<typeof PlatformSystem>;
    arch: NodeJS.Architecture;
    nodeVersion: string;
    pid: number;
    cwd: string;
};

export class Platform {
    public static getInfo(process: NodeJS.Process, isPackaged: boolean): PlatformInfo {
        const system = process.platform;
        const arch = process.arch;
        const nodeVersion = process.versions.node;
        const pid = process.pid;
        const cwd = process.cwd();

        return {
            isPackaged,
            arch,
            cwd,
            nodeVersion,
            pid,
            system
        };
    }
}