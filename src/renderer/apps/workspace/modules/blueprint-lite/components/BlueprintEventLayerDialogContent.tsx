import { useEffect, useMemo, useState } from "react";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_BLUR,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_FOCUS,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_DOUBLE_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_DOWN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_ENTER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_LEAVE,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_MOVE,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_UP,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_WHEEL,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_UNMOUNT,
} from "@shared/types/blueprint/graph";
import { Input, InputGroup } from "@/lib/components/elements/Input";
import { Select, type SelectOption } from "@/lib/components/elements/Select";
import type { BlueprintNodeEditorCatalogEntry } from "@/lib/ui-editor/blueprint-nodes/types";
import { useTranslation } from "@/lib/i18n";
import { resolveBlueprintNodeTitle } from "../blueprintNodeI18n";

export type BlueprintEventLayerEntry = Pick<BlueprintNodeEditorCatalogEntry, "type" | "displayName">;

export type BlueprintEventLayerDialogValue = {
    name: string;
    nodeType: string;
    valid: boolean;
};

const EVENT_HEAD_ORDER = new Map<string, number>([
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT, 10],
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT, 20],
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_UNMOUNT, 30],
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT, 40],
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK, 60],
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_DOUBLE_CLICK, 70],
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_DOWN, 80],
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_UP, 90],
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_ENTER, 100],
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_LEAVE, 110],
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_MOVE, 120],
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_WHEEL, 130],
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK, 140],
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_FOCUS, 150],
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_BLUR, 160],
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL, 170],
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT, 180],
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST, 190],
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST, 200],
]);

export function sortBlueprintEventLayerEntries(
    entries: readonly BlueprintEventLayerEntry[],
): BlueprintEventLayerEntry[] {
    return [...entries].sort((a, b) => {
        const pa = EVENT_HEAD_ORDER.get(a.type) ?? Number.MAX_SAFE_INTEGER;
        const pb = EVENT_HEAD_ORDER.get(b.type) ?? Number.MAX_SAFE_INTEGER;
        if (pa !== pb) {
            return pa - pb;
        }
        return a.displayName.localeCompare(b.displayName);
    });
}

export function createDefaultBlueprintEventLayerValue(
    _entries: readonly BlueprintEventLayerEntry[],
    defaultName: string,
): BlueprintEventLayerDialogValue {
    return {
        name: defaultName.trim(),
        nodeType: "",
        valid: defaultName.trim().length > 0,
    };
}

type Props = {
    entries: readonly BlueprintEventLayerEntry[];
    defaultName: string;
    onChange: (value: BlueprintEventLayerDialogValue) => void;
};

export function BlueprintEventLayerDialogContent({ entries, defaultName, onChange }: Props) {
    const { t } = useTranslation();
    const sortedEntries = useMemo(() => sortBlueprintEventLayerEntries(entries), [entries]);
    const [nodeType, setNodeType] = useState("");
    const [name, setName] = useState(defaultName);
    const entryByType = useMemo(() => new Map(sortedEntries.map(entry => [entry.type, entry])), [sortedEntries]);
    const selectOptions = useMemo<SelectOption[]>(
        () => [
            { value: "", label: "-" },
            ...sortedEntries.map(entry => ({
                value: entry.type,
                label: resolveBlueprintNodeTitle(entry.displayName, t),
                secondaryLabel: entry.type,
            })),
        ],
        [sortedEntries, t],
    );

    const trimmedName = name.trim();
    const nameError = trimmedName.length === 0 ? t("blueprint.validation.nameRequired") : undefined;
    const valid = !nameError && (nodeType === "" || Boolean(entryByType.get(nodeType)));

    useEffect(() => {
        onChange({ name: trimmedName, nodeType, valid });
    }, [nodeType, onChange, trimmedName, valid]);

    return (
        <div className="space-y-4">
            <InputGroup label={t("blueprint.eventLayer.event")}>
                <Select
                    fullWidth
                    options={selectOptions}
                    value={nodeType}
                    onChange={value => {
                        const nextType = String(value);
                        setNodeType(nextType);
                        if (nextType) {
                            const nextEntry = entryByType.get(nextType);
                            setName(nextEntry ? resolveBlueprintNodeTitle(nextEntry.displayName, t) : name);
                        }
                    }}
                    placeholder="-"
                    portalMenu
                />
            </InputGroup>
            <InputGroup label={t("blueprint.eventLayer.layerName")} required error={nameError}>
                <Input
                    value={name}
                    onChange={event => setName(event.target.value)}
                    onKeyDown={event => event.stopPropagation()}
                    fullWidth
                    autoFocus
                />
            </InputGroup>
        </div>
    );
}
