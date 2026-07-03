import type {
    Blueprint,
    BlueprintDocument,
    BlueprintGraphNode,
    BlueprintVariable,
    LiteralValue,
} from "@shared/types/blueprint/document";
import { BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR } from "@shared/types/blueprint/graph";
import { resolveBlueprintVariableDefaultValue } from "@shared/types/blueprint/variableTypes";
import { GLOBAL_MAIN_OWNER_KEY, surfaceMainOwnerKey } from "./ownerKeys";

const EXPLICIT_BLUEPRINT_VARIABLE_REF_PREFIX = "bp:";

export type BlueprintVariableScopeKind = "page" | "blueprint" | "global";

export type BlueprintVariableRef = {
    blueprintId: string;
    variableId: string;
    explicit: boolean;
};

export type BlueprintVariableOption = {
    /** Persisted node param value. Current-blueprint variables keep the legacy raw id. */
    value: string;
    id: string;
    name: string;
    blueprintId: string;
    variableId: string;
    scopeKind: BlueprintVariableScopeKind;
    scopeLabel: string;
    valueType?: string;
    disambiguationLabel?: string;
};

type VariableGroupInput = {
    blueprintId: string;
    blueprint: Blueprint;
    scopeKind: BlueprintVariableScopeKind;
    scopeLabel: string;
    explicit: boolean;
};

function readParamString(params: Record<string, unknown> | undefined, key: string): string | undefined {
    const value = params?.[key];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function cloneLiteralValue(value: LiteralValue): LiteralValue {
    if (value === null || typeof value !== "object") {
        return value;
    }
    return JSON.parse(JSON.stringify(value)) as LiteralValue;
}

function normalizeLiteralValue(value: unknown): LiteralValue | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : undefined;
    }
    try {
        return JSON.parse(JSON.stringify(value)) as LiteralValue;
    } catch {
        return undefined;
    }
}

function blueprintSupportsDeclaredVariables(blueprint: Blueprint): boolean {
    return blueprint.owner.kind !== "widgetValue";
}

function listBlueprintGraphNodes(blueprint: Blueprint): BlueprintGraphNode[] {
    if (blueprint.program.kind !== "graph") {
        return [];
    }
    const slots = [
        ...Object.values(blueprint.program.graphs.events ?? {}),
        ...Object.values(blueprint.program.graphs.functions ?? {}),
        ...Object.values(blueprint.program.graphs.macros ?? {}),
    ];
    return slots.flatMap(slot => Object.values(slot.graph?.nodes ?? {}));
}

function variableFromDeclareNode(node: BlueprintGraphNode): BlueprintVariable | null {
    if (node.type !== BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR) {
        return null;
    }
    const params = node.params ?? {};
    const id = readParamString(params, "variableId") ?? node.id;
    const name = readParamString(params, "name") ?? `var_${id.slice(0, 8)}`;
    const valueType = readParamString(params, "valueType");
    const defaultValue =
        valueType === "any"
            ? null
            : normalizeLiteralValue(params.defaultValue) ?? resolveBlueprintVariableDefaultValue(valueType);
    return {
        id,
        name,
        valueType,
        defaultValue: defaultValue === undefined ? undefined : cloneLiteralValue(defaultValue),
        meta: { declaredByNodeId: node.id },
    };
}

function declaredVariables(blueprint: Blueprint): BlueprintVariable[] {
    if (!blueprintSupportsDeclaredVariables(blueprint)) {
        return [];
    }
    const out = new Map<string, BlueprintVariable>();
    for (const node of listBlueprintGraphNodes(blueprint)) {
        const variable = variableFromDeclareNode(node);
        if (variable && !out.has(variable.id)) {
            out.set(variable.id, variable);
        }
    }
    return [...out.values()];
}

export function listEffectiveBlueprintVariables(blueprint: Blueprint): BlueprintVariable[] {
    if (!blueprintSupportsDeclaredVariables(blueprint)) {
        return Object.values(blueprint.members?.variables ?? {});
    }
    const byId = new Map<string, BlueprintVariable>();
    for (const variable of declaredVariables(blueprint)) {
        byId.set(variable.id, variable);
    }
    for (const variable of Object.values(blueprint.members?.variables ?? {})) {
        if (!byId.has(variable.id)) {
            byId.set(variable.id, variable);
        }
    }
    return [...byId.values()];
}

export function getEffectiveBlueprintVariableRecord(blueprint: Blueprint): Record<string, BlueprintVariable> {
    return Object.fromEntries(listEffectiveBlueprintVariables(blueprint).map(variable => [variable.id, variable]));
}

function encodePart(value: string): string {
    return encodeURIComponent(value);
}

function decodePart(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

export function createExplicitBlueprintVariableRef(blueprintId: string, variableId: string): string {
    return `${EXPLICIT_BLUEPRINT_VARIABLE_REF_PREFIX}${encodePart(blueprintId)}:${encodePart(variableId)}`;
}

export function parseBlueprintVariableRef(raw: unknown, currentBlueprintId: string): BlueprintVariableRef | null {
    const value = String(raw ?? "").trim();
    if (!value) {
        return null;
    }
    if (!value.startsWith(EXPLICIT_BLUEPRINT_VARIABLE_REF_PREFIX)) {
        return { blueprintId: currentBlueprintId, variableId: value, explicit: false };
    }
    const rest = value.slice(EXPLICIT_BLUEPRINT_VARIABLE_REF_PREFIX.length);
    const splitAt = rest.indexOf(":");
    if (splitAt <= 0 || splitAt >= rest.length - 1) {
        return null;
    }
    return {
        blueprintId: decodePart(rest.slice(0, splitAt)),
        variableId: decodePart(rest.slice(splitAt + 1)),
        explicit: true,
    };
}

function variablesForGroup(group: VariableGroupInput): BlueprintVariable[] {
    return listEffectiveBlueprintVariables(group.blueprint);
}

function sortedVariables(group: VariableGroupInput): BlueprintVariable[] {
    return variablesForGroup(group).sort((a, b) => a.name.localeCompare(b.name));
}

function getSurfaceMainBlueprintId(doc: BlueprintDocument, surfaceId: string | undefined): string | undefined {
    return surfaceId ? doc.ownerRecords[surfaceMainOwnerKey(surfaceId)]?.activeBlueprintId : undefined;
}

function getGlobalMainBlueprintId(doc: BlueprintDocument): string | undefined {
    return doc.ownerRecords[GLOBAL_MAIN_OWNER_KEY]?.activeBlueprintId;
}

function pushGroup(out: VariableGroupInput[], used: Set<string>, group: VariableGroupInput | null): void {
    if (!group || used.has(group.blueprintId)) {
        return;
    }
    used.add(group.blueprintId);
    out.push(group);
}

function resolveCurrentSurfaceId(blueprint: Blueprint, fallback?: string): string | undefined {
    if (
        blueprint.owner.kind === "surfaceMain" ||
        blueprint.owner.kind === "widgetMain" ||
        blueprint.owner.kind === "widgetValue"
    ) {
        return blueprint.owner.surfaceId;
    }
    return fallback;
}

function currentBlueprintScope(blueprint: Blueprint): { kind: BlueprintVariableScopeKind; label: string } {
    if (blueprint.owner.kind === "globalMain") {
        return { kind: "global", label: "Global" };
    }
    if (blueprint.owner.kind === "surfaceMain") {
        return { kind: "page", label: "Page" };
    }
    return { kind: "blueprint", label: "Blueprint" };
}

function buildVariableGroups(input: {
    doc: BlueprintDocument;
    currentBlueprintId: string;
    surfaceId?: string;
}): VariableGroupInput[] {
    const current = input.doc.blueprints[input.currentBlueprintId];
    if (!current) {
        return [];
    }
    const surfaceId = resolveCurrentSurfaceId(current, input.surfaceId);
    const pageBlueprintId = getSurfaceMainBlueprintId(input.doc, surfaceId);
    const pageBlueprint = pageBlueprintId ? input.doc.blueprints[pageBlueprintId] : undefined;
    const globalBlueprintId = getGlobalMainBlueprintId(input.doc);
    const globalBlueprint = globalBlueprintId ? input.doc.blueprints[globalBlueprintId] : undefined;
    const used = new Set<string>();
    const out: VariableGroupInput[] = [];

    pushGroup(
        out,
        used,
        pageBlueprint && pageBlueprintId
            ? {
                  blueprintId: pageBlueprintId,
                  blueprint: pageBlueprint,
                  scopeKind: "page",
                  scopeLabel: "Page",
                  explicit: pageBlueprintId !== input.currentBlueprintId,
              }
            : null,
    );
    const currentScope = currentBlueprintScope(current);
    pushGroup(out, used, {
        blueprintId: input.currentBlueprintId,
        blueprint: current,
        scopeKind: currentScope.kind,
        scopeLabel: currentScope.label,
        explicit: false,
    });
    pushGroup(
        out,
        used,
        globalBlueprint && globalBlueprintId
            ? {
                  blueprintId: globalBlueprintId,
                  blueprint: globalBlueprint,
                  scopeKind: "global",
                  scopeLabel: "Global",
                  explicit: globalBlueprintId !== input.currentBlueprintId,
              }
            : null,
    );

    return out;
}

export function buildAccessibleBlueprintVariableOptions(input: {
    doc: BlueprintDocument;
    currentBlueprintId: string;
    surfaceId?: string;
}): BlueprintVariableOption[] {
    const groups = buildVariableGroups(input);
    const options: BlueprintVariableOption[] = [];
    for (const group of groups) {
        for (const variable of sortedVariables(group)) {
            options.push({
                value: group.explicit
                    ? createExplicitBlueprintVariableRef(group.blueprintId, variable.id)
                    : variable.id,
                id: variable.id,
                name: variable.name,
                blueprintId: group.blueprintId,
                variableId: variable.id,
                scopeKind: group.scopeKind,
                scopeLabel: group.scopeLabel,
                valueType: variable.valueType,
            });
        }
    }

    const countByName = new Map<string, number>();
    for (const option of options) {
        countByName.set(option.name, (countByName.get(option.name) ?? 0) + 1);
    }

    return options.map(option => ({
        ...option,
        disambiguationLabel: (countByName.get(option.name) ?? 0) > 1 ? option.scopeLabel : undefined,
    }));
}

export function resolveBlueprintVariableRef(input: {
    doc: BlueprintDocument;
    currentBlueprintId: string;
    rawRef: unknown;
    surfaceId?: string;
}): { ref: BlueprintVariableRef; variable: BlueprintVariable } | null {
    const ref = parseBlueprintVariableRef(input.rawRef, input.currentBlueprintId);
    if (!ref) {
        return null;
    }
    const allowed = new Set(
        buildAccessibleBlueprintVariableOptions({
            doc: input.doc,
            currentBlueprintId: input.currentBlueprintId,
            surfaceId: input.surfaceId,
        }).map(option => `${option.blueprintId}\0${option.variableId}`),
    );
    if (!allowed.has(`${ref.blueprintId}\0${ref.variableId}`)) {
        return null;
    }
    const blueprint = input.doc.blueprints[ref.blueprintId];
    const variable = blueprint ? getEffectiveBlueprintVariableRecord(blueprint)[ref.variableId] : undefined;
    return variable ? { ref, variable } : null;
}
