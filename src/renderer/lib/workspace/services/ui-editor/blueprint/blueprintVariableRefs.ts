import type { Blueprint, BlueprintDocument, BlueprintVariable } from "@shared/types/blueprint/document";
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

function sortedVariables(blueprint: Blueprint): BlueprintVariable[] {
    return Object.values(blueprint.members?.variables ?? {}).sort((a, b) => a.name.localeCompare(b.name));
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
        for (const variable of sortedVariables(group.blueprint)) {
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
    const variable = input.doc.blueprints[ref.blueprintId]?.members?.variables?.[ref.variableId];
    return variable ? { ref, variable } : null;
}
