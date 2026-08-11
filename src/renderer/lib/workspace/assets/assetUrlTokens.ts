import { AppHost, AppProtocol } from "@shared/types/constants";

/**
 * Reverse lookup for `app://fs/{token}` URLs: which asset the renderer minted a token for.
 *
 * ## Why a table is the only way
 *
 * A token is a capability grant, not a content address. `StorageManager.allocateHash` mints it from
 * `crypto.randomBytes(32)`, so it carries no information about the file whatsoever - the asset id is
 * not recoverable from the string by any amount of work. The Dev Mode path re-keys the same grant to
 * a token derived from (resolved path, size, mtime), which is reproducible but still says nothing
 * about which library row the file belongs to, and stops matching the moment the file is replaced.
 *
 * So the mapping has to be *recorded*, and there is exactly one instant at which both halves of it
 * are true at the same time: when {@link createWorkspaceAssetUrlResolver} turns an asset id into a
 * URL. That is where {@link recordAssetUrlToken} is called from, and recording it anywhere else
 * would be recording a guess.
 *
 * ## What would make it lie
 *
 *  - **Persisting it.** Tokens die with the process: the grant table is an in-memory `Map` in the
 *    main process, and a one-shot grant is destroyed by its first successful read. A table that
 *    survived a restart would answer for tokens that no longer address anything, and a *stable* Dev
 *    Mode token re-derives to a different value once the asset's bytes change - so a stored entry
 *    would claim a live reference for a URL that is already dead. Hence memory only, and cleared
 *    with the resolver that filled it.
 *  - **Recording before the read succeeds.** A failed grant request yields no usable token; only a
 *    URL that was actually handed out is a fact.
 *  - **Deriving the Dev Mode token here.** Re-implementing the main process's hash formula in the
 *    renderer would be a second copy of it, and the two would disagree the first time path
 *    normalization differed. Dev Mode re-keys grants for the running game's own fetches; nothing in
 *    that window writes project documents, so a document can only hold a token this table minted.
 *
 * A token this table has never seen is therefore unresolvable, and the index reports that as a
 * coverage gap rather than as "no reference" - see `referenceModel.ts`.
 */

const APP_FS_URL_PREFIX = `${AppProtocol}://${AppHost.Fs}/`;

const assetIdByToken = new Map<string, string>();

/**
 * The grant token in an `app://fs/{token}` URL, or null when the value is not one.
 *
 * Only the first path segment is the token: a model bundle resolves to `app://fs/{token}/{entry}`,
 * whose remainder addresses a file inside the granted directory.
 */
export function parseAssetUrlToken(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed.startsWith(APP_FS_URL_PREFIX)) {
        return null;
    }
    const rest = trimmed.slice(APP_FS_URL_PREFIX.length);
    const separator = rest.search(/[/?#]/);
    const token = separator === -1 ? rest : rest.slice(0, separator);
    return token || null;
}

/** Record that `token` was minted for `assetId`. Called only where both are known to be true. */
export function recordAssetUrlToken(token: string, assetId: string): void {
    if (!token || !assetId) {
        return;
    }
    assetIdByToken.set(token, assetId);
}

/** The asset a URL token was minted for, or null when this session never minted it. */
export function lookupAssetIdForToken(token: string): string | null {
    return assetIdByToken.get(token) ?? null;
}

/** The asset an `app://fs/…` URL points at, or null when the value is not one, or is unknown. */
export function lookupAssetIdForUrl(value: unknown): string | null {
    const token = parseAssetUrlToken(value);
    return token ? lookupAssetIdForToken(token) : null;
}

/** Drop every recorded token. Used when the workspace tears down, and by tests. */
export function clearAssetUrlTokens(): void {
    assetIdByToken.clear();
}
