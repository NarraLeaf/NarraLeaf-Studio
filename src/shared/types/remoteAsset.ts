/**
 * The wire shape of a remote asset fetch, shared by the main-process fetcher and the renderer that
 * asks for it.
 *
 * See `src/main/app/application/managers/remoteAssetFetcher.ts` for why the fetch is in main, and
 * `src/renderer/lib/workspace/services/assets/types.ts` for the model these serve.
 */

/** What the server said about the snapshot the caller already holds. */
export interface RemoteAssetValidators {
    etag?: string;
    lastModified?: string;
}

/**
 * A fetch that produced bytes.
 *
 * `bytes` crosses the IPC boundary, so it must survive structured clone - a `Uint8Array` does.
 */
export interface RemoteAssetBytes {
    kind: "ok";
    bytes: Uint8Array;
    etag?: string;
    lastModified?: string;
    /** Diagnostic only; the format gate reads the bytes rather than believing this. */
    contentType?: string;
}

/** The server answered 304: the caller's snapshot is still what the URL serves. */
export interface RemoteAssetNotModified {
    kind: "not-modified";
}

export type RemoteAssetFetchResult = RemoteAssetBytes | RemoteAssetNotModified;

/**
 * Why the main process could not fetch a remote asset, as the `code` a failed `assetFetchRemote`
 * carries.
 *
 * The fetcher's own message is English and quotes the server's status line, the URL and the byte
 * counts - written for the log. The renderer words the failure from this code instead, the way it
 * words a file write from `FsRejectErrorCode`. The constants the sentences need (the time limit, the
 * size ceiling) are shared, so the code is the whole of what has to cross.
 */
export enum RemoteAssetFetchErrorCode {
    /** The address does not parse as a URL. */
    InvalidUrl = "REMOTE_INVALID_URL",
    /** A URL, but not an http or https one. */
    UnsupportedScheme = "REMOTE_UNSUPPORTED_SCHEME",
    /** The project is not trusted, and a download is an effect it does not get. */
    Distrusted = "REMOTE_DISTRUSTED",
    /** No answer at all: the host does not resolve, refused the connection, or failed the handshake. */
    Unreachable = "REMOTE_UNREACHABLE",
    /** The server did not answer within `REMOTE_ASSET_FETCH_TIMEOUT_MS`. */
    Timeout = "REMOTE_TIMEOUT",
    /** 404 or 410: there is nothing at the address. */
    NotFound = "REMOTE_NOT_FOUND",
    /** 401, 403 or 407: the file is there and the server will not hand it over. */
    AccessDenied = "REMOTE_ACCESS_DENIED",
    /** Any 5xx: the server failed, which is worth trying again later. */
    ServerError = "REMOTE_SERVER_ERROR",
    /** Any other status that is not a success. */
    Refused = "REMOTE_REFUSED",
    /** Larger than `REMOTE_ASSET_MAX_BYTES`, declared or measured. */
    TooLarge = "REMOTE_TOO_LARGE",
}

/** Which code a response status that is not a success earns. */
export function remoteFetchCodeForStatus(status: number): RemoteAssetFetchErrorCode {
    if (status === 404 || status === 410) {
        return RemoteAssetFetchErrorCode.NotFound;
    }
    if (status === 401 || status === 403 || status === 407) {
        return RemoteAssetFetchErrorCode.AccessDenied;
    }
    if (status >= 500 && status <= 599) {
        return RemoteAssetFetchErrorCode.ServerError;
    }
    return RemoteAssetFetchErrorCode.Refused;
}

const REMOTE_FETCH_CODES: ReadonlySet<string> = new Set(Object.values(RemoteAssetFetchErrorCode));

/** Whether a `RequestStatus.code` is one of the fetcher's. Anything else is worded as no reason at all. */
export function isRemoteAssetFetchErrorCode(code: unknown): code is RemoteAssetFetchErrorCode {
    return typeof code === "string" && REMOTE_FETCH_CODES.has(code);
}
