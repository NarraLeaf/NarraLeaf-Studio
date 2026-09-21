import { describe, expect, it } from "vitest";

import {
    decideProjectSessionClaim,
    parseProjectSessionLockRecord,
    PROJECT_SESSION_LOCK_STALE_MS,
    type ProjectSessionClaimContext,
    type ProjectSessionLockRecord,
} from "./projectSessionLock";

/**
 * The rules that decide whether an author is let into their own project.
 *
 * Pure on purpose (see `decideProjectSessionClaim`), so every one of them is stated here without a
 * filesystem. The manager's own tests cover the same rules end to end through the file.
 */

const NOW = Date.parse("2026-09-01T10:00:00.000Z");

const SELF = { pid: 4242, hostname: "studio-one", installation: "aaaaaaaaaaaaaaaa" };

function context(alive: number[] = [SELF.pid], now = NOW): ProjectSessionClaimContext {
    const running = new Set(alive);
    return { self: SELF, now, isProcessAlive: pid => running.has(pid) };
}

function record(overrides: Partial<ProjectSessionLockRecord> = {}): ProjectSessionLockRecord {
    return {
        pid: 9001,
        hostname: "studio-two",
        installation: "bbbbbbbbbbbbbbbb",
        startedAt: new Date(NOW - 60_000).toISOString(),
        heartbeat: new Date(NOW - 5_000).toISOString(),
        ...overrides,
    };
}

describe("decideProjectSessionClaim", () => {
    it("lets this Studio in when nothing holds the project", () => {
        expect(decideProjectSessionClaim(null, context())).toEqual({ kind: "free" });
    });

    it("recognises the record this very process wrote", () => {
        expect(decideProjectSessionClaim(record({ ...SELF }), context())).toEqual({ kind: "own" });
    });

    it("keeps another machine's Studio out while it is heartbeating", () => {
        expect(decideProjectSessionClaim(record(), context())).toEqual({
            kind: "held",
            holder: { hostname: "studio-two", startedAt: new Date(NOW - 60_000).toISOString(), sameHost: false },
        });
    });

    it("keeps a live Studio on this machine out, whichever profile it runs on", () => {
        // Two profiles on one machine - an installed Studio beside a development one - are as much
        // two writers as two machines are.
        const claim = decideProjectSessionClaim(record({ hostname: SELF.hostname, pid: 7000 }), context([SELF.pid, 7000]));
        expect(claim.kind).toBe("held");
        if (claim.kind === "held") {
            expect(claim.holder.sameHost).toBe(true);
        }
    });

    it("counts a second process on the same profile as another Studio", () => {
        // A development instance is exempt from Electron's single-instance lock, so two processes
        // can share one profile - and one project would still be two writers.
        const claim = decideProjectSessionClaim(
            record({ hostname: SELF.hostname, installation: SELF.installation, pid: 7000 }),
            context([SELF.pid, 7000]),
        );
        expect(claim.kind).toBe("held");
    });

    it("takes over at once from a Studio on this machine whose process is gone", () => {
        // A crash or a kill leaves the record behind with a fresh heartbeat; the missing process is
        // the stronger evidence, and nobody should wait two minutes for a Studio that is not there.
        const claim = decideProjectSessionClaim(record({ hostname: SELF.hostname, pid: 7000 }), context());
        expect(claim.kind).toBe("stale");
    });

    it("does not read another machine's process id against this machine's processes", () => {
        // Process 9001 is not running here, which says nothing about the machine that wrote it.
        expect(decideProjectSessionClaim(record(), context([SELF.pid])).kind).toBe("held");
    });

    it("takes over once the heartbeat has stood still for the whole window", () => {
        const at = (age: number) => decideProjectSessionClaim(
            record({ heartbeat: new Date(NOW - age).toISOString() }),
            context(),
        ).kind;
        expect(at(PROJECT_SESSION_LOCK_STALE_MS)).toBe("held");
        expect(at(PROJECT_SESSION_LOCK_STALE_MS + 1_000)).toBe("stale");
    });

    it("takes over a stale heartbeat on this machine even when the process id is running", () => {
        // A process id can be reused after a crash, so a live id alone does not keep a claim whose
        // heartbeat stopped long ago.
        const claim = decideProjectSessionClaim(
            record({ hostname: SELF.hostname, pid: 7000, heartbeat: new Date(NOW - 3_600_000).toISOString() }),
            context([SELF.pid, 7000]),
        );
        expect(claim.kind).toBe("stale");
    });

    it("does not take a project away because the holder's clock runs ahead", () => {
        const claim = decideProjectSessionClaim(
            record({ heartbeat: new Date(NOW + 10 * 60_000).toISOString() }),
            context(),
        );
        expect(claim.kind).toBe("held");
    });

    it("does not take a project away over a heartbeat it cannot read", () => {
        expect(decideProjectSessionClaim(record({ heartbeat: "yesterday-ish" }), context()).kind).toBe("held");
    });

    it("tells the interface nothing but the machine, the time and whether it is this one", () => {
        const claim = decideProjectSessionClaim(record(), context());
        if (claim.kind !== "held") throw new Error("expected a holder");
        expect(Object.keys(claim.holder).sort()).toEqual(["hostname", "sameHost", "startedAt"]);
    });
});

describe("parseProjectSessionLockRecord", () => {
    it("reads what the manager writes", () => {
        const written = record();
        expect(parseProjectSessionLockRecord(JSON.stringify(written))).toEqual(written);
    });

    it.each([
        ["half-written JSON", "{ \"pid\": 90"],
        ["something other than an object", "[1, 2, 3]"],
        ["a process id that arrived as text", JSON.stringify({ ...record(), pid: "9001" })],
        ["a missing heartbeat", JSON.stringify({ ...record(), heartbeat: undefined })],
    ])("treats %s as no record at all", (_name, content) => {
        // A project nobody can open because of a file nobody can read is the worse failure.
        expect(parseProjectSessionLockRecord(content)).toBeNull();
    });
});
