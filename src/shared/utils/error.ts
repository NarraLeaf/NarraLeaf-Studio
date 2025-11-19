import { FsRequestResult } from "@shared/types/os";
import { Result } from "./types";
import { RequestStatus } from "@shared/types/ipcEvents";

export class RendererError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RendererError';
    }
}

export function throwException<T>(value: FsRequestResult<T> | RequestStatus<T>): T {
    if (("ok" in value && value.ok === false) || ("success" in value && value.success === false)) {
        if (!value.error) {
            throw new RendererError("Unknown error: " + JSON.stringify(value));
        }
        const error = typeof value.error === "string" ? value.error : value.error.message;
        throw new RendererError(error);
    }
    return value.data;
}

