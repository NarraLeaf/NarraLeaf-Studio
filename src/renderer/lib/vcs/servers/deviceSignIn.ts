import { getInterface } from "@/lib/app/bridge";
import type { VcsBrowserSignInOutcome, VcsDeviceSignInStart } from "@shared/types/vcs";

/**
 * Signing in with a device code (RFC 8628), over the three calls that carry it.
 *
 * For a machine whose browser cannot reach back to Studio - a remote desktop, a locked-down
 * network, a browser on another device: the server shows a page, the person types the code
 * shown here into it, and Studio collects the token once they approve. Like the browser
 * sign-in, nothing secret crosses here but the token coming out.
 */
export interface DeviceSignIn {
    start(request: { authUrl: string }): Promise<VcsDeviceSignInStart>;
    finish(): Promise<VcsBrowserSignInOutcome>;
    cancel(): void;
}

export const deviceSignIn: DeviceSignIn = {
    async start({ authUrl }) {
        const answer = await getInterface().vcs.startDeviceSignIn(authUrl).catch(() => null);
        if (answer === null || !answer.success) return { ok: false, reason: "unknown" };
        return answer.data;
    },
    async finish() {
        const answer = await getInterface().vcs.finishDeviceSignIn().catch(() => null);
        if (answer === null || !answer.success) return { ok: false, reason: "unknown" };
        return answer.data;
    },
    cancel() {
        void getInterface().vcs.cancelDeviceSignIn().catch(() => null);
    },
};
