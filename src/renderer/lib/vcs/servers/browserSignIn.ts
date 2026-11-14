import { getInterface } from "@/lib/app/bridge";
import type { VcsBrowserSignInOutcome } from "@shared/types/vcs";

/**
 * Signing in through the system browser, over the one call that does it.
 *
 * Handed to the dialogs that offer signing in the same way the password transport is, so
 * the identity step stays a working interface where no transport exists. Nothing secret
 * crosses here at all: the endpoint goes in, a token comes out, and the refresh token that
 * keeps the sign-in alive stays in the main process.
 */
export async function signInWithBrowser(request: { authUrl: string }): Promise<VcsBrowserSignInOutcome> {
    const answer = await getInterface().vcs.signInWithBrowser(request.authUrl).catch(() => null);
    if (answer === null || !answer.success) return { ok: false, reason: "unknown" };
    return answer.data;
}
