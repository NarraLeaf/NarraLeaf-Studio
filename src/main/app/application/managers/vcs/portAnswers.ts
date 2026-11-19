/**
 * Whether anything is listening at a server's data port, asked without speaking its protocol.
 *
 * **Why this exists.** The backend's status says `remoteAvailable: false` both when nothing
 * answers at the address and when the server answered and turned this account away: measured
 * against a running server with an account it does not know, the read came back unavailable and
 * unauthorized, exactly as it does with the server stopped. Those two want different things from
 * the author (wait, or sign in as someone else), so a status that said unavailable is checked
 * once more here: a port that accepts a connection means the server is there and the refusal was
 * about the account.
 *
 * Only ever asked after a status read already came back unavailable, which has already spent its
 * two seconds; this adds at most {@link PORT_ANSWER_TIMEOUT_MS} to an answer that was going to be
 * bad news anyway.
 */
import net from "net";

export const PORT_ANSWER_TIMEOUT_MS = 1_500;

/** The host and port in an origin like `lore://host:41337`, or null when it names no port. */
export function dataPortOf(remoteOrigin: string): { host: string; port: number } | null {
    let url: URL;
    try {
        url = new URL(remoteOrigin);
    } catch {
        return null;
    }
    const port = Number(url.port);
    const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
    if (host === "" || !Number.isInteger(port) || port <= 0) return null;
    return { host, port };
}

/** Whether a TCP connection to the origin's port is accepted within the timeout. Never throws. */
export function portAnswers(remoteOrigin: string, timeoutMs: number = PORT_ANSWER_TIMEOUT_MS): Promise<boolean> {
    const target = dataPortOf(remoteOrigin);
    if (target === null) return Promise.resolve(false);
    return new Promise((resolve) => {
        const socket = net.connect({ host: target.host, port: target.port });
        let settled = false;
        const settle = (answer: boolean): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.destroy();
            resolve(answer);
        };
        const timer = setTimeout(() => settle(false), timeoutMs);
        socket.once("connect", () => settle(true));
        socket.once("error", () => settle(false));
    });
}
