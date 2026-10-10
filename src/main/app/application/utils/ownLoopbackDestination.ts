import dns from "dns";
import { refuseOwnLoopbackService, type HostAddressLookup } from "@shared/utils/ownLoopbackGuard";

/**
 * The Studio main process's half of `@shared/utils/ownLoopbackGuard`: the resolver, and where the
 * ports come from.
 *
 * Every request proxy main runs for a renderer at an address the renderer chose takes its
 * destination check from here - the Fetch node's channel and the remote-asset download today. The
 * app is read structurally, for its ports alone, so this module imports nothing of the app's and
 * the agent manager (whose endpoint is one of those ports) stays out of its import graph.
 */

/** What this needs of the app: the loopback ports Studio is serving on right now. */
export type OwnLoopbackPortsSource = {
    ownLoopbackPorts(): readonly number[];
};

/** Every address the system resolver gives for a name, in its own order. */
export const lookupHostAddresses: HostAddressLookup = async hostname => {
    const answers = await dns.promises.lookup(hostname, { all: true, verbatim: true });
    return answers.map(answer => answer.address);
};

/** Why `url` must not be requested on a renderer's behalf, or null. Reads the ports at each call. */
export function refuseOwnLoopbackDestination(
    app: OwnLoopbackPortsSource,
    url: string,
    lookup: HostAddressLookup = lookupHostAddresses,
): Promise<string | null> {
    return refuseOwnLoopbackService(url, app.ownLoopbackPorts(), lookup);
}
