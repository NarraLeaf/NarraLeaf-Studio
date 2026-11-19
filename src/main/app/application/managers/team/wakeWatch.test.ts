/**
 * When the Team sessions are told to start over.
 *
 * Driven with fake timers and stand-in sources: what is decided here is which changes count as a
 * wake, and that two signals for the same wake do not tear down a session that is still opening.
 */
import { EventEmitter } from "events";
import os from "os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { interfaceSignature, watchWake, type WakeReason, type WakeSources } from "./wakeWatch";

function sources(overrides: Partial<WakeSources> = {}): WakeSources & { emitter: EventEmitter } {
    const emitter = new EventEmitter();
    return {
        emitter,
        power: {
            on: (event, listener) => emitter.on(event, listener),
            removeListener: (event, listener) => emitter.removeListener(event, listener),
        },
        isOnline: () => true,
        networkSignature: () => "en0/192.168.1.2",
        everyMs: 5_000,
        now: () => Date.now(),
        ...overrides,
    };
}

describe("hearing a wake", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("takes a resume and an unlock, and stops listening when told", () => {
        const heard: WakeReason[] = [];
        const watched = sources();
        const stop = watchWake(watched, (reason) => heard.push(reason));

        watched.emitter.emit("resume");
        vi.advanceTimersByTime(3_000);
        watched.emitter.emit("unlock-screen");
        expect(heard).toEqual(["resume", "unlock"]);

        stop();
        expect(watched.emitter.listenerCount("resume")).toBe(0);
        expect(watched.emitter.listenerCount("unlock-screen")).toBe(0);
    });

    it("counts two signals for one wake once", () => {
        const heard: WakeReason[] = [];
        const watched = sources();
        watchWake(watched, (reason) => heard.push(reason));

        watched.emitter.emit("resume");
        watched.emitter.emit("unlock-screen");
        expect(heard).toEqual(["resume"]);
    });

    it("notices coming back online and moving to another network", () => {
        const heard: WakeReason[] = [];
        let online = false;
        let signature = "";
        watchWake(sources({ isOnline: () => online, networkSignature: () => signature }), (reason) => heard.push(reason));

        vi.advanceTimersByTime(5_000);
        expect(heard).toEqual([]);

        online = true;
        signature = "en0/192.168.1.2";
        vi.advanceTimersByTime(5_000);
        expect(heard).toEqual(["online"]);

        signature = "en0/10.0.0.7";
        vi.advanceTimersByTime(5_000);
        expect(heard).toEqual(["online", "network"]);

        // Nothing changed, nothing heard.
        vi.advanceTimersByTime(20_000);
        expect(heard).toEqual(["online", "network"]);
    });

    it("says nothing about a network that went away, only about one that came back", () => {
        const heard: WakeReason[] = [];
        let online = true;
        watchWake(sources({ isOnline: () => online }), (reason) => heard.push(reason));
        online = false;
        vi.advanceTimersByTime(5_000);
        expect(heard).toEqual([]);
    });

    it("takes a tick that came far too late as a sleep nobody announced", () => {
        const heard: WakeReason[] = [];
        let clock = 0;
        watchWake(sources({ now: () => clock }), (reason) => heard.push(reason));

        clock = 5_000;
        vi.advanceTimersByTime(5_000);
        expect(heard).toEqual([]);

        clock = 5_000 + 10 * 60_000;
        vi.advanceTimersByTime(5_000);
        expect(heard).toEqual(["slept"]);
    });
});

describe("the network's signature", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    function entry(address: string, internal = false): os.NetworkInterfaceInfo {
        return { address, internal, family: address.includes(":") ? "IPv6" : "IPv4", netmask: "", mac: "", cidr: null, scopeid: 0 } as os.NetworkInterfaceInfo;
    }

    it("leaves out loopback and link-local addresses, which come and go without the network moving", () => {
        vi.spyOn(os, "networkInterfaces").mockReturnValue({
            lo0: [entry("127.0.0.1", true)],
            en0: [entry("192.168.1.2"), entry("fe80::1")],
            awdl0: [entry("fe80::abcd")],
            llw0: [entry("FE80::ef")],
            bridge0: [entry("169.254.3.4")],
        });
        expect(interfaceSignature()).toBe("en0/192.168.1.2");
    });

    it("reads the same whatever order the OS lists interfaces in", () => {
        vi.spyOn(os, "networkInterfaces").mockReturnValueOnce({
            en1: [entry("10.0.0.5")],
            en0: [entry("192.168.1.2")],
        }).mockReturnValueOnce({
            en0: [entry("192.168.1.2")],
            en1: [entry("10.0.0.5")],
        });
        expect(interfaceSignature()).toBe(interfaceSignature());
    });
});
