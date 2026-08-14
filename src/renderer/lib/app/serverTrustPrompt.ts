import type { ServerTrustPromptProps } from "@shared/types/serverTrust";
import { getInterface } from "./bridge";

/**
 * Ask whether a server is trusted, and answer with what this machine believes afterwards.
 *
 * The whole surface a Studio window needs: one call, one boolean. A transport failure
 * reads the same as a window closed without answering, because nothing was trusted either
 * way and a caller that has to tell those apart is doing something other than deciding
 * whether to go on.
 */
export async function promptServerTrust(props: ServerTrustPromptProps): Promise<boolean> {
    const result = await getInterface().app.promptServerTrust(props);
    return result.success && result.data.trusted;
}

declare global {
    interface Window {
        __NLS_SERVER_TRUST__?: (props: ServerTrustPromptProps) => Promise<boolean>;
    }
}

/**
 * Development builds only: one named way to raise the window from the console.
 *
 * The renderer bridge is revoked at the end of boot (`hardenRendererBridge`), so nothing
 * on `window` can reach this call once a window has painted, and the window itself is
 * raised by a certificate a verification run has no way to arrange. Reading what it says
 * therefore needs a door, and this is the narrowest one that exists: it opens the
 * question and hands back the answer. The `__NLS_STUDIO_DEV__` define gates the call
 * site, so it is dropped from production bundles.
 */
export function installServerTrustDevHook(): void {
    if (typeof window === "undefined" || window.__NLS_SERVER_TRUST__) {
        return;
    }
    window.__NLS_SERVER_TRUST__ = promptServerTrust;
}
