import { getInterface } from "@/lib/app/bridge";
import type { VcsPasswordSignInOutcome } from "@shared/types/vcs";

/**
 * Turning a username and a password into a token, over the one call that can carry them.
 *
 * The dialog that asks for them takes this as a parameter rather than reaching for it, so
 * that the identity step is a working interface even where no transport exists. This is
 * the transport: the main process owns every socket Studio opens, so the pair crosses the
 * bridge once and a token comes back.
 *
 * **Written once and handed to every surface that offers signing in.** There is one way a
 * password becomes a token, and a second copy of this would be a second place for the
 * reading of a refusal to drift.
 *
 * It is typed against the shared outcome rather than against the dialog's own seam, which
 * is the same shape: this is `lib`, and a module here that imported an app would invert
 * the one direction the two are allowed to depend in.
 *
 * Nothing here keeps the password. It is an argument, it is one field of one call, and it
 * is gone when this resolves - including out of what is handed back, which carries a
 * reason and never an echo of what was typed.
 */
export async function signInWithPassword(request: {
    authUrl: string;
    username: string;
    password: string;
}): Promise<VcsPasswordSignInOutcome> {
    const answer = await getInterface().vcs
        .signInWithPassword(request.authUrl, request.username, request.password)
        .catch(() => null);
    // A call that never completed is the same to a reader as one that could not be read:
    // there is nothing they would do differently, and both get the last sentence.
    if (answer === null || !answer.success) return { ok: false, reason: "unknown" };
    return answer.data;
}
