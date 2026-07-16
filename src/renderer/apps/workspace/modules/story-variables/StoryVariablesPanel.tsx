/**
 * Story Variables panel (right sidebar). Active while a Story scene editor is focused; lets authors
 * declare/manage Scene variables (current scene) and Saved variables (document), and shows the
 * shared Persistent variables (authored in the blueprint system). Comments in English per convention.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { HelpCircle, Plus, Trash2, Variable } from "lucide-react";
import type { PanelComponentProps } from "../types";
import { useTranslation } from "@/lib/i18n";
import { Select, type SelectOption } from "@/lib/components/elements";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type {
    StoryDocument,
    StoryLiteralValue,
    StorySavedVariableDefinition,
    StorySceneVariableDefinition,
    StoryVariableValueType,
} from "@shared/types/story";
import type { StoryVariablesPanelPayload } from "./storyVariablesPanelId";

const INPUT_CLASS =
    "h-7 min-w-0 flex-1 rounded border border-edge bg-surface-raised px-2 text-xs text-fg outline-none focus:border-primary/50";

function defaultForType(valueType: StoryVariableValueType): StoryLiteralValue {
    if (valueType === "boolean") return false;
    if (valueType === "number") return 0;
    if (valueType === "json") return {};
    return "";
}

function formatDefault(value: StoryLiteralValue | undefined, valueType: StoryVariableValueType): string {
    if (value === undefined || value === null) return "";
    if (valueType === "json") return typeof value === "string" ? value : JSON.stringify(value);
    return String(value);
}

function parseDefault(text: string, valueType: StoryVariableValueType): StoryLiteralValue {
    if (valueType === "boolean") return text === "true";
    if (valueType === "number") {
        const n = Number(text);
        return Number.isFinite(n) ? n : 0;
    }
    if (valueType === "json") {
        try {
            return JSON.parse(text) as StoryLiteralValue;
        } catch {
            return text;
        }
    }
    return text;
}

type VariableRow = { id: string; name: string; valueType: StoryVariableValueType; defaultValue?: StoryLiteralValue };

function VariableRowEditor(props: {
    row: VariableRow;
    onRename: (name: string) => void;
    onRetype: (valueType: StoryVariableValueType) => void;
    onDefault: (value: StoryLiteralValue) => void;
    onDelete: () => void;
}) {
    const { t } = useTranslation();
    const valueTypeOptions: SelectOption[] = useMemo(
        () => [
            { value: "boolean", label: t("storyVars.valueType.boolean") },
            { value: "number", label: t("storyVars.valueType.number") },
            { value: "string", label: t("storyVars.valueType.string") },
            { value: "json", label: t("storyVars.valueType.json") },
        ],
        [t],
    );
    return (
        <div className="flex items-center gap-1.5">
            <input
                className={INPUT_CLASS}
                value={props.row.name}
                onChange={event => props.onRename(event.target.value)}
                aria-label={t("storyVars.row.nameAria")}
            />
            <Select
                options={valueTypeOptions}
                value={props.row.valueType}
                onChange={value => props.onRetype(String(value) as StoryVariableValueType)}
                size="sm"
                portalMenu
                className="w-24 shrink-0"
            />
            <input
                className={INPUT_CLASS}
                value={formatDefault(props.row.defaultValue, props.row.valueType)}
                placeholder={t("storyVars.row.defaultPlaceholder")}
                onChange={event => props.onDefault(parseDefault(event.target.value, props.row.valueType))}
                aria-label={t("storyVars.row.defaultAria")}
            />
            <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded text-fg-subtle hover:bg-fill hover:text-danger"
                onClick={props.onDelete}
                title={t("storyVars.row.delete")}
            >
                <Trash2 className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}

/**
 * A compact "?" affordance that reveals its explanation in a hover/focus popover, keeping the
 * category header uncluttered (the description no longer sits as a permanent caption line).
 */
function HintPopover(props: { text: string }) {
    return (
        <span className="group/hint relative inline-flex">
            <button
                type="button"
                aria-label={props.text}
                className="flex h-4 w-4 items-center justify-center rounded-full text-fg-subtle outline-none transition-colors hover:text-fg-muted focus-visible:text-fg-muted"
            >
                <HelpCircle className="h-3.5 w-3.5" />
            </button>
            <span
                role="tooltip"
                className="pointer-events-none absolute left-0 top-full z-30 mt-1 w-44 rounded-md border border-edge bg-surface-raised px-2 py-1.5 text-2xs leading-snug text-fg-muted opacity-0 shadow-xl transition-opacity duration-100 group-hover/hint:opacity-100 group-focus-within/hint:opacity-100"
            >
                {props.text}
            </span>
        </span>
    );
}

function SectionHeader(props: { title: string; hint: string; onAdd?: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="flex items-center justify-between">
            <div className="flex min-w-0 items-center gap-1">
                <div className="truncate text-xs font-medium text-fg">{props.title}</div>
                <HintPopover text={props.hint} />
            </div>
            {props.onAdd ? (
                <button
                    type="button"
                    className="flex h-6 items-center gap-1 rounded border border-edge px-2 text-2xs text-fg-muted hover:border-primary/50 hover:text-fg"
                    onClick={props.onAdd}
                >
                    <Plus className="h-3 w-3" /> {t("common.add")}
                </button>
            ) : null}
        </div>
    );
}

export function StoryVariablesPanel({ payload }: PanelComponentProps<StoryVariablesPanelPayload>) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const storyId = payload?.storyId;
    const sceneId = payload?.sceneId;

    const storyService = useMemo(
        () => (context && isInitialized ? context.services.get<StoryService>(Services.Story) : null),
        [context, isInitialized],
    );
    const blueprintService = useMemo(
        () => (context && isInitialized ? context.services.get<LocalBlueprintService>(Services.LocalBlueprint) : null),
        [context, isInitialized],
    );

    const [document, setDocument] = useState<StoryDocument | null>(null);
    const [persistent, setPersistent] = useState<{ name: string; valueType: string }[]>([]);

    useEffect(() => {
        if (!storyService || !storyId) {
            setDocument(null);
            return;
        }
        const read = () => {
            try {
                setDocument({ ...storyService.getStoryDocument(storyId) });
            } catch {
                setDocument(null);
            }
        };
        read();
        return storyService.onDocumentChanged(event => {
            if (event.storyId === storyId) setDocument({ ...event.document });
        });
    }, [storyService, storyId]);

    useEffect(() => {
        if (!blueprintService) return;
        const read = () =>
            setPersistent(
                blueprintService.listPersistentVariables().map(variable => ({
                    name: variable.name,
                    valueType: variable.valueType ?? "string",
                })),
            );
        read();
        return blueprintService.onBlueprintHistoryChanged(read);
    }, [blueprintService]);

    const sceneRows: VariableRow[] = useMemo(() => {
        if (!document || !sceneId) return [];
        return Object.values(document.scenes[sceneId]?.sceneVariables ?? {});
    }, [document, sceneId]);

    const savedRows: VariableRow[] = useMemo(() => Object.values(document?.savedVariables ?? {}), [document]);

    const addScene = useCallback(() => {
        if (storyService && storyId && sceneId) {
            storyService.createSceneVariable(storyId, sceneId, { name: "variable", valueType: "boolean", defaultValue: false });
        }
    }, [storyService, storyId, sceneId]);

    const addSaved = useCallback(() => {
        if (storyService && storyId) {
            storyService.createSavedVariable(storyId, { name: "variable", valueType: "boolean", defaultValue: false });
        }
    }, [storyService, storyId]);

    if (!storyId || !sceneId) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-fg-subtle">
                <Variable className="h-5 w-5" />
                {t("storyVars.empty")}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4 overflow-y-auto p-3">
            <div className="flex flex-col gap-2">
                <SectionHeader title={t("storyVars.scene.title")} hint={t("storyVars.scene.hint")} onAdd={addScene} />
                <div className="flex flex-col gap-1.5">
                    {sceneRows.length === 0 ? (
                        <div className="text-2xs text-fg-subtle">{t("storyVars.scene.empty")}</div>
                    ) : (
                        sceneRows.map(row => (
                            <VariableRowEditor
                                key={row.id}
                                row={row}
                                onRename={name => storyService?.renameSceneVariable(storyId, sceneId, row.id, name)}
                                onRetype={valueType => {
                                    storyService?.retypeSceneVariable(storyId, sceneId, row.id, valueType);
                                    storyService?.setSceneVariableDefault(storyId, sceneId, row.id, defaultForType(valueType));
                                }}
                                onDefault={value => storyService?.setSceneVariableDefault(storyId, sceneId, row.id, value)}
                                onDelete={() => storyService?.deleteSceneVariable(storyId, sceneId, row.id)}
                            />
                        ))
                    )}
                </div>
            </div>

            <div className="flex flex-col gap-2">
                <SectionHeader title={t("storyVars.saved.title")} hint={t("storyVars.saved.hint")} onAdd={addSaved} />
                <div className="flex flex-col gap-1.5">
                    {savedRows.length === 0 ? (
                        <div className="text-2xs text-fg-subtle">{t("storyVars.saved.empty")}</div>
                    ) : (
                        savedRows.map(row => (
                            <VariableRowEditor
                                key={row.id}
                                row={row}
                                onRename={name => storyService?.renameSavedVariable(storyId, row.id, name)}
                                onRetype={valueType => {
                                    storyService?.retypeSavedVariable(storyId, row.id, valueType);
                                    storyService?.setSavedVariableDefault(storyId, row.id, defaultForType(valueType));
                                }}
                                onDefault={value => storyService?.setSavedVariableDefault(storyId, row.id, value)}
                                onDelete={() => storyService?.deleteSavedVariable(storyId, row.id)}
                            />
                        ))
                    )}
                </div>
            </div>

            <div className="flex flex-col gap-2">
                <SectionHeader title={t("storyVars.persistent.title")} hint={t("storyVars.persistent.hint")} />
                <div className="flex flex-col gap-1.5">
                    {persistent.length === 0 ? (
                        <div className="text-2xs text-fg-subtle">{t("storyVars.persistent.empty")}</div>
                    ) : (
                        persistent.map(variable => (
                            <div key={variable.name} className="flex items-center justify-between rounded border border-edge-subtle px-2 py-1 text-xs text-fg-muted">
                                <span className="truncate">{variable.name}</span>
                                <span className="text-2xs text-fg-subtle">{variable.valueType}</span>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
