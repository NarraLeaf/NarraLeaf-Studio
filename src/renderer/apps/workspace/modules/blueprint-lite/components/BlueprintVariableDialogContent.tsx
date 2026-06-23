import { useEffect, useMemo, useState } from "react";
import type { LiteralValue } from "@shared/types/blueprint/document";
import { Input, InputGroup } from "@/lib/components/elements/Input";
import { Select, type SelectOption } from "@/lib/components/elements/Select";

export type BlueprintVariableDialogValue = {
    name: string;
    valueType: string;
    defaultValue: LiteralValue | undefined;
    valid: boolean;
};

export const BLUEPRINT_VARIABLE_TYPE_OPTIONS = [
    { value: "string", label: "String", defaultValue: "" },
    { value: "integer", label: "Integer", defaultValue: 0 },
    { value: "float", label: "Float", defaultValue: 0 },
    { value: "boolean", label: "Boolean", defaultValue: false },
    { value: "any", label: "Any", defaultValue: null },
] as const satisfies ReadonlyArray<{
    value: string;
    label: string;
    defaultValue: LiteralValue;
}>;

const BLUEPRINT_VARIABLE_SELECT_OPTIONS: SelectOption[] = BLUEPRINT_VARIABLE_TYPE_OPTIONS.map(option => ({
    value: option.value,
    label: option.label,
}));

type Props = {
    defaultName: string;
    defaultValueType?: string;
    existingNames?: readonly string[];
    onChange: (value: BlueprintVariableDialogValue) => void;
};

function resolveDefaultValue(valueType: string): LiteralValue | undefined {
    return BLUEPRINT_VARIABLE_TYPE_OPTIONS.find(option => option.value === valueType)?.defaultValue;
}

export function BlueprintVariableDialogContent({
    defaultName,
    defaultValueType = "string",
    existingNames = [],
    onChange,
}: Props) {
    const [name, setName] = useState(defaultName);
    const [valueType, setValueType] = useState(defaultValueType);

    const normalizedExistingNames = useMemo(
        () => new Set(existingNames.map(existing => existing.trim().toLowerCase()).filter(Boolean)),
        [existingNames],
    );

    const trimmedName = name.trim();
    const nameError =
        trimmedName.length === 0
            ? "Name is required"
            : normalizedExistingNames.has(trimmedName.toLowerCase())
              ? "A variable with this name already exists"
              : undefined;
    const valid = !nameError && BLUEPRINT_VARIABLE_TYPE_OPTIONS.some(option => option.value === valueType);

    useEffect(() => {
        onChange({
            name: trimmedName,
            valueType,
            defaultValue: resolveDefaultValue(valueType),
            valid,
        });
    }, [onChange, trimmedName, valid, valueType]);

    return (
        <div className="space-y-4">
            <InputGroup label="Name" required error={nameError}>
                <Input
                    value={name}
                    onChange={event => setName(event.target.value)}
                    onKeyDown={event => event.stopPropagation()}
                    fullWidth
                    autoFocus
                />
            </InputGroup>
            <InputGroup label="Data type" required>
                <Select
                    fullWidth
                    options={BLUEPRINT_VARIABLE_SELECT_OPTIONS}
                    value={valueType}
                    onChange={value => setValueType(String(value))}
                    placeholder="Select data type"
                    portalMenu
                />
            </InputGroup>
        </div>
    );
}
