import { useEffect, useMemo, useState } from "react";
import type { LiteralValue } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_VARIABLE_TYPE_OPTIONS,
    resolveBlueprintVariableDefaultValue,
} from "@shared/types/blueprint/variableTypes";
import { Input, InputGroup } from "@/lib/components/elements/Input";
import { Select, type SelectOption } from "@/lib/components/elements/Select";
import { useTranslation } from "@/lib/i18n";

export type BlueprintVariableDialogValue = {
    name: string;
    valueType: string;
    defaultValue: LiteralValue | undefined;
    valid: boolean;
};

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

export function BlueprintVariableDialogContent({
    defaultName,
    defaultValueType = "string",
    existingNames = [],
    onChange,
}: Props) {
    const { t } = useTranslation();
    const [name, setName] = useState(defaultName);
    const [valueType, setValueType] = useState(defaultValueType);

    const normalizedExistingNames = useMemo(
        () => new Set(existingNames.map(existing => existing.trim().toLowerCase()).filter(Boolean)),
        [existingNames],
    );

    const trimmedName = name.trim();
    const nameError =
        trimmedName.length === 0
            ? t("blueprint.validation.nameRequired")
            : normalizedExistingNames.has(trimmedName.toLowerCase())
              ? t("blueprint.validation.nameExists")
              : undefined;
    const valid = !nameError && BLUEPRINT_VARIABLE_TYPE_OPTIONS.some(option => option.value === valueType);

    useEffect(() => {
        onChange({
            name: trimmedName,
            valueType,
            defaultValue: resolveBlueprintVariableDefaultValue(valueType),
            valid,
        });
    }, [onChange, trimmedName, valid, valueType]);

    return (
        <div className="space-y-4">
            <InputGroup label={t("common.name")} required error={nameError}>
                <Input
                    value={name}
                    onChange={event => setName(event.target.value)}
                    onKeyDown={event => event.stopPropagation()}
                    fullWidth
                    autoFocus
                />
            </InputGroup>
            <InputGroup label={t("blueprint.dialog.dataType")} required>
                <Select
                    fullWidth
                    options={BLUEPRINT_VARIABLE_SELECT_OPTIONS}
                    value={valueType}
                    onChange={value => setValueType(String(value))}
                    placeholder={t("blueprint.dialog.selectDataType")}
                    portalMenu
                />
            </InputGroup>
        </div>
    );
}
