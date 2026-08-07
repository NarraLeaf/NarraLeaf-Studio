/**
 * Blueprint breakpoints: where a running graph should stop, and under what condition.
 *
 * Stored per project in the machine's own global state (`debug.breakpoints.<project token>`),
 * never in the project itself. A breakpoint is a fact about how one person is debugging right now,
 * not about the story - the same reason editors keep breakpoints out of the repository. Both the
 * Workspace blueprint editor and the Dev Mode debugger read and write that one key, so the
 * broadcast the settings store already does is what keeps the two windows in step.
 */

import { stableProjectKeyToken } from "@shared/utils/stableKeyHash";

export const BLUEPRINT_BREAKPOINTS_STATE_KEY_PREFIX = "debug.breakpoints";

/**
 * The settings key holding one project's breakpoints.
 *
 * Keyed by path alone, deliberately: `stableProjectKeyToken` also takes the `.nlproj` identifier
 * and the per-project statistics use it, but a Dev Mode window never loads the project config and
 * so cannot produce one. Both windows must derive the same key or they would edit two different
 * tables, and the identifier is the part only one of them has. The cost is that moving a project
 * directory leaves its breakpoints behind, which for machine-local debugging state is the right
 * trade.
 */
export function blueprintBreakpointsStateKey(projectPath: string): string {
    return `${BLUEPRINT_BREAKPOINTS_STATE_KEY_PREFIX}.${stableProjectKeyToken({ projectPath })}`;
}

export type BlueprintBreakpointConditionOp = "==" | "!=" | ">" | ">=" | "<" | "<=" | "contains";

export const BLUEPRINT_BREAKPOINT_CONDITION_OPS: readonly BlueprintBreakpointConditionOp[] = [
    "==",
    "!=",
    ">",
    ">=",
    "<",
    "<=",
    "contains",
];

/**
 * A structured comparison rather than an expression string.
 *
 * A condition is evaluated on every pass through the node, in a game that is still rendering, so
 * it has to be cheap and it must not be able to throw. A three-part comparison over a variable the
 * frame can already see is both, and it is authorable in a popover with three controls instead of
 * a text field that needs its own parser, scope resolution and error surface. Free-text
 * expressions can be layered on later without changing where conditions are stored or evaluated.
 */
export type BlueprintBreakpointCondition = {
    /**
     * A blueprint member variable id, resolved against the paused frame's locals. Member variables
     * are exposed there under their bare id by `acquireBlueprintExecutionLocals`.
     */
    variableId: string;
    op: BlueprintBreakpointConditionOp;
    value: string | number | boolean;
};

export type BlueprintBreakpoint = {
    blueprintId: string;
    /** The graph's own id inside the blueprint - an event graph id or a function graph id. */
    graphId: string;
    nodeId: string;
    enabled: boolean;
    condition?: BlueprintBreakpointCondition;
    /**
     * Stop only from the Nth qualifying pass onwards (1 = every pass, the default when absent).
     * Counted per debug session, not persisted - a fresh run starts counting again, like DevTools.
     */
    hitCountTarget?: number;
};

export type BlueprintBreakpointTable = {
    version: 1;
    breakpoints: BlueprintBreakpoint[];
};

export const EMPTY_BLUEPRINT_BREAKPOINT_TABLE: BlueprintBreakpointTable = { version: 1, breakpoints: [] };

/** Identity of the node a breakpoint sits on; also its de-duplication key. */
export function blueprintBreakpointKey(target: { blueprintId: string; graphId: string; nodeId: string }): string {
    return `${target.blueprintId}\u0000${target.graphId}\u0000${target.nodeId}`;
}

/**
 * Read a breakpoint table out of whatever the settings store returned. Anything unrecognized reads
 * as "no breakpoints": a table written by a newer Studio, or corrupted by hand, must not be able to
 * stop a game at a node nobody can see.
 */
export function parseBlueprintBreakpointTable(raw: unknown): BlueprintBreakpointTable {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return EMPTY_BLUEPRINT_BREAKPOINT_TABLE;
    }
    const candidate = raw as Partial<BlueprintBreakpointTable>;
    if (candidate.version !== 1 || !Array.isArray(candidate.breakpoints)) {
        return EMPTY_BLUEPRINT_BREAKPOINT_TABLE;
    }
    const seen = new Set<string>();
    const breakpoints: BlueprintBreakpoint[] = [];
    for (const entry of candidate.breakpoints) {
        const parsed = parseBlueprintBreakpoint(entry);
        if (!parsed) {
            continue;
        }
        const key = blueprintBreakpointKey(parsed);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        breakpoints.push(parsed);
    }
    return { version: 1, breakpoints };
}

function parseBlueprintBreakpoint(raw: unknown): BlueprintBreakpoint | null {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const candidate = raw as Partial<BlueprintBreakpoint>;
    if (
        typeof candidate.blueprintId !== "string" ||
        typeof candidate.graphId !== "string" ||
        typeof candidate.nodeId !== "string" ||
        !candidate.blueprintId ||
        !candidate.graphId ||
        !candidate.nodeId
    ) {
        return null;
    }
    const breakpoint: BlueprintBreakpoint = {
        blueprintId: candidate.blueprintId,
        graphId: candidate.graphId,
        nodeId: candidate.nodeId,
        enabled: candidate.enabled !== false,
    };
    const condition = parseBlueprintBreakpointCondition(candidate.condition);
    if (condition) {
        breakpoint.condition = condition;
    }
    if (typeof candidate.hitCountTarget === "number" && Number.isFinite(candidate.hitCountTarget) && candidate.hitCountTarget > 1) {
        breakpoint.hitCountTarget = Math.floor(candidate.hitCountTarget);
    }
    return breakpoint;
}

function parseBlueprintBreakpointCondition(raw: unknown): BlueprintBreakpointCondition | null {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const candidate = raw as Partial<BlueprintBreakpointCondition>;
    if (typeof candidate.variableId !== "string" || !candidate.variableId) {
        return null;
    }
    if (!candidate.op || !BLUEPRINT_BREAKPOINT_CONDITION_OPS.includes(candidate.op)) {
        return null;
    }
    const valueType = typeof candidate.value;
    if (valueType !== "string" && valueType !== "number" && valueType !== "boolean") {
        return null;
    }
    return {
        variableId: candidate.variableId,
        op: candidate.op,
        value: candidate.value as string | number | boolean,
    };
}

/**
 * Decide a breakpoint condition against the value the frame currently holds.
 *
 * Total by construction, like the story expression evaluator: a condition that cannot be decided
 * (missing variable, incomparable shapes) reads as false, so a malformed condition means "this
 * breakpoint does not fire" and never "the game stops with an error mid-frame".
 */
export function evaluateBlueprintBreakpointCondition(
    condition: BlueprintBreakpointCondition,
    actual: unknown,
): boolean {
    if (condition.op === "contains") {
        if (Array.isArray(actual)) {
            return actual.some(item => looseEquals(item, condition.value));
        }
        if (typeof actual === "string") {
            return actual.includes(String(condition.value));
        }
        return false;
    }
    if (condition.op === "==") {
        return looseEquals(actual, condition.value);
    }
    if (condition.op === "!=") {
        return !looseEquals(actual, condition.value);
    }

    const left = toComparableNumber(actual);
    const right = toComparableNumber(condition.value);
    if (left === null || right === null) {
        return false;
    }
    switch (condition.op) {
        case ">":
            return left > right;
        case ">=":
            return left >= right;
        case "<":
            return left < right;
        case "<=":
            return left <= right;
        default:
            return false;
    }
}

/**
 * Equality that compares what the author sees rather than what the runtime stores. A variable
 * declared as a number but seeded from a text pin holds `"3"`, and an author who typed `3` in the
 * condition field means that one.
 */
function looseEquals(actual: unknown, expected: string | number | boolean): boolean {
    if (actual === expected) {
        return true;
    }
    if (actual == null) {
        return false;
    }
    if (typeof actual === "object") {
        return false;
    }
    return String(actual) === String(expected);
}

function toComparableNumber(value: unknown): number | null {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "boolean") {
        return value ? 1 : 0;
    }
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
