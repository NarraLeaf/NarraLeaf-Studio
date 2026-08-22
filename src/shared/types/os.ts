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
    HASH_MISMATCH = "HASH_MISMATCH",
}
export type FsRejectError = {
    code: FsRejectErrorCode;
    message: string;
};

export type FsRequestResult<T, OK extends true | false = true | false> = OK extends true ? {
    ok: true;
    data: T;
    /**
     * The mutation never happened: the write gate refused it because the workspace is frozen or its
     * working tree is being re-read.
     *
     * A refusal is reported as success on purpose - see `frozenNoOp` in the privileged facade for
     * why - which leaves the caller unable to tell "written" from "silently dropped". That was
     * harmless while every writer rewrote everything on every save, because the next save covered
     * the gap. It is not harmless to a writer that tracks what it still owes the disk: clearing the
     * debt on a refusal is how an author's edit is lost outright rather than written late.
     *
     * So the refusal carries a flag. Absent means the bytes reached the disk; present means they
     * did not and the write is still owed. Optional, because the ninety-nine writers that do not
     * track debt are correct in ignoring it.
     */
    refused?: true;
} : {
    ok: false;
    error: FsRejectError;
};