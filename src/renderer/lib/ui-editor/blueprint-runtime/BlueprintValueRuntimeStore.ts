import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { UI_FRAME_ELEMENT_TYPE } from "@shared/types/ui-editor/frame";
import type {
    UIDocument,
    UIElement,
    UIElementValueBindingValueType,
    UISurface,
} from "@shared/types/ui-editor/document";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import {
    BLUEPRINT_VALUE_EVENT_FLUSH,
    BLUEPRINT_VALUE_EVENT_INIT,
    evaluateBlueprintValue,
} from "./BlueprintValueEvaluator";

type ActiveBindingInput = {
    key: string;
    surfaceId: string;
    runtimeScopeId?: string;
    elementId: string;
    propPath: string;
    blueprintId: string;
    valueType: UIElementValueBindingValueType;
    blueprintDocument: BlueprintDocument;
    hostAdapter: UIHostAdapter;
};

type BindingRuntimeEntry = {
    input: ActiveBindingInput;
    started: boolean;
    running: boolean;
    pendingFlush: boolean;
    hasResolved: boolean;
    resolvedValue: unknown;
    blueprintDocumentRef: BlueprintDocument;
};

export type BlueprintValueResolved = {
    hasResolved: boolean;
    value: unknown;
};

function valueBindingKey(surfaceId: string, elementId: string, propPath: string, blueprintId: string): string {
    return `${surfaceId}\0${elementId}\0${propPath}\0${blueprintId}`;
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
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

const SUPPORTED_VALUE_TARGETS: Array<{
    elementType: string;
    propPath: string;
    valueType: UIElementValueBindingValueType;
    normalize?: (value: unknown) => unknown;
}> = [
    { elementType: "nl.text", propPath: "text", valueType: "string" },
    { elementType: "nl.button", propPath: "label", valueType: "string" },
    {
        elementType: UI_FRAME_ELEMENT_TYPE,
        propPath: "params",
        valueType: "json",
        normalize: value => (isRecord(value) ? value : {}),
    },
];

export class BlueprintValueRuntimeStore {
    private readonly entries = new Map<string, BindingRuntimeEntry>();
    private disposed = false;

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
        const activeKeys = new Set<string>();
        const runtimeScopeId = input.hostAdapter.blueprintRuntime?.runtimeScopeId ?? input.surface.id;
        for (const element of collectSurfaceElements(input.document, input.surface)) {
            for (const [propPath, binding] of Object.entries(element.valueBindings ?? {})) {
                const key = valueBindingKey(input.surface.id, element.id, propPath, binding.blueprintId);
                activeKeys.add(key);
                const nextInput: ActiveBindingInput = {
                    key,
                    surfaceId: input.surface.id,
                    runtimeScopeId,
                    elementId: element.id,
                    propPath,
                    blueprintId: binding.blueprintId,
                    valueType: binding.valueType,
                    blueprintDocument: input.blueprintDocument,
                    hostAdapter: input.hostAdapter,
                };
                let entry = this.entries.get(key);
                if (!entry) {
                    entry = {
                        input: nextInput,
                        started: false,
                        running: false,
                        pendingFlush: false,
                        hasResolved: false,
                        resolvedValue: undefined,
                        blueprintDocumentRef: input.blueprintDocument,
                    };
                    this.entries.set(key, entry);
                    this.startInitial(entry);
                    continue;
                }
                const docChanged = entry.blueprintDocumentRef !== input.blueprintDocument;
                entry.input = nextInput;
                entry.blueprintDocumentRef = input.blueprintDocument;
                if (docChanged && entry.started) {
                    this.queueFlush(entry);
                }
            }
        }
        for (const key of [...this.entries.keys()]) {
            if (!activeKeys.has(key)) {
                this.entries.delete(key);
            }
        }
    }

    public queueFlushAll(): void {
        for (const entry of this.entries.values()) {
            this.queueFlush(entry);
        }
    }

    public getResolvedValue(surfaceId: string, elementId: string, propPath: string, blueprintId: string): BlueprintValueResolved {
        const entry = this.entries.get(valueBindingKey(surfaceId, elementId, propPath, blueprintId));
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
        void this.runInitial(entry);
    }

    private queueFlush(entry: BindingRuntimeEntry): void {
        if (entry.running) {
            entry.pendingFlush = true;
            return;
        }
        void this.runFlush(entry);
    }

    private async runInitial(entry: BindingRuntimeEntry): Promise<void> {
        entry.running = true;
        try {
            await this.evaluate(entry, BLUEPRINT_VALUE_EVENT_INIT);
            await this.evaluate(entry, BLUEPRINT_VALUE_EVENT_FLUSH);
        } finally {
            entry.running = false;
            if (entry.pendingFlush && this.entries.get(entry.input.key) === entry) {
                entry.pendingFlush = false;
                void this.runFlush(entry);
            }
        }
    }

    private async runFlush(entry: BindingRuntimeEntry): Promise<void> {
        entry.running = true;
        try {
            await this.evaluate(entry, BLUEPRINT_VALUE_EVENT_FLUSH);
        } finally {
            entry.running = false;
            if (entry.pendingFlush && this.entries.get(entry.input.key) === entry) {
                entry.pendingFlush = false;
                void this.runFlush(entry);
            }
        }
    }

    private async evaluate(
        entry: BindingRuntimeEntry,
        eventName: typeof BLUEPRINT_VALUE_EVENT_INIT | typeof BLUEPRINT_VALUE_EVENT_FLUSH,
    ): Promise<void> {
        try {
            const result = await evaluateBlueprintValue({
                blueprintDocument: entry.input.blueprintDocument,
                blueprintId: entry.input.blueprintId,
                surfaceId: entry.input.surfaceId,
                runtimeScopeId: entry.input.runtimeScopeId,
                elementId: entry.input.elementId,
                eventName,
                hostAdapter: entry.input.hostAdapter,
            });
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
    const resolved = valueRuntime.getResolvedValue(surfaceId, element.id, target.propPath, binding.blueprintId);
    if (!resolved.hasResolved) {
        return element;
    }
    const value = target.normalize ? target.normalize(resolved.value) : resolved.value;
    return {
        ...element,
        props: {
            ...(element.props ?? {}),
            [target.propPath]: value,
        },
    };
}
