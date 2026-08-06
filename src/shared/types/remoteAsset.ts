/**
 * The wire shape of a remote asset fetch, shared by the main-process fetcher and the renderer that
 * asks for it.
 *
 * See `src/main/app/application/managers/remoteAssetFetcher.ts` for why the fetch is in main, and
 * `docs/plans/2026-08-05-003-plan-remote-asset-pinning.md` for the model these serve.
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
