import { describe, expect, it } from "vitest";

import path from "path";

import {
    claimsDirectory,
    decideHeldProjectSession,
    decideProjectSessionClaim,
    digestProjectDirectory,
    parseProjectSessionLockRecord,
    PROJECT_SESSION_LOCK_STALE_MS,
    type HeldProjectSessionContext,
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

/** The folder the record is found in, and another one it could have been copied from. */
const HERE = "1111111111111111";
const ELSEWHERE = "2222222222222222";

function context(alive: number[] = [SELF.pid], now = NOW): ProjectSessionClaimContext {
    const running = new Set(alive);
    return { self: SELF, now, isProcessAlive: pid => running.has(pid), directory: HERE };
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
        expect(claim).toMatchObject({ kind: "stale", holderRunning: false });
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

    it("says when the silent holder's process is still running here, so the takeover can look again first", () => {
        // A Studio on this machine whose heartbeat is old but whose process runs is the one that may
        // merely be late - every process on a computer that has just woken is. The manager waits one
        // heartbeat for it before acting on this answer.
        const claim = decideProjectSessionClaim(
            record({ hostname: SELF.hostname, pid: 7000, heartbeat: new Date(NOW - PROJECT_SESSION_LOCK_STALE_MS - 5_000).toISOString() }),
            context([SELF.pid, 7000]),
        );
        expect(claim).toMatchObject({ kind: "stale", holderRunning: true });
    });

    it("never says another machine's holder is running, because nothing here can know", () => {
        const claim = decideProjectSessionClaim(
            record({ pid: SELF.pid, heartbeat: new Date(NOW - PROJECT_SESSION_LOCK_STALE_MS - 5_000).toISOString() }),
            // The remote record's pid happens to be running here - which says nothing about it.
            context([SELF.pid]),
        );
        expect(claim).toMatchObject({ kind: "stale", holderRunning: false });
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

/**
 * A lock found in a folder that is a copy of an open project: an Explorer copy, a backup, a zip.
 *
 * The file came with the folder, and names a Studio that is running and heartbeating - on the
 * folder it was copied from. Until records said which folder they claim, the copy could not be
 * opened until that frozen heartbeat went stale.
 */
describe("decideProjectSessionClaim on a copy of an open project", () => {
    /** A live Studio on this machine, holding another folder. */
    function copiedFromLiveStudio(overrides: Partial<ProjectSessionLockRecord> = {}): ProjectSessionLockRecord {
        return record({ hostname: SELF.hostname, pid: 7000, directory: ELSEWHERE, ...overrides });
    }

    it("is not held by a claim on another folder of this machine, however alive its holder is", () => {
        expect(decideProjectSessionClaim(copiedFromLiveStudio(), context([SELF.pid, 7000]))).toEqual({ kind: "copied" });
    });

    it("is held by the same record found in the folder it names", () => {
        const claim = decideProjectSessionClaim(copiedFromLiveStudio({ directory: HERE }), context([SELF.pid, 7000]));
        expect(claim.kind).toBe("held");
    });

    it("reads a record this very process wrote on another folder as a copy, not as its own claim", () => {
        expect(decideProjectSessionClaim(record({ ...SELF, directory: ELSEWHERE }), context())).toEqual({ kind: "copied" });
    });

    it("takes a claim from another machine at its word, whatever folder it names", () => {
        // The same project through a sync client, or a share mounted at another path, is one folder
        // under two paths on two machines - exactly the second writer the lock exists to keep out.
        expect(decideProjectSessionClaim(record({ directory: ELSEWHERE }), context()).kind).toBe("held");
    });

    it("lets a copy carrying another machine's claim in once that frozen heartbeat is stale", () => {
        const claim = decideProjectSessionClaim(
            record({ directory: ELSEWHERE, heartbeat: new Date(NOW - PROJECT_SESSION_LOCK_STALE_MS - 5_000).toISOString() }),
            context(),
        );
        expect(claim.kind).toBe("stale");
    });

    it("takes a record that names no folder at its word, as every claim was before", () => {
        // Written by a Studio from before the field existed, which may be holding this very folder.
        const claim = decideProjectSessionClaim(record({ hostname: SELF.hostname, pid: 7000 }), context([SELF.pid, 7000]));
        expect(claim.kind).toBe("held");
    });
});

describe("claimsDirectory", () => {
    it("is a question only about records written on this machine", () => {
        expect(claimsDirectory(record({ hostname: SELF.hostname, directory: HERE }), SELF, HERE)).toBe(true);
        expect(claimsDirectory(record({ hostname: SELF.hostname, directory: ELSEWHERE }), SELF, HERE)).toBe(false);
        expect(claimsDirectory(record({ directory: ELSEWHERE }), SELF, HERE)).toBe(true);
        expect(claimsDirectory(record({ hostname: SELF.hostname }), SELF, HERE)).toBe(true);
    });
});

describe("digestProjectDirectory", () => {
    const folder = path.resolve("/projects/Game One");

    it("names a folder by sixteen hex digits that are not its path", () => {
        const digest = digestProjectDirectory(folder);
        expect(digest).toMatch(/^[0-9a-f]{16}$/);
        expect(digestProjectDirectory(folder)).toBe(digest);
    });

    it("tells two folders apart", () => {
        expect(digestProjectDirectory(path.resolve("/projects/Game One - Copy"))).not.toBe(digestProjectDirectory(folder));
    });

    it("folds a spelling of the same folder the way every project path is folded", () => {
        expect(digestProjectDirectory(`${folder}${path.sep}`)).toBe(digestProjectDirectory(folder));
        if (process.platform === "win32") {
            expect(digestProjectDirectory(folder.toUpperCase().split(path.sep).join("/"))).toBe(digestProjectDirectory(folder));
        }
    });
});

/**
 * What a holder's heartbeat makes of the disk - above all when its own claim has gone, which is
 * both what a cleared `.nlstudio/` looks like and what a takeover it slept through looks like once
 * the Studio that took the project has closed it again.
 */
describe("decideHeldProjectSession", () => {
    const OWN = record({ ...SELF, startedAt: new Date(NOW - 600_000).toISOString() });
    /** A Studio that took the project over after this one claimed it. */
    const TAKER = record({ hostname: SELF.hostname, pid: 7000, startedAt: new Date(NOW - 120_000).toISOString() });

    function held(lastClaimAtOwnClaim: ProjectSessionLockRecord | null = OWN): HeldProjectSessionContext {
        return { self: SELF, lastClaimAtOwnClaim, directory: HERE };
    }

    it("renews a claim that is still its own", () => {
        expect(decideHeldProjectSession({ ...OWN, heartbeat: new Date(NOW).toISOString() }, null, held()))
            .toEqual({ kind: "own" });
    });

    it("gives the project up when another session's claim is where its own was", () => {
        // The other Studio is still open: the takeover as it has always been seen.
        expect(decideHeldProjectSession(TAKER, OWN, held())).toEqual({ kind: "taken-over", by: TAKER });
    });

    it("gives the project up when its claim is gone and another session has claimed the project since", () => {
        // Taken over while this Studio slept, and closed there again before it woke: the other
        // Studio's claim went with it, and only the record that it made one is left.
        expect(decideHeldProjectSession(null, TAKER, held())).toEqual({ kind: "displaced", by: TAKER });
    });

    it("counts a claim from another machine the same way", () => {
        const remote = record({ startedAt: new Date(NOW - 120_000).toISOString() });
        expect(decideHeldProjectSession(null, remote, held())).toEqual({ kind: "displaced", by: remote });
    });

    it("claims the project again when its claim is gone and the last claim is its own", () => {
        // Somebody deleted the lock by hand, or a sync client dropped it - nobody else was here.
        expect(decideHeldProjectSession(null, OWN, held())).toEqual({ kind: "reclaim" });
    });

    it("claims the project again when the last-claim record is gone too", () => {
        // `.nlstudio/` cleared out whole, or a project last opened before the record existed.
        expect(decideHeldProjectSession(null, null, held())).toEqual({ kind: "reclaim" });
    });

    it("does not take its own last claim for somebody else's because the heartbeat moved", () => {
        expect(decideHeldProjectSession(null, { ...OWN, heartbeat: new Date(NOW).toISOString() }, held()))
            .toEqual({ kind: "reclaim" });
    });

    it("does not read a last claim that was already there when it claimed as somebody arriving since", () => {
        // This session could not write its own last claim, so the record still names whoever opened
        // the project before it - which says nothing about anybody after it.
        const before = record({ startedAt: new Date(NOW - 86_400_000).toISOString() });
        expect(decideHeldProjectSession(null, before, held(before))).toEqual({ kind: "reclaim" });
    });

    it("still sees a new claim when its own last claim was never written", () => {
        const before = record({ startedAt: new Date(NOW - 86_400_000).toISOString() });
        expect(decideHeldProjectSession(null, TAKER, held(before))).toEqual({ kind: "displaced", by: TAKER });
    });

    it("writes over a record copied in from another folder on this machine", () => {
        // Somebody copied another open project's files over this one, lock and all.
        const stray = record({ hostname: SELF.hostname, pid: 7000, directory: ELSEWHERE });
        expect(decideHeldProjectSession(stray, OWN, held())).toEqual({ kind: "stray" });
    });

    it("still gives the project up to a claim from another machine, whatever folder it names", () => {
        const remote = record({ directory: ELSEWHERE });
        expect(decideHeldProjectSession(remote, OWN, held())).toEqual({ kind: "taken-over", by: remote });
    });

    it("gives the project up to a claim on this very folder", () => {
        const taker = { ...TAKER, directory: HERE };
        expect(decideHeldProjectSession(taker, OWN, held())).toEqual({ kind: "taken-over", by: taker });
    });

    it("does not read a last claim made on another folder as somebody having had this one", () => {
        expect(decideHeldProjectSession(null, { ...TAKER, directory: ELSEWHERE }, held())).toEqual({ kind: "reclaim" });
        expect(decideHeldProjectSession(null, { ...TAKER, directory: HERE }, held()))
            .toEqual({ kind: "displaced", by: { ...TAKER, directory: HERE } });
    });

    it("sees the same Studio claiming the project again as somebody arriving since", () => {
        // The one that took it over closed it and opened it again - a second session all the same.
        const again = { ...TAKER, startedAt: new Date(NOW - 30_000).toISOString() };
        expect(decideHeldProjectSession(null, again, held(TAKER))).toEqual({ kind: "displaced", by: again });
    });
});

describe("parseProjectSessionLockRecord", () => {
    it("reads what the manager writes", () => {
        const written = record({ directory: HERE });
        expect(parseProjectSessionLockRecord(JSON.stringify(written))).toEqual(written);
    });

    it("reads a record from before folders were recorded, as one that names none", () => {
        const written = record();
        expect(parseProjectSessionLockRecord(JSON.stringify(written))).toEqual(written);
        expect(parseProjectSessionLockRecord(JSON.stringify(written))).not.toHaveProperty("directory");
    });

    it("keeps a record whose folder is not text, as one that names none", () => {
        // Nothing writes that; and a record that says nothing about its folder is still a claim.
        const parsed = parseProjectSessionLockRecord(JSON.stringify({ ...record(), directory: 42 }));
        expect(parsed).not.toBeNull();
        expect(parsed).not.toHaveProperty("directory");
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
