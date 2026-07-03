import { BlueprintGraphExecutionCancelledError } from "../behavior-graph/GraphExecutionError";

export type BlueprintExecutionRecord = {
    executionId: string;
    runtimeScopeId?: string;
    blueprintId?: string;
    eventId?: string;
};

export type BlueprintExecutionHandle = {
    signal: AbortSignal;
    finish: () => void;
};

export type BeginBlueprintExecutionOptions = BlueprintExecutionRecord & {
    allowClosedScope?: boolean;
};

type StoredExecution = BlueprintExecutionRecord & {
    controller: AbortController;
};

const DEFAULT_CANCEL_REASON = "Blueprint execution cancelled";

export class BlueprintExecutionManager {
    private readonly executions = new Map<string, StoredExecution>();
    private readonly executionsByScope = new Map<string, Set<string>>();
    private readonly closedScopes = new Set<string>();

    public openScope(runtimeScopeId: string): void {
        this.closedScopes.delete(runtimeScopeId);
    }

    public closeScope(runtimeScopeId: string, reason = "Surface unmounted"): void {
        this.closedScopes.add(runtimeScopeId);
        this.cancelScope(runtimeScopeId, reason);
    }

    public isScopeClosed(runtimeScopeId: string): boolean {
        return this.closedScopes.has(runtimeScopeId);
    }

    public beginExecution(options: BeginBlueprintExecutionOptions): BlueprintExecutionHandle {
        const controller = new AbortController();
        const record: StoredExecution = {
            executionId: options.executionId,
            runtimeScopeId: options.runtimeScopeId,
            blueprintId: options.blueprintId,
            eventId: options.eventId,
            controller,
        };
        this.executions.set(options.executionId, record);
        if (options.runtimeScopeId) {
            let scoped = this.executionsByScope.get(options.runtimeScopeId);
            if (!scoped) {
                scoped = new Set<string>();
                this.executionsByScope.set(options.runtimeScopeId, scoped);
            }
            scoped.add(options.executionId);
            if (this.closedScopes.has(options.runtimeScopeId) && !options.allowClosedScope) {
                this.abortRecord(record, "Surface scope is no longer mounted");
            }
        }
        return {
            signal: controller.signal,
            finish: () => this.finishExecution(options.executionId),
        };
    }

    public finishExecution(executionId: string): void {
        const record = this.executions.get(executionId);
        if (!record) {
            return;
        }
        this.executions.delete(executionId);
        if (record.runtimeScopeId) {
            const scoped = this.executionsByScope.get(record.runtimeScopeId);
            scoped?.delete(executionId);
            if (scoped?.size === 0) {
                this.executionsByScope.delete(record.runtimeScopeId);
            }
        }
    }

    public cancelScope(runtimeScopeId: string, reason = "Surface unmounted"): void {
        const executionIds = [...(this.executionsByScope.get(runtimeScopeId) ?? [])];
        for (const executionId of executionIds) {
            const record = this.executions.get(executionId);
            if (record) {
                this.abortRecord(record, reason);
            }
        }
    }

    public cancelAll(reason = DEFAULT_CANCEL_REASON): void {
        for (const record of this.executions.values()) {
            this.abortRecord(record, reason);
        }
        this.closedScopes.clear();
    }

    private abortRecord(record: StoredExecution, reason: string): void {
        if (record.controller.signal.aborted) {
            return;
        }
        record.controller.abort(new BlueprintGraphExecutionCancelledError(reason));
    }
}
