import { describe, expect, it, vi } from "vitest";
import type { PuppetSize, PuppetState } from "narraleaf-react";
import type { PuppetModelSession } from "./puppetModelSession";
import {
    SurfacePuppetMount,
    SurfacePuppetUnavailableError,
    type SurfacePuppetOpener,
    type SurfacePuppetRequest,
    type SurfacePuppetSnapshot,
} from "./surfacePuppetSession";

/**
 * No DOM anywhere in this file, and that is the point rather than a convenience.
 *
 * The mount machine's whole job is host-independent bookkeeping — which attempt won, what to tell the
 * widget, what to send the backend — so if it ever needs a real `document` to be tested, host-specific
 * knowledge has leaked into it.
 */
function fakeHost() {
    const children: unknown[] = [];
    const host = {
        children,
        appendChild: (child: { __detach: () => void }) => {
            children.push(child);
            return child;
        },
    };
    return host as unknown as HTMLElement & { children: unknown[] };
}

function fakeSurface(host: { children: unknown[] }) {
    const surface = {
        removed: false,
        remove: () => {
            surface.removed = true;
            const index = host.children.indexOf(surface);
            if (index !== -1) {
                host.children.splice(index, 1);
            }
        },
    };
    return surface as unknown as HTMLDivElement & { removed: boolean };
}

type FakeSession = PuppetModelSession & {
    applied: PuppetState[];
    resized: PuppetSize[];
    disposals: number;
    settleReady: () => void;
};

function fakeSession(options: { deferReady?: boolean } = {}): FakeSession {
    let releaseReady: (() => void) | null = null;
    const readyPromise = options.deferReady
        ? new Promise<void>(resolve => { releaseReady = resolve; })
        : Promise.resolve();
    const session = {
        describable: false,
        describe: () => Promise.reject(new Error("not described")),
        applied: [] as PuppetState[],
        resized: [] as PuppetSize[],
        disposals: 0,
        apply(state: PuppetState) {
            session.applied.push(state);
        },
        ready: () => readyPromise,
        resize(size: PuppetSize) {
            session.resized.push(size);
        },
        dispose() {
            session.disposals += 1;
        },
        settleReady: () => releaseReady?.(),
    };
    return session as unknown as FakeSession;
}

const SIZE: PuppetSize = { width: 320, height: 480 };

function state(patch: Partial<PuppetState> = {}): PuppetState {
    return { motion: null, expression: null, skin: null, params: {}, slots: {}, ...patch };
}

function request(patch: Partial<SurfacePuppetRequest> = {}): SurfacePuppetRequest {
    return { assetId: "model-alice", backend: "renderer-a", options: {}, ...patch };
}

function harness(open: SurfacePuppetOpener | null) {
    const host = fakeHost();
    const surfaces: (HTMLDivElement & { removed: boolean })[] = [];
    const snapshots: SurfacePuppetSnapshot[] = [];
    const warnings: string[] = [];
    const mount = new SurfacePuppetMount({
        host,
        open,
        createSurface: () => {
            const surface = fakeSurface(host);
            surfaces.push(surface);
            return surface;
        },
        onChange: snapshot => snapshots.push(snapshot),
        onWarn: message => warnings.push(message),
    });
    return { mount, host, surfaces, snapshots, warnings };
}

/** Let every already-resolved microtask in the mount chain run. */
async function settle(): Promise<void> {
    for (let turn = 0; turn < 6; turn++) {
        await Promise.resolve();
    }
}

describe("SurfacePuppetMount", () => {
    it("reaches ready and applies the complete state before ready(), the way the engine does", async () => {
        const session = fakeSession();
        const { mount, snapshots } = harness(() => Promise.resolve(session));

        mount.mount(request(), state({ motion: "wave", skin: "default" }), SIZE);
        expect(mount.snapshot.status).toBe("loading");
        await settle();

        expect(mount.snapshot.status).toBe("ready");
        expect(snapshots.map(entry => entry.status)).toEqual(["loading", "ready"]);
        // Complete, not a patch: the engine's contract is that `null` clears rather than "leave as-is",
        // so a half-apply would make a save or an undo fail to reproduce what it recorded.
        expect(session.applied).toEqual([
            { motion: "wave", expression: null, skin: "default", params: {}, slots: {} },
        ]);
        expect(mount.session).toBe(session);
    });

    it("degrades quietly, without opening anything, when the widget is not configured", async () => {
        const open = vi.fn<SurfacePuppetOpener>(() => Promise.resolve(fakeSession()));
        const { mount, host } = harness(open);

        mount.mount(request({ assetId: null }), state(), SIZE);
        expect(mount.snapshot).toEqual({ status: "missing-backend", error: null, reason: "no-model" });

        mount.mount(request({ backend: "  " }), state(), SIZE);
        expect(mount.snapshot).toEqual({ status: "missing-backend", error: null, reason: "no-backend" });

        // The box stays and nothing is drawn: no module load, no WebGL context, no surface at all.
        expect(open).not.toHaveBeenCalled();
        expect(host.children).toHaveLength(0);
    });

    it("degrades quietly when no host in this window can look a runtime up", () => {
        // The end of the chain in surfacePuppetHosts.ts: no workspace services, no Dev Mode registry, no
        // packaged bridge. `missing-backend` rather than `unmounted`, because nothing *can* draw this -
        // and never `error`, because a window with no lookup has not failed at anything.
        const { mount, host } = harness(null);

        mount.mount(request(), state(), SIZE);

        expect(mount.snapshot).toEqual({ status: "missing-backend", error: null, reason: "backend-missing" });
        // Nothing was opened and no surface was made: there is no opener to call.
        expect(host.children).toHaveLength(0);
        expect(mount.session).toBeNull();
    });

    it("treats a runtime that is not installed as missing-backend, never as an error", async () => {
        const { mount, surfaces } = harness(() => Promise.reject(
            new SurfacePuppetUnavailableError("backend-missing", "runtime \"renderer-a\" is not installed"),
        ));

        mount.mount(request(), state(), SIZE);
        await settle();

        expect(mount.snapshot).toEqual({ status: "missing-backend", error: null, reason: "backend-missing" });
        // Quiet means quiet: nothing for a widget to render as a failure.
        expect(mount.snapshot.error).toBeNull();
        expect(surfaces[0]?.removed).toBe(true);
    });

    it("reports a runtime that was found and then broke", async () => {
        const { mount } = harness(() => Promise.reject(new Error("backend blew up")));

        mount.mount(request(), state(), SIZE);
        await settle();

        expect(mount.snapshot).toEqual({ status: "error", error: "backend blew up", reason: null });
    });

    it("disposes a backend that came up and then failed its own load", async () => {
        const session = fakeSession();
        session.ready = () => Promise.reject(new Error("model file is corrupt"));
        const { mount } = harness(() => Promise.resolve(session));

        mount.mount(request(), state(), SIZE);
        await settle();

        expect(mount.snapshot.status).toBe("error");
        // The context is the scarce resource here (~16 per window), so an attempt that fails *after*
        // mounting must still hand its own back.
        expect(session.disposals).toBe(1);
    });

    it("gives every attempt its own surface, so the loser cannot wipe the winner's canvas", async () => {
        const first = fakeSession();
        const second = fakeSession();
        const sessions = [first, second];
        const { mount, host, surfaces } = harness(() => Promise.resolve(sessions.shift()!));

        mount.mount(request(), state(), SIZE);
        // Overlapping: the first attempt's open() has not resolved yet. React's development
        // double-invoke and an edit during a load both produce exactly this.
        mount.mount(request({ assetId: "model-bob" }), state(), SIZE);
        expect(surfaces).toHaveLength(2);
        expect(surfaces[0]).not.toBe(surfaces[1]);
        await settle();

        // The loser disposed its own session and removed its own node; the winner is untouched and is
        // what the widget is looking at. Sharing one container would have left a blank box here, with
        // no error to explain it.
        expect(first.disposals).toBe(1);
        expect(surfaces[0]?.removed).toBe(true);
        expect(second.disposals).toBe(0);
        expect(surfaces[1]?.removed).toBe(false);
        expect(host.children).toEqual([surfaces[1]]);
        expect(mount.session).toBe(second);
        expect(mount.snapshot.status).toBe("ready");
    });

    it("removes its own surface when an abandoned attempt then fails to open", async () => {
        let rejectFirst: ((reason: unknown) => void) | null = null;
        const second = fakeSession();
        let calls = 0;
        const { mount, host, surfaces } = harness(() => {
            calls += 1;
            return calls === 1
                ? new Promise<PuppetModelSession>((_resolve, reject) => { rejectFirst = reject; })
                : Promise.resolve(second);
        });

        mount.mount(request(), state(), SIZE);
        // The author renames the backend, or picks another model, while the first open() is in flight.
        mount.mount(request({ backend: "renderer-b" }), state(), SIZE);
        expect(surfaces).toHaveLength(2);

        // ...and only now does the abandoned attempt fail: no such runtime directory, a module that
        // will not load.
        rejectFirst?.(new Error("module not found"));
        await settle();

        // A stale attempt owns its own node — `teardown()` deliberately leaves it alone while the
        // session is still null, because pulling a container out from under a mid-mount backend is how
        // a half-built WebGL canvas leaks. So if the rejecting arm does not remove it, nothing ever
        // does: one orphan per edit, stacked in the widget box, each holding whatever the backend
        // built before it threw, against a ~16-context ceiling.
        expect(surfaces[0]?.removed).toBe(true);
        expect(host.children).toEqual([surfaces[1]]);
        // And an abandoned attempt's failure is not the author's problem: the widget shows the model
        // that won, not an error from the one they navigated away from.
        expect(mount.snapshot.status).toBe("ready");
        expect(mount.session).toBe(second);
    });

    it("does not let a late-resolving stale attempt overwrite the current status", async () => {
        const slow = fakeSession({ deferReady: true });
        const quick = fakeSession();
        const sessions = [slow, quick];
        const { mount, snapshots } = harness(() => Promise.resolve(sessions.shift()!));

        mount.mount(request(), state(), SIZE);
        await settle();
        mount.mount(request({ assetId: "model-bob" }), state(), SIZE);
        await settle();
        expect(mount.snapshot.status).toBe("ready");
        expect(mount.session).toBe(quick);

        // The abandoned attempt's `ready()` settles a beat later. It must publish nothing.
        slow.settleReady();
        await settle();
        expect(mount.session).toBe(quick);
        expect(snapshots.filter(entry => entry.status === "ready")).toHaveLength(1);
    });

    it("carries a pose that arrived mid-load into the mount rather than dropping it", async () => {
        const session = fakeSession({ deferReady: true });
        const { mount } = harness(() => Promise.resolve(session));

        mount.mount(request(), state({ motion: "idle" }), SIZE);
        mount.apply(state({ motion: "wave" }));
        await settle();

        // One apply, with the latest complete state - not the stale one the mount started with, and
        // not both in sequence.
        expect(session.applied).toEqual([
            { motion: "wave", expression: null, skin: null, params: {}, slots: {} },
        ]);
    });

    it("re-poses a live model, and ignores a state that would pose it identically", async () => {
        const session = fakeSession();
        const { mount } = harness(() => Promise.resolve(session));

        mount.mount(request(), state({ motion: "idle" }), SIZE);
        await settle();
        // A React caller rebuilds this object every render; comparing by reference would re-pose the
        // model on every keystroke somewhere else in the inspector.
        mount.apply(state({ motion: "idle" }));
        expect(session.applied).toHaveLength(1);

        mount.apply(state({ motion: "idle", slots: { hat: null } }));
        expect(session.applied).toHaveLength(2);
        // `slots: {hat: null}` is not `slots: {}`: an explicit null means "cleared", which is a
        // different pose from never having been set.
        expect(session.applied[1]).toEqual({
            motion: "idle", expression: null, skin: null, params: {}, slots: { hat: null },
        });
    });

    it("keeps a box change that happened while the model was still loading", async () => {
        const session = fakeSession({ deferReady: true });
        const { mount } = harness(() => Promise.resolve(session));

        mount.mount(request(), state(), SIZE);
        mount.resize({ width: 640, height: 360 });
        await settle();

        expect(session.resized).toEqual([{ width: 640, height: 360 }]);
        // Same size again is not a resize.
        mount.resize({ width: 640, height: 360 });
        expect(session.resized).toHaveLength(1);
    });

    it("tears the model down on dispose, and survives a backend that throws on the way out", async () => {
        const session = fakeSession();
        session.dispose = () => { throw new Error("backend blew up on dispose"); };
        const { mount, host, surfaces, warnings } = harness(() => Promise.resolve(session));

        mount.mount(request(), state(), SIZE);
        await settle();
        expect(() => mount.dispose()).not.toThrow();

        expect(warnings).toContain("backend blew up on dispose");
        expect(surfaces[0]?.removed).toBe(true);
        expect(host.children).toHaveLength(0);
        expect(mount.snapshot.status).toBe("unmounted");
        // A disposed machine stays disposed: a React cleanup racing a prop change must not resurrect it.
        mount.mount(request(), state(), SIZE);
        expect(mount.snapshot.status).toBe("unmounted");
    });

    it("reports unmounted, not an error, when the host withdraws the request", async () => {
        const session = fakeSession();
        const { mount, host } = harness(() => Promise.resolve(session));

        mount.mount(request(), state(), SIZE);
        await settle();
        // What a host does for an offscreen widget it will not spend a WebGL context on.
        mount.mount(null, state(), SIZE);

        expect(mount.snapshot).toEqual({ status: "unmounted", error: null, reason: null });
        expect(session.disposals).toBe(1);
        expect(host.children).toHaveLength(0);
    });

    it("keeps a re-pose that the backend rejected advisory - it never becomes a status", async () => {
        const session = fakeSession();
        const { mount, warnings } = harness(() => Promise.resolve(session));

        mount.mount(request(), state(), SIZE);
        await settle();
        session.apply = () => Promise.reject(new Error("no motion named wave"));
        mount.apply(state({ motion: "wave" }));
        await settle();

        // The engine's rule for a *live* element: one mistyped name is a warning, not a dead model.
        expect(mount.snapshot.status).toBe("ready");
        expect(warnings).toContain("no motion named wave");
    });

    it("does fail the mount when the backend rejects the initial pose", async () => {
        // Deliberately the opposite of the case above, and the engine draws the line in the same
        // place: its Puppet renderer chains `applyState -> ready` and puts the element in "error" if
        // either rejects. A model that cannot take the pose it is being brought up in has not loaded.
        const session = fakeSession();
        session.apply = () => Promise.reject(new Error("model has no skin \"default\""));
        const { mount } = harness(() => Promise.resolve(session));

        mount.mount(request(), state({ skin: "default" }), SIZE);
        await settle();

        expect(mount.snapshot.status).toBe("error");
        expect(mount.snapshot.error).toBe("model has no skin \"default\"");
        expect(session.disposals).toBe(1);
    });
});
