import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { UI_FRAME_ELEMENT_TYPE } from "@shared/types/ui-editor/frame";
import type {
    UIDocument,
    UIElement,
    UIElementValueBindingValueType,
    UISurface,
} from "@shared/types/ui-editor/document";
import type { UIListItemScope } from "@shared/types/ui-editor/list";
import { clampSliderValue, normalizeSliderProps } from "@shared/types/ui-editor/slider";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { BlueprintValueDependency } from "@/lib/ui-editor/behavior-graph/BehaviorNodeRegistry";
import { evaluateBlueprintValue } from "./BlueprintValueEvaluator";

type ActiveBindingInput = {
    key: string;
    document: UIDocument;
    surfaceId: string;
    runtimeScopeId?: string;
    elementId: string;
    propPath: string;
    blueprintId: string;
    valueType: UIElementValueBindingValueType;
    blueprintDocument: BlueprintDocument;
    hostAdapter: UIHostAdapter;
    listItemScope?: UIListItemScope | null;
    instanceKey?: string;
};

type BindingRuntimeEntry = {
    input: ActiveBindingInput;
    started: boolean;
    running: boolean;
    pendingEvaluate: boolean;
    hasResolved: boolean;
    resolvedValue: unknown;
    blueprintDocumentRef: BlueprintDocument;
    dependencies: BlueprintValueDependency[];
    dependencySnapshotKey: string;
    listItemSnapshotKey: string;
};

export type BlueprintValueResolved = {
    hasResolved: boolean;
    value: unknown;
};

type ValueRuntimeSyncContext = {
    document: UIDocument;
    surface: UISurface;
    blueprintDocument: BlueprintDocument;
    hostAdapter: UIHostAdapter;
    runtimeScopeId: string;
};

function valueBindingKey(surfaceId: string, elementId: string, propPath: string, blueprintId: string, instanceKey?: string): string {
    return `${surfaceId}\0${elementId}\0${propPath}\0${blueprintId}\0${instanceKey ?? ""}`;
}

function collectSurfaceElements(document: UIDocument, surface: UISurface): UIElement[] {
    const out: UIElement[] = [];
    const visit = (elementId: string) => {
        const element = document.elements[elementId];
        if (!element) {
            return;
        }
        out.push(element);
        for (const childId of element.childrenIds ?? []) {
            visit(childId);
        }
    };
    visit(surface.rootElementId);
    return out;
}

function coerceValue(value: unknown, valueType: ActiveBindingInput["valueType"]): unknown {
    if (valueType === "string") {
        return value == null ? "" : String(value);
    }
    if (valueType === "float") {
        const n = typeof value === "number" ? value : Number(value);
        return Number.isFinite(n) ? n : undefined;
    }
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringifyDependencyValue(value: unknown): string {
    if (value === undefined) {
        return "undefined";
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function stringifyListItemScope(scope: UIListItemScope | null | undefined): string {
    if (!scope) {
        return "";
    }
    return stringifyDependencyValue({
        item: scope.item,
        index: scope.index,
        count: scope.count,
        key: scope.key,
    });
}

function readNestedRecordPath(value: unknown, path: string): unknown {
    if (!path) {
        return value;
    }
    let current: unknown = value;
    for (const part of path.split(".")) {
        if (!current || typeof current !== "object" || Array.isArray(current)) {
            return undefined;
        }
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}

function readDependencyValue(document: UIDocument, dependency: BlueprintValueDependency): unknown {
    const element = document.elements[dependency.elementId];
    if (!element) {
        return { missing: true };
    }
    if (dependency.propPath.startsWith("props.")) {
        return readNestedRecordPath(element.props, dependency.propPath.slice("props.".length));
    }
    if (dependency.propPath.startsWith("layout.")) {
        return readNestedRecordPath(element.layout, dependency.propPath.slice("layout.".length));
    }
    return undefined;
}

function buildDependencySnapshotKey(document: UIDocument, dependencies: readonly BlueprintValueDependency[]): string {
    return dependencies
        .map(dependency => {
            const key = `${dependency.surfaceId}\0${dependency.elementId}\0${dependency.propPath}`;
            return `${key}\0${stringifyDependencyValue(readDependencyValue(document, dependency))}`;
        })
        .sort()
        .join("\x1e");
}

const SUPPORTED_VALUE_TARGETS: Array<{
    elementType: string;
    propPath: string;
    valueType: UIElementValueBindingValueType;
    normalize?: (value: unknown, element: UIElement) => unknown;
}> = [
    { elementType: "nl.text", propPath: "text", valueType: "string" },
    { elementType: "nl.button", propPath: "label", valueType: "string" },
    {
        elementType: UI_FRAME_ELEMENT_TYPE,
        propPath: "params",
        valueType: "json",
        normalize: value => (isRecord(value) ? value : {}),
    },
    {
        elementType: "nl.slider",
        propPath: "value",
        valueType: "float",
        normalize: (value, element) => {
            const props = normalizeSliderProps(element.props);
            return value === undefined ? props.value : clampSliderValue(value, props);
        },
    },
];

export class BlueprintValueRuntimeStore {
    private readonly entries = new Map<string, BindingRuntimeEntry>();
    private disposed = false;
    private lastSyncContext: ValueRuntimeSyncContext | null = null;

    public constructor(private readonly onChange: () => void) {}

    public dispose(): void {
        this.disposed = true;
        this.entries.clear();
    }

    public sync(input: {
        document: UIDocument;
        surface: UISurface;
        blueprintDocument: BlueprintDocument;
        hostAdapter: UIHostAdapter;
    }): void {
        if (this.disposed) {
            return;
        }
        this.lastSyncContext = {
            ...input,
            runtimeScopeId: input.hostAdapter.blueprintRuntime?.runtimeScopeId ?? input.surface.id,
        };
        const activeKeys = new Set<string>();
        const runtimeScopeId = this.lastSyncContext.runtimeScopeId;
        for (const element of collectSurfaceElements(input.document, input.surface)) {
            for (const [propPath, binding] of Object.entries(element.valueBindings ?? {})) {
                const key = valueBindingKey(input.surface.id, element.id, propPath, binding.blueprintId);
                activeKeys.add(key);
                const nextInput: ActiveBindingInput = {
                    key,
                    document: input.document,
                    surfaceId: input.surface.id,
                    runtimeScopeId,
                    elementId: element.id,
                    propPath,
                    blueprintId: binding.blueprintId,
                    valueType: binding.valueType,
                    blueprintDocument: input.blueprintDocument,
                    hostAdapter: input.hostAdapter,
                    listItemScope: null,
                    instanceKey: undefined,
                };
                let entry = this.entries.get(key);
                if (!entry) {
                    entry = {
                        input: nextInput,
                        started: false,
                        running: false,
                        pendingEvaluate: false,
                        hasResolved: false,
                        resolvedValue: undefined,
                        blueprintDocumentRef: input.blueprintDocument,
                        dependencies: [],
                        dependencySnapshotKey: "",
                        listItemSnapshotKey: "",
                    };
                    this.entries.set(key, entry);
                    this.startInitial(entry);
                    continue;
                }
                const blueprintChanged = entry.blueprintDocumentRef !== input.blueprintDocument;
                const dependencyChanged = entry.dependencies.length > 0 &&
                    buildDependencySnapshotKey(input.document, entry.dependencies) !== entry.dependencySnapshotKey;
                entry.input = nextInput;
                entry.blueprintDocumentRef = input.blueprintDocument;
                if (entry.started && (blueprintChanged || dependencyChanged)) {
                    this.queueEvaluate(entry);
                }
            }
        }
        for (const key of [...this.entries.keys()]) {
            const entry = this.entries.get(key);
            if (!activeKeys.has(key) && !entry?.input.instanceKey) {
                this.entries.delete(key);
            }
        }
    }

    public ensureElementValue(input: {
        element: UIElement;
        surfaceId: string;
        propPath: string;
        blueprintId: string;
        valueType: UIElementValueBindingValueType;
        listItemScope?: UIListItemScope | null;
        instanceKey?: string;
    }): void {
        if (this.disposed || !this.lastSyncContext) {
            return;
        }
        const key = valueBindingKey(input.surfaceId, input.element.id, input.propPath, input.blueprintId, input.instanceKey);
        const nextInput: ActiveBindingInput = {
            key,
            document: this.lastSyncContext.document,
            surfaceId: input.surfaceId,
            runtimeScopeId: this.lastSyncContext.runtimeScopeId,
            elementId: input.element.id,
            propPath: input.propPath,
            blueprintId: input.blueprintId,
            valueType: input.valueType,
            blueprintDocument: this.lastSyncContext.blueprintDocument,
            hostAdapter: this.lastSyncContext.hostAdapter,
            listItemScope: input.listItemScope ?? null,
            instanceKey: input.instanceKey,
        };
        const listItemSnapshotKey = stringifyListItemScope(nextInput.listItemScope);
        let entry = this.entries.get(key);
        if (!entry) {
            entry = {
                input: nextInput,
                started: false,
                running: false,
                pendingEvaluate: false,
                hasResolved: false,
                resolvedValue: undefined,
                blueprintDocumentRef: nextInput.blueprintDocument,
                dependencies: [],
                dependencySnapshotKey: "",
                listItemSnapshotKey,
            };
            this.entries.set(key, entry);
            this.startInitial(entry);
            return;
        }
        const blueprintChanged = entry.blueprintDocumentRef !== nextInput.blueprintDocument;
        const listItemChanged = entry.listItemSnapshotKey !== listItemSnapshotKey;
        const dependencyChanged = entry.dependencies.length > 0 &&
            buildDependencySnapshotKey(nextInput.document, entry.dependencies) !== entry.dependencySnapshotKey;
        entry.input = nextInput;
        entry.blueprintDocumentRef = nextInput.blueprintDocument;
        entry.listItemSnapshotKey = listItemSnapshotKey;
        if (entry.started && (blueprintChanged || listItemChanged || dependencyChanged)) {
            this.queueEvaluate(entry);
        }
    }

    public getResolvedValue(
        surfaceId: string,
        elementId: string,
        propPath: string,
        blueprintId: string,
        instanceKey?: string,
    ): BlueprintValueResolved {
        const entry = this.entries.get(valueBindingKey(surfaceId, elementId, propPath, blueprintId, instanceKey));
        return {
            hasResolved: entry?.hasResolved === true,
            value: entry?.resolvedValue,
        };
    }

    private startInitial(entry: BindingRuntimeEntry): void {
        if (entry.started || entry.running) {
            return;
        }
        entry.started = true;
        void this.runEvaluate(entry);
    }

    private queueEvaluate(entry: BindingRuntimeEntry): void {
        if (entry.running) {
            entry.pendingEvaluate = true;
            return;
        }
        void this.runEvaluate(entry);
    }

    private async runEvaluate(entry: BindingRuntimeEntry): Promise<void> {
        entry.running = true;
        try {
            await this.evaluate(entry);
        } finally {
            entry.running = false;
            if (entry.pendingEvaluate && this.entries.get(entry.input.key) === entry) {
                entry.pendingEvaluate = false;
                void this.runEvaluate(entry);
            }
        }
    }

    private async evaluate(entry: BindingRuntimeEntry): Promise<void> {
        try {
            const result = await evaluateBlueprintValue({
                blueprintDocument: entry.input.blueprintDocument,
                blueprintId: entry.input.blueprintId,
                surfaceId: entry.input.surfaceId,
                runtimeScopeId: entry.input.runtimeScopeId,
                elementId: entry.input.elementId,
                listItemScope: entry.input.listItemScope ?? null,
                instanceKey: entry.input.instanceKey,
                hostAdapter: entry.input.hostAdapter,
            });
            entry.dependencies = result.dependencies;
            entry.dependencySnapshotKey = buildDependencySnapshotKey(entry.input.document, result.dependencies);
            if (!result.returned) {
                return;
            }
            entry.hasResolved = true;
            entry.resolvedValue = coerceValue(result.value, entry.input.valueType);
            if (!this.disposed && this.entries.get(entry.input.key) === entry) {
                this.onChange();
            }
        } catch (err) {
            console.warn("[BlueprintValueRuntime] evaluation skipped", err);
        }
    }
}

export function mergeElementWithBlueprintValues(
    element: UIElement,
    surfaceId: string,
    valueRuntime: BlueprintValueRuntimeStore | null,
    listItemScope: UIListItemScope | null = null,
    instanceKey = "",
): UIElement {
    if (!valueRuntime) {
        return element;
    }
    const target = SUPPORTED_VALUE_TARGETS.find(item => item.elementType === element.type);
    if (!target) {
        return element;
    }
    const binding = element.valueBindings?.[target.propPath];
    if (!binding || binding.valueType !== target.valueType) {
        return element;
    }
    valueRuntime.ensureElementValue({
        element,
        surfaceId,
        propPath: target.propPath,
        blueprintId: binding.blueprintId,
        valueType: binding.valueType,
        listItemScope,
        instanceKey: listItemScope ? instanceKey : undefined,
    });
    const resolved = valueRuntime.getResolvedValue(
        surfaceId,
        element.id,
        target.propPath,
        binding.blueprintId,
        listItemScope ? instanceKey : undefined,
    );
    if (!resolved.hasResolved) {
        return element;
    }
    const value = target.normalize ? target.normalize(resolved.value, element) : resolved.value;
    return {
        ...element,
        props: {
            ...(element.props ?? {}),
            [target.propPath]: value,
        },
    };
}
