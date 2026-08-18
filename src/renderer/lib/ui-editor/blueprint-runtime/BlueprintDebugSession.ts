/**
 * The blueprint debugger: what stops a running graph, and what an author can do while it is stopped.
 *
 * Modelled on the DevTools JavaScript debugger, with one difference that is forced by where this
 * runs. DevTools stops the whole JavaScript thread; this cannot - blueprints execute inside the
 * renderer that is also drawing the game, so stopping the thread would freeze the window the
 * debugger is displayed in. What it stops instead is every *blueprint execution*: the frame that
 * hit the breakpoint suspends before the node runs, and every other execution suspends at its own
 * next node boundary. The game keeps rendering and NLR keeps its story where it is; no blueprint
 * makes progress until the author says so.
 *
 * Two consequences worth knowing:
 *  - a node that was already awaiting a host call when the pause happened finishes that call; the
 *    stop lands on the *next* node. Pausing mid-node would mean suspending arbitrary host work.
 *  - a suspended execution is still cancellable. The executor awaits the gate through
 *    `abortablePromise` with the execution's own signal, so unmounting a surface or ending the
 *    session unblocks it as a cancellation rather than leaving it parked forever.
 */

import {
  parseBlueprintRunGraphId,
  type BlueprintRunGraphRef
} from "@shared/blueprint/blueprintRunGraphId";
import {
  blueprintBreakpointKey,
  evaluateBlueprintBreakpointCondition,
  type BlueprintBreakpoint
} from "@shared/types/blueprint/breakpoints";
import type { UIGraphNode } from "@shared/types/ui-editor/graph";
import type {
  BlueprintDebugFrameInfo,
  BlueprintDebugFrameToken,
  BlueprintExecutionDebugController
} from "@/lib/ui-editor/behavior-graph/debugControl";
import {
  BLUEPRINT_NODE_OUTPUT_VALUES_KEY,
  readBlueprintNodeOutputValueStore
} from "@/lib/ui-editor/blueprint-nodes/nodeOutputValues";
import { isExplicitBlueprintVariableRef } from "@/lib/workspace/services/ui-editor/blueprint/blueprintVariableRefs";

export type BlueprintDebugPauseReason = "breakpoint" | "step" | "pause";

/** One entry of the call stack, as the panel draws it. Innermost frame last. */
export type BlueprintDebugStackFrame = {
  frameId: number;
  runGraphId: string;
  blueprintId?: string;
  graphId?: string;
  /** Which of the run graph kinds this frame is - an event dispatch, a fn call, a value graph… */
  kind?: BlueprintRunGraphRef["kind"];
  eventName?: string;
  fnCallDepth: number;
  /** The node this frame is stopped on, or was last about to run. */
  currentNodeId?: string;
};

export type BlueprintDebugSnapshot = {
  status: "running" | "paused";
  reason?: BlueprintDebugPauseReason;
  /** Set while paused: the innermost frame of the stopped execution. */
  pausedFrameId?: number;
  pausedNodeId?: string;
  pausedBlueprintId?: string;
  pausedGraphId?: string;
  /** Innermost last; empty while running. */
  stack: BlueprintDebugStackFrame[];
  /** Armed by the "pause" button: the next node of any execution stops. */
  pausePending: boolean;
  /** Set while paused at a breakpoint - which one, and how many times it has qualified. */
  hitBreakpointKey?: string;
  hitCount?: number;
};

export type BlueprintDebugScopeEntry = {
  name: string;
  value: unknown;
};

export type BlueprintDebugFrameScope = {
  /** Blueprint member variables visible to this frame, under their own ids. */
  variables: BlueprintDebugScopeEntry[];
  /** Values produced by nodes this frame already ran, keyed by node id. */
  nodeOutputs: { nodeId: string; values: BlueprintDebugScopeEntry[] }[];
  /** The event payload the dispatch carried, when it had one. */
  eventPayload?: BlueprintDebugScopeEntry[];
};

const RUNNING_SNAPSHOT: BlueprintDebugSnapshot = {
  status: "running",
  stack: [],
  pausePending: false
};

type Frame = {
  frameId: number;
  threadId: string;
  info: BlueprintDebugFrameInfo;
  ref: BlueprintRunGraphRef | null;
  fnCallDepth: number;
  currentNodeId?: string;
  /** Frame that was innermost on this thread when this one started; its caller. */
  parentFrameId?: number;
};

/**
 * What the debugger is waiting for before it stops again.
 *
 *  - `any`    - the next node of any execution (the pause button).
 *  - `frame`  - the next node of one specific frame (step over).
 *  - `thread` - the next node anywhere on one execution (step into).
 */
type StepTarget =
  | { kind: "any" }
  | { kind: "frame"; frameId: number; threadId: string }
  | { kind: "thread"; threadId: string };

export class BlueprintDebugSession implements BlueprintExecutionDebugController {
  private readonly frames = new Map<number, Frame>();
  /** Frame ids per thread, in call order - the last one is innermost. */
  private readonly framesByThread = new Map<string, number[]>();
  private readonly threadIdsBySignal = new WeakMap<AbortSignal, string>();
  private readonly listeners = new Set<() => void>();
  private readonly hitCounts = new Map<string, number>();
  private breakpointsByNode = new Map<string, BlueprintBreakpoint>();

  private nextFrameId = 1;
  private nextThreadId = 1;
  private stepTarget: StepTarget | null = null;
  private pausedFrameId: number | null = null;
  private pauseReason: BlueprintDebugPauseReason | null = null;
  private hitBreakpointKey: string | null = null;
  private hitCountAtPause: number | null = null;
  private gate: Promise<void> | null = null;
  private releaseGate: (() => void) | null = null;
  private snapshot: BlueprintDebugSnapshot = RUNNING_SNAPSHOT;
  private disposed = false;

  // -----------------------------------------------------------------------
  // Controller side - called by the graph executor
  // -----------------------------------------------------------------------

  public enterFrame(info: BlueprintDebugFrameInfo): BlueprintDebugFrameToken {
    const frameId = this.nextFrameId++;
    const threadId = this.resolveThreadId(info);
    const siblings = this.framesByThread.get(threadId);
    const frame: Frame = {
      frameId,
      threadId,
      info,
      ref: parseBlueprintRunGraphId(info.runGraphId),
      fnCallDepth: info.fnCallDepth ?? 0,
      parentFrameId: siblings?.[siblings.length - 1]
    };
    this.frames.set(frameId, frame);
    if (siblings) {
      siblings.push(frameId);
    } else {
      this.framesByThread.set(threadId, [frameId]);
    }
    return { frameId };
  }

  public exitFrame(token: BlueprintDebugFrameToken): void {
    const frame = this.frames.get(token.frameId);
    if (!frame) {
      return;
    }
    this.frames.delete(token.frameId);
    const siblings = this.framesByThread.get(frame.threadId);
    if (siblings) {
      const at = siblings.lastIndexOf(token.frameId);
      if (at >= 0) {
        siblings.splice(at, 1);
      }
      if (siblings.length === 0) {
        this.framesByThread.delete(frame.threadId);
      }
    }

    // Stepping over or into a frame that returns before it stops again continues in its caller,
    // which is what "step over the last node of a fn" has to mean. Without this the step would
    // silently expire and the game would run on.
    if (this.stepTarget?.kind === "frame" && this.stepTarget.frameId === token.frameId) {
      this.stepTarget = frame.parentFrameId
        ? { kind: "frame", frameId: frame.parentFrameId, threadId: frame.threadId }
        : { kind: "thread", threadId: frame.threadId };
    }
    // The frame that was stopped is leaving, which only happens when its execution was
    // cancelled out from under the gate (unmounting a surface, ending the session). Releasing
    // is not a nicety: the gate is what every OTHER execution is parked on, and clearing only
    // `pausedFrameId` would leave it held by a frame that no longer exists - the snapshot would
    // read "running" while nothing could run, and the toolbar would offer Pause (refused,
    // because a gate is open) with the steps greyed out (refused, because nothing is paused).
    // Nothing short of disposing the session could have reopened it.
    if (this.pausedFrameId === token.frameId) {
      this.release();
      return;
    }
    this.publish();
  }

  public beforeNode(token: BlueprintDebugFrameToken, node: UIGraphNode): void | Promise<void> {
    if (this.disposed) {
      return;
    }
    // The hot path: nothing armed, nothing to do, no allocation. Every node of every graph in a
    // Dev Mode session goes through here.
    if (!this.gate && !this.stepTarget && this.breakpointsByNode.size === 0) {
      return;
    }
    const frame = this.frames.get(token.frameId);
    if (!frame) {
      return;
    }
    frame.currentNodeId = node.id;

    // Already stopped: every other execution parks at its own next node until the author
    // resumes. This is the "all blueprints stop" half of the pause semantics.
    if (this.gate) {
      return this.gate;
    }

    if (this.matchesStepTarget(frame)) {
      return this.pause(frame, "step", null, null);
    }

    const breakpoint = this.findBreakpointFor(frame, node.id);
    if (!breakpoint) {
      return;
    }
    const key = blueprintBreakpointKey(breakpoint);
    if (breakpoint.condition) {
      const actual = readFrameVariable(frame, breakpoint.condition.variableId);
      if (!evaluateBlueprintBreakpointCondition(breakpoint.condition, actual)) {
        return;
      }
    }
    const hits = (this.hitCounts.get(key) ?? 0) + 1;
    this.hitCounts.set(key, hits);
    if (breakpoint.hitCountTarget && hits < breakpoint.hitCountTarget) {
      return;
    }
    return this.pause(frame, "breakpoint", key, hits);
  }

  // -----------------------------------------------------------------------
  // Author side - called by the debugger UI
  // -----------------------------------------------------------------------

  public getSnapshot(): BlueprintDebugSnapshot {
    return this.snapshot;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Replace the armed breakpoint set. Hit counts survive for breakpoints that are still there
   * unchanged, and reset for the ones whose condition or target count the author just edited -
   * an edited breakpoint is a new question, and counting on from the old answer would be wrong.
   */
  public setBreakpoints(breakpoints: readonly BlueprintBreakpoint[]): void {
    const next = new Map<string, BlueprintBreakpoint>();
    for (const breakpoint of breakpoints) {
      if (!breakpoint.enabled) {
        continue;
      }
      next.set(blueprintBreakpointKey(breakpoint), breakpoint);
    }
    for (const [key, count] of [...this.hitCounts]) {
      const kept = next.get(key);
      const previous = this.breakpointsByNode.get(key);
      const unchanged =
        kept &&
        previous &&
        kept.hitCountTarget === previous.hitCountTarget &&
        JSON.stringify(kept.condition ?? null) === JSON.stringify(previous.condition ?? null);
      if (!unchanged) {
        this.hitCounts.delete(key);
      } else {
        this.hitCounts.set(key, count);
      }
    }
    this.breakpointsByNode = next;
  }

  /** Stop the next node of any execution. Idempotent; harmless while already paused. */
  public requestPause(): void {
    if (this.gate) {
      return;
    }
    this.stepTarget = { kind: "any" };
    this.publish();
  }

  public cancelPauseRequest(): void {
    if (this.gate || this.stepTarget?.kind !== "any") {
      return;
    }
    this.stepTarget = null;
    this.publish();
  }

  public resume(): void {
    this.stepTarget = null;
    this.release();
  }

  /** Run to the next node of the paused frame itself; a fn call it makes runs to completion. */
  public stepOver(): void {
    const frame = this.pausedFrame();
    if (!frame) {
      return;
    }
    this.stepTarget = { kind: "frame", frameId: frame.frameId, threadId: frame.threadId };
    this.release();
  }

  /** Run to the next node of this execution, including the first node of a fn it calls. */
  public stepInto(): void {
    const frame = this.pausedFrame();
    if (!frame) {
      return;
    }
    this.stepTarget = { kind: "thread", threadId: frame.threadId };
    this.release();
  }

  /** Run until the paused frame returns, then stop at its caller's next node. */
  public stepOut(): void {
    const frame = this.pausedFrame();
    if (!frame) {
      return;
    }
    this.stepTarget = frame.parentFrameId
      ? { kind: "frame", frameId: frame.parentFrameId, threadId: frame.threadId }
      : { kind: "thread", threadId: frame.threadId };
    this.release();
  }

  /**
   * Read what one frame can currently see. Values are read live rather than copied at pause time:
   * blueprint locals are accessor properties over the owner's variable store, and a copy would go
   * stale the moment a step ran a Set Variable node.
   */
  public readFrameScope(frameId: number): BlueprintDebugFrameScope | null {
    const frame = this.frames.get(frameId);
    if (!frame) {
      return null;
    }
    const locals = frame.info.blueprintLocals ?? {};
    const variables: BlueprintDebugScopeEntry[] = [];
    for (const name of Object.keys(locals)) {
      // Skip the same-value aliases every accessible blueprint variable also gets under an
      // explicit `bp:<blueprint>:<variable>` key, and the node output store, which is listed
      // separately below.
      if (isExplicitBlueprintVariableRef(name) || name === BLUEPRINT_NODE_OUTPUT_VALUES_KEY) {
        continue;
      }
      const value = readOwnValue(locals, name);
      if (value === SKIP_VALUE) {
        continue;
      }
      variables.push({ name, value });
    }
    variables.sort((a, b) => a.name.localeCompare(b.name));

    const outputStore = readBlueprintNodeOutputValueStore(locals) ?? {};
    const nodeOutputs = Object.entries(outputStore).map(([nodeId, values]) => ({
      nodeId,
      values: Object.entries(values ?? {}).map(([name, value]) => ({ name, value }))
    }));

    const payload = frame.info.eventPayload;
    return {
      variables,
      nodeOutputs,
      eventPayload: payload
        ? Object.entries(payload).map(([name, value]) => ({ name, value }))
        : undefined
    };
  }

  /**
   * Tear the session down: release every suspended execution so it can finish or be cancelled by
   * its own signal, and stop answering. Called when the runtime session is replaced (hot reload)
   * or the window goes away.
   */
  public dispose(): void {
    this.disposed = true;
    this.stepTarget = null;
    this.breakpointsByNode.clear();
    this.hitCounts.clear();
    this.release();
    this.frames.clear();
    this.framesByThread.clear();
    this.listeners.clear();
  }

  // -----------------------------------------------------------------------

  private resolveThreadId(info: BlueprintDebugFrameInfo): string {
    if (info.executionId) {
      return `x:${info.executionId}`;
    }
    if (info.signal) {
      const existing = this.threadIdsBySignal.get(info.signal);
      if (existing) {
        return existing;
      }
      const created = `s:${this.nextThreadId++}`;
      this.threadIdsBySignal.set(info.signal, created);
      return created;
    }
    // Nothing to group by: the frame is its own execution. A stack of one is a truthful answer
    // here, where guessing at a parent would not be.
    return `f:${this.nextThreadId++}`;
  }

  private matchesStepTarget(frame: Frame): boolean {
    const target = this.stepTarget;
    if (!target) {
      return false;
    }
    if (target.kind === "any") {
      return true;
    }
    if (target.kind === "thread") {
      return target.threadId === frame.threadId;
    }
    return target.frameId === frame.frameId;
  }

  private findBreakpointFor(frame: Frame, nodeId: string): BlueprintBreakpoint | undefined {
    if (!frame.ref || this.breakpointsByNode.size === 0) {
      return undefined;
    }
    return this.breakpointsByNode.get(
      blueprintBreakpointKey({
        blueprintId: frame.ref.blueprintId,
        graphId: frame.ref.graphId,
        nodeId
      })
    );
  }

  private pause(
    frame: Frame,
    reason: BlueprintDebugPauseReason,
    breakpointKey: string | null,
    hitCount: number | null
  ): Promise<void> {
    this.stepTarget = null;
    this.pausedFrameId = frame.frameId;
    this.pauseReason = reason;
    this.hitBreakpointKey = breakpointKey;
    this.hitCountAtPause = hitCount;
    const gate = new Promise<void>((resolve) => {
      this.releaseGate = resolve;
    });
    this.gate = gate;
    this.publish();
    return gate;
  }

  private release(): void {
    const resolve = this.releaseGate;
    this.gate = null;
    this.releaseGate = null;
    this.pausedFrameId = null;
    this.pauseReason = null;
    this.hitBreakpointKey = null;
    this.hitCountAtPause = null;
    this.publish();
    resolve?.();
  }

  private pausedFrame(): Frame | null {
    return this.pausedFrameId ? (this.frames.get(this.pausedFrameId) ?? null) : null;
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) {
      listener();
    }
  }

  private buildSnapshot(): BlueprintDebugSnapshot {
    const frame = this.pausedFrame();
    if (!frame) {
      return this.stepTarget?.kind === "any"
        ? { status: "running", stack: [], pausePending: true }
        : RUNNING_SNAPSHOT;
    }
    const ids = this.framesByThread.get(frame.threadId) ?? [frame.frameId];
    const stack: BlueprintDebugStackFrame[] = [];
    for (const id of ids) {
      const entry = this.frames.get(id);
      if (!entry) {
        continue;
      }
      stack.push({
        frameId: entry.frameId,
        runGraphId: entry.info.runGraphId,
        blueprintId: entry.ref?.blueprintId ?? entry.info.blueprintId,
        graphId: entry.ref?.graphId,
        kind: entry.ref?.kind,
        eventName: entry.info.eventName,
        fnCallDepth: entry.fnCallDepth,
        currentNodeId: entry.currentNodeId
      });
    }
    return {
      status: "paused",
      reason: this.pauseReason ?? "breakpoint",
      pausedFrameId: frame.frameId,
      pausedNodeId: frame.currentNodeId,
      pausedBlueprintId: frame.ref?.blueprintId ?? frame.info.blueprintId,
      pausedGraphId: frame.ref?.graphId,
      stack,
      pausePending: false,
      hitBreakpointKey: this.hitBreakpointKey ?? undefined,
      hitCount: this.hitCountAtPause ?? undefined
    };
  }
}

const SKIP_VALUE = Symbol("skip");

/**
 * Read one local without letting a throwing accessor take the debugger with it. Blueprint locals
 * are getters over a store that may have been released (a widget that unmounted while its event
 * was in flight), and a debugger that crashes while displaying a scope is worse than one that
 * omits a row.
 */
function readOwnValue(locals: Record<string, unknown>, name: string): unknown {
  try {
    return locals[name];
  } catch {
    return SKIP_VALUE;
  }
}

function readFrameVariable(frame: Frame, variableId: string): unknown {
  const locals = frame.info.blueprintLocals;
  if (!locals) {
    return undefined;
  }
  const value = readOwnValue(locals, variableId);
  return value === SKIP_VALUE ? undefined : value;
}
