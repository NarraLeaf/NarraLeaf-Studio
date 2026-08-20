/**
 * The token this installation signs in to a server with, kept so that Studio can
 * ask that server questions later.
 *
 * **This is a change of mind, and it is worth saying why.** Signing in used to
 * hand the token straight to the Lore backend's own store and keep nothing:
 * the backend was the only thing that ever needed it, so the safest place for
 * it was somewhere Studio could not read. That stopped being true when the
 * server grew an API of its own — which projects are on it, and making another
 * — because those are asked over HTTPS by this process, with the token as the
 * whole of the authentication, at moments long after the author pasted it.
 *
 * So it is kept, and it is sealed: `safeStorage` puts it behind the OS keyring
 * (DPAPI on Windows, the Keychain on macOS), and what lands in the global state
 * is ciphertext. A machine where sealing is unavailable keeps nothing rather
 * than writing a bearer token in the clear — the features that need it then say
 * they cannot, which is the honest failure.
 *
 * It never crosses to the renderer. `VcsManager` reads it, uses it on a request
 * it makes itself, and hands back the answer; nothing here is exposed over IPC.
 */
import { safeStorage } from "electron";

/**
 * The two operations this needs from the global state, named rather than the
 * whole manager: it is what makes a test able to drive this with a plain map.
 */
export interface TokenStore {
    get: (key: "versionControl.serverTokens") => unknown;
    set: (key: "versionControl.serverTokens", value: Record<string, string>) => void;
}

/** The subset of Electron's `safeStorage` this needs. Injected so a test can drive it. */
export interface SecretSealer {
    isEncryptionAvailable: () => boolean;
    encryptString: (plainText: string) => Buffer;
    decryptString: (encrypted: Buffer) => string;
}

/** The real one. */
export const electronSealer: SecretSealer = {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (plainText: string) => safeStorage.encryptString(plainText),
    decryptString: (encrypted: Buffer) => safeStorage.decryptString(encrypted),
};

/**
 * Where the sealed tokens live, keyed by the server's data origin.
 *
 * The same key the sessions are kept under, so one server is one entry in both
 * and forgetting it clears both.
 */
const KEY = "versionControl.serverTokens";

function sealedTokens(state: TokenStore): Record<string, string> {
    const stored: unknown = state.get(KEY);
    if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return {};
    const entries = Object.entries(stored as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string");
    return Object.fromEntries(entries);
}

/**
 * Seal a token for one server, or record that there is none to seal.
 *
 * A machine that cannot seal keeps nothing. The alternative — writing it as it
 * is — would put a bearer token that lasts a month into a JSON file any program
 * running as this user can read, in exchange for a convenience.
 */
export function rememberServerToken(
    state: TokenStore,
    remoteOrigin: string,
    token: string,
    sealer: SecretSealer = electronSealer,
): boolean {
    if (!sealer.isEncryptionAvailable()) return false;
    const tokens = sealedTokens(state);
    tokens[remoteOrigin] = sealer.encryptString(token).toString("base64");
    state.set(KEY, tokens);
    return true;
}

/**
 * The token for one server, or null when there is none this process can read.
 *
 * Null covers every way that can happen and they are not worth telling apart
 * here: no entry, a machine that cannot unseal, or ciphertext written under a
 * key this OS profile no longer has. Each of them means the same thing to the
 * caller — ask the author for the token again.
 */
export function recallServerToken(
    state: TokenStore,
    remoteOrigin: string,
    sealer: SecretSealer = electronSealer,
): string | null {
    const sealed = sealedTokens(state)[remoteOrigin];
    if (sealed === undefined || !sealer.isEncryptionAvailable()) return null;
    try {
        const token = sealer.decryptString(Buffer.from(sealed, "base64"));
        return token === "" ? null : token;
    } catch {
        return null;
    }
}

/** Drop the token for one server. Called wherever its session is forgotten. */
export function forgetServerToken(state: TokenStore, remoteOrigin: string): void {
    const tokens = sealedTokens(state);
    if (!(remoteOrigin in tokens)) return;
    delete tokens[remoteOrigin];
    state.set(KEY, tokens);
}
