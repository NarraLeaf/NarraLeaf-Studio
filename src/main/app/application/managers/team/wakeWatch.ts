/**
 * When the machine has woken up or moved to another network, so the Team sessions start over now
 * rather than whenever their backoff next comes round.
 *
 * **Why this is needed at all.** A socket that died while the lid was shut is not noticed until
 * something is written to it and fails, and a session that had already backed off to a minute
 * between tries keeps waiting out that minute after the network is back. Both read to the author
 * as "Team is broken" for as long as it lasts.
 *
 * Electron says when the machine resumes or the screen unlocks. It says nothing when the network
 * changes, so that is noticed by looking: every few seconds, whether the machine is online and
 * which addresses its interfaces hold. A tick that arrives far later than it was due is a sleep
 * nothing announced, which is taken as a wake too.
 */
import os from "os";

import { net, powerMonitor } from "electron";

/** The part of Electron's `powerMonitor` this listens to. */
export interface PowerEvents {
    // One overload per event rather than a union, so Electron's own overloaded signature fits.
    on(event: "resume", listener: () => void): unknown;
    on(event: "unlock-screen", listener: () => void): unknown;
    removeListener(event: "resume", listener: () => void): unknown;
    removeListener(event: "unlock-screen", listener: () => void): unknown;
}

export interface WakeSources {
    /** Null where there is no power monitor to listen to. */
    power: PowerEvents | null;
    isOnline: () => boolean;
    /** Something that changes when the machine's network does. */
    networkSignature: () => string;
    /** How often the network is looked at. */
    everyMs: number;
    now?: () => number;
}

export type WakeReason = "resume" | "unlock" | "online" | "network" | "slept";

/** How long after one start-over another is not worth making: the first is still opening. */
const SETTLE_MS = 2_000;

/**
 * The addresses this machine holds now, in an order that does not depend on the OS.
 *
 * Link-local addresses are left out. macOS brings AirDrop's `awdl0` and `llw0` up and down on
 * its own, each with an `fe80::` address, and counting them would start every session over
 * whenever a phone nearby looked for something to share. No Team server is reached over one.
 */
export function interfaceSignature(): string {
    const addresses: string[] = [];
    for (const [name, entries] of Object.entries(os.networkInterfaces())) {
        for (const entry of entries ?? []) {
            if (entry.internal) continue;
            if (/^fe80:/i.test(entry.address) || entry.address.startsWith("169.254.")) continue;
            addresses.push(`${name}/${entry.address}`);
        }
    }
    return addresses.sort().join(",");
}

/**
 * The real sources, read from Electron.
 *
 * Read when called rather than when this file loads: `powerMonitor` may not be used before the app
 * is ready, and the manager only calls this once a session exists, which is after a window has.
 */
export function electronWakeSources(): WakeSources {
    return {
        power: powerMonitor ?? null,
        isOnline: () => (typeof net?.isOnline === "function" ? net.isOnline() : interfaceSignature() !== ""),
        networkSignature: interfaceSignature,
        everyMs: 5_000,
    };
}

/**
 * Call `onWake` whenever the machine wakes or its network changes. Answers with the way to stop.
 */
export function watchWake(sources: WakeSources, onWake: (reason: WakeReason) => void): () => void {
    const now = sources.now ?? Date.now;
    let online = safely(sources.isOnline, true);
    let signature = safely(sources.networkSignature, "");
    let lastTick = now();
    let lastWake = Number.NEGATIVE_INFINITY;

    const wake = (reason: WakeReason): void => {
        const at = now();
        if (at - lastWake < SETTLE_MS) return;
        lastWake = at;
        onWake(reason);
    };
    const resumed = (): void => wake("resume");
    const unlocked = (): void => wake("unlock");

    sources.power?.on("resume", resumed);
    sources.power?.on("unlock-screen", unlocked);

    const timer = setInterval(() => {
        const at = now();
        const slept = at - lastTick > sources.everyMs * 3;
        lastTick = at;
        const nowOnline = safely(sources.isOnline, online);
        const nowSignature = safely(sources.networkSignature, signature);
        const cameOnline = nowOnline && !online;
        const moved = nowOnline && nowSignature !== signature;
        online = nowOnline;
        signature = nowSignature;
        if (cameOnline) wake("online");
        else if (moved) wake("network");
        else if (slept && nowOnline) wake("slept");
    }, sources.everyMs);
    timer.unref?.();

    return () => {
        clearInterval(timer);
        sources.power?.removeListener("resume", resumed);
        sources.power?.removeListener("unlock-screen", unlocked);
    };
}

function safely<T>(read: () => T, fallback: T): T {
    try {
        return read();
    } catch {
        return fallback;
    }
}
