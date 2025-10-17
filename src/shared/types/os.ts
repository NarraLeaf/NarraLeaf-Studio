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
    system: ValuesOf<typeof PlatformSystem>;
    arch: NodeJS.Architecture;
    nodeVersion: string;
    pid: number;
    cwd: string;
};