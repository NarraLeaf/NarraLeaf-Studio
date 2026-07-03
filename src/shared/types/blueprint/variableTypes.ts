import type { LiteralValue } from "./document";

export const BLUEPRINT_VARIABLE_TYPE_OPTIONS = [
    { value: "string", label: "String", defaultValue: "" },
    { value: "integer", label: "Integer", defaultValue: 0 },
    { value: "float", label: "Float", defaultValue: 0 },
    { value: "boolean", label: "Boolean", defaultValue: false },
    { value: "json", label: "JSON", defaultValue: {} },
    { value: "array", label: "Array", defaultValue: [] },
    { value: "Timer", label: "Timer", defaultValue: null },
    { value: "AnimationToken", label: "AnimationToken", defaultValue: null },
    { value: "any", label: "Any", defaultValue: null },
] as const satisfies ReadonlyArray<{
    value: string;
    label: string;
    defaultValue: LiteralValue;
}>;

export type BlueprintVariableValueType = (typeof BLUEPRINT_VARIABLE_TYPE_OPTIONS)[number]["value"];

function cloneLiteralValue<T extends LiteralValue>(value: T): T {
    if (value === null || typeof value !== "object") {
        return value;
    }
    return JSON.parse(JSON.stringify(value)) as T;
}

export function resolveBlueprintVariableDefaultValue(valueType: string | undefined): LiteralValue | undefined {
    const option = BLUEPRINT_VARIABLE_TYPE_OPTIONS.find(item => item.value === valueType);
    return option ? cloneLiteralValue(option.defaultValue) : undefined;
}
