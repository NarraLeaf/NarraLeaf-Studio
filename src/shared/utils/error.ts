import { FsRequestResult } from "@shared/types/os";
import { Result } from "./types";
import { RequestStatus } from "@shared/types/ipcEvents";

export class RendererError extends Error {
    /**
     * `options` is forwarded so a re-throw can keep the original as its `cause`.
     *
     * This class is the renderer's outer wrapper: a service catches whatever a document reader threw
     * and re-throws it with a message a caller can show. Without a cause that is a one-way door -
     * the sentence survives and the value does not, so a caller that wants to *act* on a particular
     * failure has to match on English text. Passing the cause through costs nothing and keeps that
     * option open; nothing is required to look at it.
     */
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
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

