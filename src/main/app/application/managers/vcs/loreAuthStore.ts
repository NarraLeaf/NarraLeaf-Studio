import { mkdirSync } from "fs";
import path from "path";

/**
 * Where the version-control library keeps the tokens it signs in with, and how it seals them.
 *
 * **Why Studio chooses rather than leaving the library's default.** On macOS the library keeps
 * the key that seals its tokens in the login keychain, and it writes that keychain item again
 * every time it seals a token - the key travels with a counter it advances on each seal. Every
 * sign-in, every renewal and every token presented again is therefore a keychain write. Studio
 * is not signed with a stable identity, so the keychain cannot remember that it was allowed: the
 * author was asked for their password to let Studio use the keychain over and over while working,
 * and again after every update.
 *
 * The library has a setting for this, `LORE_AUTH_STORE=fallback`, which keeps the key in a file
 * beside the tokens instead. The file is put under Studio's own data directory, which only this
 * account can open, and that is the same protection the tokens themselves already had: the
 * keychain item stood between them and other programs running as this account only for as long
 * as nobody pressed "Always Allow".
 *
 * **A store of Studio's own, not the shared one.** The library's default directory is shared with
 * every other program built on it, and a key already written there may be one whose counter is
 * behind the copy in the keychain; sealing again from it would reuse a nonce. A directory nobody
 * else writes starts with a fresh key. What it costs is that a sign-in made elsewhere is not seen
 * here, and Studio does not need one: it holds every token it signed in with and presents it again
 * when the library has none (see `VcsManager.withServerSession` and `confirmStoredSession`).
 *
 * Windows and Linux are left as they are. Their stores do not ask anybody anything.
 *
 * Either variable already set - by a test, or by somebody who knows what they want - is left
 * alone. The library reads both on every call, so this has to run before anything reaches it,
 * and it does: `VcsManager.initialize` calls it first, and nothing loads the library eagerly.
 */
export function configureLoreAuthStore(
    userDataDir: string,
    platform: NodeJS.Platform = process.platform,
    env: NodeJS.ProcessEnv = process.env,
): void {
    if (platform !== "darwin") return;
    if (!env.LORE_AUTH_PATH) {
        const directory = loreAuthDirectory(userDataDir);
        try {
            mkdirSync(directory, { recursive: true, mode: 0o700 });
        } catch {
            // The library creates it itself on the first write; this only sets its mode.
        }
        env.LORE_AUTH_PATH = directory;
    }
    if (!env.LORE_AUTH_STORE) env.LORE_AUTH_STORE = "fallback";
}

/** The directory the library's token store is kept in on macOS. */
export function loreAuthDirectory(userDataDir: string): string {
    return path.join(userDataDir, "lore-auth");
}
