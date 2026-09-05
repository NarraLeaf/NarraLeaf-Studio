import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { PersistentVariableRuntimeTable } from "@shared/types/variables/registry";
import { UI_FRAME_ELEMENT_TYPE } from "@shared/types/ui-editor/frame";
import type {
    UIDocument,
    UIElement,
    UIElementValueBinding,
    UIElementValueBindingValueType,
    UISurface,
} from "@shared/types/ui-editor/document";
import type { UIListItemScope } from "@shared/types/ui-editor/list";
import { readUIStructFieldValue } from "@shared/types/ui-editor/struct";
import { clampSliderValue, normalizeSliderProps } from "@shared/types/ui-editor/slider";
import { UI_SWITCH_ELEMENT_TYPE } from "@shared/types/ui-editor/switch";
import { isWidgetTypeOf } from "@shared/types/ui-editor/widgetInheritance";
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
    persistentVariables: PersistentVariableRuntimeTable;
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
    persistentVariables: PersistentVariableRuntimeTable;
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

/**
 * The asset id inside an `ImageAsset`, or the value untouched when it is not one.
 *
 * Everything that hands out a picture answers with the wire envelope `{kind:"imageAsset",assetId}` -
 * a node's `ImageAsset|null` output, a list row's `image` field - while the prop that draws one is a
 * bare id and so declares itself `string`. Unwrapping here rather than at either caller is what
 * makes the two routes to a bound picture agree: a row's own field and a value blueprint reach the
 * same widget, and before this only the first of them arrived as an id at all.
 */
function unwrapImageAssetValue(value: unknown): unknown {
    return value && typeof value === "object" && !Array.isArray(value) && (value as { kind?: unknown }).kind === "imageAsset"
        ? (value as { assetId?: unknown }).assetId
        : value;
}

function coerceValue(value: unknown, valueType: ActiveBindingInput["valueType"]): unknown {
    if (valueType === "string") {
        // An envelope that reached a string binding is a picture on its way to a prop that names
        // one by id; `String()` on it produces "[object Object]", which resolves to no asset and
        // draws nothing, with no failure anywhere to read.
        const unwrapped = unwrapImageAssetValue(value);
        return unwrapped == null ? "" : String(unwrapped);
    }
    if (valueType === "float") {
        const n = typeof value === "number" ? value : Number(value);
        return Number.isFinite(n) ? n : undefined;
    }
    if (valueType === "boolean") {
        // `undefined` is this store's word for "nothing usable came back", so "the graph returned
        // nothing" must not be spelled the same way as "the graph returned false": `undefined` and
        // `null` pass straight through, exactly as an unusable number does on the float branch.
        //
        // Everything else is decided here, and deliberately narrowly: on is `true`, the string
        // "true", or the number 1 - the three shapes a boolean literal, a stringified preference and
        // a 0/1 flag actually arrive in. Anything else is off: 0, "", an object, and above all the
        // string "false", which plain truthiness would have read as on - the one wrong answer an
        // author would never think to check for.
        if (value == null) {
            return undefined;
        }
        return value === true || value === "true" || value === 1;
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

/**
 * One bindable prop on one widget type.
 *
 * `propPath` is both the key a binding is stored under and, by default, where the resolved value
 * lands. A target whose value does not live at the top of the prop bag carries a `write` instead -
 * the picture on an image sits inside `imageFill`, and flattening it would produce a prop no
 * renderer reads.
 */
type SupportedValueTarget = {
    elementType: string;
    propPath: string;
    valueType: UIElementValueBindingValueType;
    normalize?: (value: unknown, element: UIElement) => unknown;
    write?: (element: UIElement, value: unknown) => UIElement;
};

const SUPPORTED_VALUE_TARGETS: SupportedValueTarget[] = [
    { elementType: "nl.text", propPath: "text", valueType: "string" },
    { elementType: "nl.button", propPath: "label", valueType: "string" },
    {
        // What makes a save-slot thumbnail, a gallery cell and a backlog portrait possible: until
        // this existed, a picture that differs per row could not be expressed at all, because the
        // only per-row channel was a bound prop and no image prop was bindable.
        elementType: "nl.image",
        propPath: "imageFill.assetId",
        valueType: "string",
        normalize: value => (typeof value === "string" && value.trim() ? value.trim() : null),
        write: (element, value) => {
            const props = (element.props ?? {}) as Record<string, unknown>;
            const fill = props.imageFill && typeof props.imageFill === "object" ? props.imageFill : {};
            return {
                ...element,
                props: {
                    ...props,
                    imageFill: { ...(fill as Record<string, unknown>), assetId: value },
                },
            };
        },
    },
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
    // No `normalize`: the slider needs one to clamp into its range, and the switch has no range.
    // `normalizeSwitchProps` already reads anything that is not `true` as off, so the merged value
    // needs no second gate on the way in.
    { elementType: UI_SWITCH_ELEMENT_TYPE, propPath: "checked", valueType: "boolean" },
];

/**
 * Which prop of which widget type a value blueprint may drive, for tools that describe the seam
 * rather than run it.
 *
 * Exported so the interface CLI's widget documentation answers "what can be bound here" from the
 * table the runtime actually consults. The `normalize` and `write` halves stay private: they are
 * how a value lands, which is nobody else's business.
 */
export function listBindableValueTargets(): { elementType: string; propPath: string; valueType: UIElementValueBindingValueType }[] {
    return SUPPORTED_VALUE_TARGETS.map(target => ({
        elementType: target.elementType,
        propPath: target.propPath,
        valueType: target.valueType,
    }));
}

export class BlueprintValueRuntimeStore {
    private readonly entries = new Map<string, BindingRuntimeEntry>();
    private disposed = false;
    private lastSyncContext: ValueRuntimeSyncContext | null = null;
    private changeAnnounced = false;

    public constructor(private readonly onChange: () => void) {}

    /**
     * Announce "some value on this surface resolved" at most once per microtask checkpoint.
     *
     * Every entry evaluates behind its own `await`, so a page with sixteen value-bound widgets used
     * to announce sixteen separate changes - and the subscriber's answer to a change is to rebuild
     * the entire element tree. Nothing renders between two microtasks, so the sixteen rebuilds all
     * produced frames no one could see; only the last one was ever painted.
     *
     * Deliberately a microtask and not a frame: the batch still lands before the browser can paint,
     * so this collapses redundant work without deferring anything an author could observe.
     */
    private announceChange(): void {
        if (this.changeAnnounced) {
            return;
        }
        this.changeAnnounced = true;
        queueMicrotask(() => {
            this.changeAnnounced = false;
            if (this.disposed) {
                return;
            }
            this.onChange();
        });
    }

    /**
     * Terminal. A disposed store answers `sync` / `ensureElementValue` / `refreshAll` with an early
     * return forever, so whoever owns the instance has to build a new one to start resolving again
     * (see `SurfaceValueRuntimeBoundary`, which is why the store lives in state and not a memo).
     */
    public dispose(): void {
        this.disposed = true;
        this.entries.clear();
    }

    public sync(input: {
        document: UIDocument;
        surface: UISurface;
        blueprintDocument: BlueprintDocument;
        persistentVariables: PersistentVariableRuntimeTable;
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
                // Field bindings keep no entry here. There is no graph to run, nothing to await and
                // nothing to invalidate - the value is read off the item scope at merge time - so an
                // entry for one would be a subscription to something that never changes.
                if (binding.kind !== "blueprintValue") {
                    continue;
                }
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
                    persistentVariables: input.persistentVariables,
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
            persistentVariables: this.lastSyncContext.persistentVariables,
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

    public refreshAll(): void {
        if (this.disposed) {
            return;
        }
        for (const entry of this.entries.values()) {
            if (entry.started) {
                this.queueEvaluate(entry);
            }
        }
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
                persistentVariables: entry.input.persistentVariables,
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
            const nextValue = coerceValue(result.value, entry.input.valueType);
            /**
             * Silent when the graph came back with the answer it gave last time.
             *
             * `refreshAll` re-runs every started entry whenever any state key is written, so a page
             * of bound widgets re-resolves in full for a write that concerns one of them - or none.
             * Announcing each of those rebuilds the whole element tree to produce the tree it just
             * produced. A value that is genuinely new still announces, which is the only case the
             * subscriber can act on.
             *
             * Compared with `Object.is`, so a value type that resolves to a fresh object counts as
             * changed and behaves exactly as it did before this guard existed.
             */
            const changed = !entry.hasResolved || !Object.is(entry.resolvedValue, nextValue);
            entry.hasResolved = true;
            entry.resolvedValue = nextValue;
            if (changed && !this.disposed && this.entries.get(entry.input.key) === entry) {
                this.announceChange();
            }
        } catch (err) {
            console.warn("[BlueprintValueRuntime] evaluation skipped", err);
        }
    }
}

function writeTargetValue(element: UIElement, target: SupportedValueTarget, value: unknown): UIElement {
    if (target.write) {
        return target.write(element, value);
    }
    return {
        ...element,
        props: {
            ...(element.props ?? {}),
            [target.propPath]: value,
        },
    };
}

/**
 * The row's own data, read straight off the item scope.
 *
 * No graph, no store, no entry to keep alive - which is why it is resolved before the runtime is
 * even checked for. A field binding on an element that is not inside an item template resolves to
 * nothing and leaves the authored prop alone, so the same element reads its placeholder on a canvas
 * where no list is drawing it.
 */
function resolveListItemFieldValue(
    binding: Extract<UIElementValueBinding, { kind: "listItemField" }>,
    target: SupportedValueTarget,
    listItemScope: UIListItemScope | null,
): { resolved: false } | { resolved: true; value: unknown } {
    if (!listItemScope) {
        return { resolved: false };
    }
    const raw = readUIStructFieldValue(listItemScope.struct ?? null, binding.fieldId, listItemScope.item);
    if (raw === undefined) {
        return { resolved: false };
    }
    // Unwrapped for every target type, not only the string ones `coerceValue` handles: a field
    // binding is the one route where a picture can reach a target that names no type of its own,
    // and a target that wanted the envelope would have to ask for it rather than be handed a shape
    // only this path can produce.
    return { resolved: true, value: coerceValue(unwrapImageAssetValue(raw), target.valueType) };
}

/**
 * The one bindable prop that is not a widget prop and belongs to every type.
 *
 * Whether a row shows a piece of itself - the "cleared" badge on a save slot, the lock on a gallery
 * cell - is per-row by nature, and the only thing that ever varied per row before was content. It is
 * handled outside the target table because the table is keyed by widget type and this is not.
 */
const LAYOUT_VISIBLE_BINDING_PATH = "layout.visible";

export function mergeElementWithBlueprintValues(
    element: UIElement,
    surfaceId: string,
    valueRuntime: BlueprintValueRuntimeStore | null,
    listItemScope: UIListItemScope | null = null,
    instanceKey = "",
): UIElement {
    const bindings = element.valueBindings;
    if (!bindings) {
        return element;
    }
    const visibleBinding = bindings[LAYOUT_VISIBLE_BINDING_PATH];
    if (visibleBinding?.kind === "listItemField" && listItemScope) {
        const raw = readUIStructFieldValue(listItemScope.struct ?? null, visibleBinding.fieldId, listItemScope.item);
        if (raw !== undefined) {
            element = { ...element, layout: { ...element.layout, visible: coerceValue(raw, "boolean") !== false } };
        }
    }
    // Matched through the inheritance chain: the specialisations inherit the text inspector, so a
    // Dialog Sentence offers the same bind-to-blueprint control and has to resolve it too.
    //
    // Every matching target is folded, not the first: one element may carry more than one bound
    // prop, and stopping at the first would make which one worked depend on table order.
    let out = element;
    for (const target of SUPPORTED_VALUE_TARGETS) {
        if (!isWidgetTypeOf(element.type, target.elementType)) {
            continue;
        }
        const binding = bindings[target.propPath];
        if (!binding) {
            continue;
        }
        if (binding.kind === "listItemField") {
            const field = resolveListItemFieldValue(binding, target, listItemScope);
            if (field.resolved) {
                out = writeTargetValue(out, target, target.normalize ? target.normalize(field.value, out) : field.value);
            }
            continue;
        }
        if (!valueRuntime || binding.valueType !== target.valueType) {
            continue;
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
            continue;
        }
        out = writeTargetValue(out, target, target.normalize ? target.normalize(resolved.value, out) : resolved.value);
    }
    return out;
}
