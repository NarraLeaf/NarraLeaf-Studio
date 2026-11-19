/**
 * How far away a Team server is: the round trip of `server.ping`, timed from here.
 *
 * The same reading the server's own console shows, so the two figures can be compared: a ping
 * every {@link PING_EVERY_MS} while the window is visible, and the figure drawn is the middle of the
 * last {@link PING_WINDOW}, so one slow answer does not make it jump. It is timed around the whole
 * call, which crosses the window's IPC to the main process as well as the socket, so it reads a
 * millisecond or so above what the console shows for the same server.
 *
 * `server.ping` reads and writes nothing on the server, so asking every few seconds costs nothing.
 * A server too old to know it answers `unknown-method` or `unsupported`, and is not asked again
 * for the rest of the session: there is nothing to draw, and asking would only fill its log.
 *
 * ⚠ **Paused while the window is hidden.** A hidden window's timers are throttled, so a figure
 * timed then would mostly measure the throttling - and nobody is looking at it.
 */
import { useEffect, useState } from "react";

import { TeamMethod } from "@shared/types/team";

import { teamCall } from "./teamCall";
import { useTeamConnection } from "./useTeam";

export const PING_EVERY_MS = 5_000;
export const PING_WINDOW = 5;

export interface TeamLatency {
    /** The middle of the last few round trips, in whole milliseconds. */
    median: number;
    /** The latest round trip, in whole milliseconds. */
    last: number;
}

/** How the figure reads at a glance, on the same steps as the server's console. */
export type TeamLatencyTone = "ok" | "slow" | "bad";

export function teamLatencyTone(median: number): TeamLatencyTone {
    return median < 150 ? "ok" : median < 400 ? "slow" : "bad";
}

/** The middle of a set of samples, rounded. */
export function medianOf(samples: readonly number[]): number {
    const sorted = [...samples].sort((a, b) => a - b);
    return Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0);
}

/**
 * The round trip to one server, or null where there is none to show: no server, not connected,
 * switched off, or a server that does not answer `server.ping`.
 */
export function useTeamLatency(remoteOrigin: string | null, enabled: boolean): TeamLatency | null {
    const connection = useTeamConnection(enabled ? remoteOrigin : null);
    const ready = connection.state === "ready";
    const [latency, setLatency] = useState<TeamLatency | null>(null);

    useEffect(() => {
        setLatency(null);
        if (!enabled || !ready || remoteOrigin === null) {
            return;
        }
        let alive = true;
        let stopped = false;
        let inFlight = false;
        const samples: number[] = [];

        const once = async () => {
            if (!alive || stopped || inFlight) return;
            if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
            inFlight = true;
            const started = performance.now();
            const answered = await teamCall(remoteOrigin, TeamMethod.serverPing, { sent: Date.now() });
            const took = performance.now() - started;
            inFlight = false;
            if (!alive) return;
            if (!answered.ok) {
                const problem = answered.problem;
                if (problem.kind === "unsupported" || (problem.kind === "refused" && problem.code === "unknown-method")) {
                    stopped = true;
                    setLatency(null);
                }
                // Any other failure is the connection's to report; the last figure stays until the
                // connection itself is no longer ready, which clears it.
                return;
            }
            samples.push(took);
            if (samples.length > PING_WINDOW) samples.shift();
            setLatency({ median: medianOf(samples), last: Math.round(took) });
        };

        void once();
        const timer = setInterval(() => void once(), PING_EVERY_MS);
        const onShow = () => {
            if (document.visibilityState === "visible") void once();
        };
        document.addEventListener("visibilitychange", onShow);
        return () => {
            alive = false;
            clearInterval(timer);
            document.removeEventListener("visibilitychange", onShow);
        };
    }, [enabled, ready, remoteOrigin, connection.since]);

    return latency;
}
