import { behaviorNodeRegistry } from "./BehaviorNodeRegistry";

export type BlueprintPinSemantic = "exec" | "data";

export type BlueprintNodePinEditorDef = {
    id: string;
    kind: "input" | "output";
    semantic: BlueprintPinSemantic;
    /** Loose type tag for future data-type checking */
    valueType?: string;
    label?: string;
};

export type BlueprintNodeEditorCatalogEntry = {
    type: string;
    category: string;
    displayName: string;
    keywords?: string[];
    isPure: boolean;
    pins: BlueprintNodePinEditorDef[];
    /** Param keys editable from inspector (minimal M4 set) */
    inspectorParams?: Array<{ key: string; label: string; kind: "string" | "number" | "json" }>;
};

const EXEC_IN: BlueprintNodePinEditorDef = {
    id: "in",
    kind: "input",
    semantic: "exec",
    label: "In",
};

function execOut(id: string, label?: string): BlueprintNodePinEditorDef {
    return { id, kind: "output", semantic: "exec", label: label ?? id };
}

/**
 * Editor-side catalog for palette, handles, connection policy, and inspector.
 * Runtime execution still comes from {@link behaviorNodeRegistry}.
 */
const CATALOG: Record<string, BlueprintNodeEditorCatalogEntry> = {
    "blueprint.state.set": {
        type: "blueprint.state.set",
        category: "Blueprint",
        displayName: "Set surface state",
        keywords: ["state", "set", "surface"],
        isPure: false,
        pins: [EXEC_IN, execOut("next", "Next")],
        inspectorParams: [
            { key: "key", label: "State key", kind: "string" },
            { key: "value", label: "Value (JSON)", kind: "json" },
        ],
    },
    sequence: {
        type: "sequence",
        category: "Flow",
        displayName: "Sequence",
        keywords: ["sequence", "flow"],
        isPure: false,
        pins: [EXEC_IN, execOut("next")],
    },
    if: {
        type: "if",
        category: "Flow",
        displayName: "Branch",
        keywords: ["if", "branch", "condition"],
        isPure: false,
        pins: [
            EXEC_IN,
            execOut("true", "True"),
            execOut("false", "False"),
            { id: "condition", kind: "input", semantic: "data", valueType: "boolean", label: "Condition" },
        ],
        inspectorParams: [{ key: "condition", label: "Condition", kind: "json" }],
    },
    delay: {
        type: "delay",
        category: "Flow",
        displayName: "Delay",
        keywords: ["delay", "wait"],
        isPure: false,
        pins: [EXEC_IN, execOut("next")],
        inspectorParams: [{ key: "duration", label: "Duration (ms)", kind: "number" }],
    },
    "effect.run": {
        type: "effect.run",
        category: "Effects",
        displayName: "Run effect",
        keywords: ["effect", "host"],
        isPure: false,
        pins: [EXEC_IN, execOut("next")],
        inspectorParams: [
            { key: "effectId", label: "Effect id", kind: "string" },
            { key: "payload", label: "Payload (JSON)", kind: "json" },
        ],
    },
};

export function getBlueprintNodeEditorCatalogEntry(type: string): BlueprintNodeEditorCatalogEntry | undefined {
    return CATALOG[type];
}

export function listBlueprintNodePaletteEntries(): BlueprintNodeEditorCatalogEntry[] {
    return Object.values(CATALOG).sort((a, b) => {
        const c = a.category.localeCompare(b.category);
        if (c !== 0) {
            return c;
        }
        return a.displayName.localeCompare(b.displayName);
    });
}

/**
 * Catalog entries for registered runtime types without explicit editor metadata use a generic shell.
 */
export function resolveBlueprintNodeEditorCatalogEntry(type: string): BlueprintNodeEditorCatalogEntry {
    const explicit = CATALOG[type];
    if (explicit) {
        return explicit;
    }
    const runtime = behaviorNodeRegistry.get(type);
    return {
        type,
        category: "Other",
        displayName: runtime?.displayName ?? type,
        isPure: false,
        pins: [EXEC_IN, execOut("next")],
    };
}

export function isValidBlueprintExecConnection(params: {
    sourceType: string;
    sourcePort: string;
    targetType: string;
    targetPort: string;
}): boolean {
    const src = resolveBlueprintNodeEditorCatalogEntry(params.sourceType);
    const tgt = resolveBlueprintNodeEditorCatalogEntry(params.targetType);
    const outPin = src.pins.find(p => p.id === params.sourcePort && p.kind === "output");
    const inPin = tgt.pins.find(p => p.id === params.targetPort && p.kind === "input");
    if (!outPin || !inPin) {
        return false;
    }
    if (outPin.semantic !== "exec" || inPin.semantic !== "exec") {
        return false;
    }
    return true;
}
