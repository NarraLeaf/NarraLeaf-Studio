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

export enum FsRejectErrorCode {
    NOT_FOUND = "NOT_FOUND",
    PERMISSION_DENIED = "PERMISSION_DENIED",
    INVALID_PATH = "INVALID_PATH",
    FILE_TOO_LARGE = "FILE_TOO_LARGE",
    NOT_A_FILE = "NOT_A_FILE",
    NOT_A_DIR = "NOT_A_DIR",
    IO_ERROR = "IO_ERROR",
    IPC_ERROR = "IPC_ERROR",
    INVALID_JSON = "INVALID_JSON",
    UNKNOWN = "UNKNOWN",
}
export type FsRejectError = {
    code: FsRejectErrorCode;
    message: string;
};

export type FsRequestResult<T, OK extends true | false = true | false> = OK extends true ? {
    ok: true;
    data: T;
} : {
    ok: false;
    error: FsRejectError;
};