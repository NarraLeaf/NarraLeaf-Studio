import { describe, expect, it } from "vitest";
import { LIFECYCLE_CONTRACT, tokenizeLifecycleCommand } from "./lifecycleContract";
import {
    executeLifecycleCommands,
    SurfaceLifecycleOrchestrator,
    type LifecycleCommand,
    type LifecycleCommandExecutor,
} from "./surfaceLifecycleOrchestrator";

function tokens(commands: readonly LifecycleCommand[]): string[] {
    return commands.map(tokenizeLifecycleCommand);
}

describe("SurfaceLifecycleOrchestrator", () => {
    it("first mount produces the full init sequence", () => {
        const orchestrator = new SurfaceLifecycleOrchestrator();
        const commands = orchestrator.surfaceReady("scope-1", "surface-a");
        expect(tokens(commands)).toEqual([...LIFECYCLE_CONTRACT.surfaceReadyFirstEnter]);
        expect(commands[0]).toEqual({ kind: "openScope", scopeId: "scope-1" });
        expect(commands[1]).toMatchObject({ eventName: "surfaceInit", scopeId: "scope-1", surfaceId: "surface-a" });
    });

    it("re-enter without exit (preserve) reopens the scope without surfaceInit", () => {
        const orchestrator = new SurfaceLifecycleOrchestrator();
        orchestrator.surfaceReady("scope-1", "surface-a");
        const commands = orchestrator.surfaceReady("scope-1", "surface-a");
        expect(tokens(commands)).toEqual([...LIFECYCLE_CONTRACT.surfaceReadyReEnter]);
    });

    it("unmount emits closeScope + surfaceUnmount with closed-scope execution allowed", () => {
        const orchestrator = new SurfaceLifecycleOrchestrator();
        orchestrator.surfaceReady("scope-1", "surface-a");
        const commands = orchestrator.surfaceUnmounted("scope-1", "surface-a");
        expect(tokens(commands)).toEqual([...LIFECYCLE_CONTRACT.surfaceUnmounted]);
        expect(commands[0]).toMatchObject({ reason: "Surface unmounted" });
        expect(commands[1]).toMatchObject({ allowClosedScopeExecution: true });
    });

    it("re-enter after exit dispatches surfaceInit again", () => {
        const orchestrator = new SurfaceLifecycleOrchestrator();
        orchestrator.surfaceReady("scope-1", "surface-a");
        orchestrator.surfaceUnmounted("scope-1", "surface-a");
        const commands = orchestrator.surfaceReady("scope-1", "surface-a");
        expect(tokens(commands)).toEqual([...LIFECYCLE_CONTRACT.surfaceReadyFirstEnter]);
    });

    it("sessionReset makes every scope a first enter again", () => {
        const orchestrator = new SurfaceLifecycleOrchestrator();
        orchestrator.surfaceReady("scope-1", "surface-a");
        orchestrator.sessionReset();
        const commands = orchestrator.surfaceReady("scope-1", "surface-a");
        expect(tokens(commands)).toEqual([...LIFECYCLE_CONTRACT.surfaceReadyFirstEnter]);
    });

    it("independent scopes (overlay over game) do not affect each other", () => {
        const orchestrator = new SurfaceLifecycleOrchestrator();
        orchestrator.surfaceReady("scope-menu", "surface-menu");
        const overlayReady = orchestrator.surfaceReady("scope-pause", "surface-pause");
        expect(tokens(overlayReady)).toEqual([...LIFECYCLE_CONTRACT.surfaceReadyFirstEnter]);
        const overlayGone = orchestrator.surfaceUnmounted("scope-pause", "surface-pause");
        expect(tokens(overlayGone)).toEqual([...LIFECYCLE_CONTRACT.surfaceUnmounted]);
        // The underlying menu scope is untouched: a ready for it is still a re-enter.
        expect(tokens(orchestrator.surfaceReady("scope-menu", "surface-menu"))).toEqual([
            ...LIFECYCLE_CONTRACT.surfaceReadyReEnter,
        ]);
    });

    it("wait-mode navigation interleaves as exit-then-enter across scopes", () => {
        const orchestrator = new SurfaceLifecycleOrchestrator();
        orchestrator.surfaceReady("scope-old", "surface-old");
        orchestrator.enterComplete("scope-old", "surface-old");
        const sequence = [
            ...orchestrator.beforeExit("scope-old", "surface-old"),
            ...orchestrator.surfaceUnmounted("scope-old", "surface-old"),
            ...orchestrator.surfaceReady("scope-new", "surface-new"),
            ...orchestrator.enterComplete("scope-new", "surface-new"),
        ];
        expect(tokens(sequence)).toEqual([
            ...LIFECYCLE_CONTRACT.beforeExit,
            ...LIFECYCLE_CONTRACT.surfaceUnmounted,
            ...LIFECYCLE_CONTRACT.surfaceReadyFirstEnter,
            ...LIFECYCLE_CONTRACT.enterComplete,
        ]);
    });

    it("enterComplete is idempotent per enter generation", () => {
        const orchestrator = new SurfaceLifecycleOrchestrator();
        orchestrator.surfaceReady("scope-1", "surface-a");
        expect(tokens(orchestrator.enterComplete("scope-1", "surface-a"))).toEqual([
            ...LIFECYCLE_CONTRACT.enterComplete,
        ]);
        // Redundant animation-layer signals (zero-duration effect, timeout fallback).
        expect(orchestrator.enterComplete("scope-1", "surface-a")).toEqual([]);
        expect(orchestrator.enterComplete("scope-1", "surface-a")).toEqual([]);
        // A new enter generation (after beforeExit) may complete again.
        orchestrator.beforeExit("scope-1", "surface-a");
        expect(tokens(orchestrator.enterComplete("scope-1", "surface-a"))).toEqual([
            ...LIFECYCLE_CONTRACT.enterComplete,
        ]);
    });

    it("beforeExit emits exiting transition state, interaction clear, event, and signal in order", () => {
        const orchestrator = new SurfaceLifecycleOrchestrator();
        orchestrator.surfaceReady("scope-1", "surface-a");
        const commands = orchestrator.beforeExit("scope-1", "surface-a");
        expect(tokens(commands)).toEqual([...LIFECYCLE_CONTRACT.beforeExit]);
    });

    it("unmount before ready still emits the unmount pair (cancelled frame-wait case)", () => {
        const orchestrator = new SurfaceLifecycleOrchestrator();
        const commands = orchestrator.surfaceUnmounted("scope-never-opened", "surface-a");
        expect(tokens(commands)).toEqual([...LIFECYCLE_CONTRACT.surfaceUnmounted]);
    });

    it("StrictMode-style ready/unmounted/ready nets a single live enter", () => {
        const orchestrator = new SurfaceLifecycleOrchestrator();
        const first = orchestrator.surfaceReady("scope-1", "surface-a");
        const gone = orchestrator.surfaceUnmounted("scope-1", "surface-a");
        const second = orchestrator.surfaceReady("scope-1", "surface-a");
        expect(tokens([...first, ...gone, ...second])).toEqual([
            ...LIFECYCLE_CONTRACT.surfaceReadyFirstEnter,
            ...LIFECYCLE_CONTRACT.surfaceUnmounted,
            ...LIFECYCLE_CONTRACT.surfaceReadyFirstEnter,
        ]);
    });

    it("executeLifecycleCommands maps each command onto the executor in order", () => {
        const orchestrator = new SurfaceLifecycleOrchestrator();
        const log: string[] = [];
        const executor: LifecycleCommandExecutor = {
            openScope: scopeId => log.push(`open:${scopeId}`),
            closeScope: (scopeId, reason) => log.push(`close:${scopeId}:${reason}`),
            dispatchSurfaceEvent: command => log.push(`dispatch:${command.eventName}`),
            setTransitionState: state => log.push(`transition:${state.isExiting ? "exiting" : "idle"}`),
            bumpLifecycleSignal: signal => log.push(`bump:${signal}`),
            clearInteraction: scopeId => log.push(`clear:${scopeId}`),
        };
        executeLifecycleCommands(orchestrator.surfaceReady("scope-1", "surface-a"), executor);
        executeLifecycleCommands(orchestrator.enterComplete("scope-1", "surface-a"), executor);
        executeLifecycleCommands(orchestrator.beforeExit("scope-1", "surface-a"), executor);
        executeLifecycleCommands(orchestrator.surfaceUnmounted("scope-1", "surface-a"), executor);
        expect(log).toEqual([
            "open:scope-1",
            "dispatch:surfaceInit",
            "transition:idle",
            "dispatch:afterSurfaceEnter",
            "bump:afterSurfaceEnter",
            "transition:exiting",
            "clear:scope-1",
            "dispatch:beforeSurfaceExit",
            "bump:beforeSurfaceExit",
            "close:scope-1:Surface unmounted",
            "dispatch:surfaceUnmount",
        ]);
    });
});
