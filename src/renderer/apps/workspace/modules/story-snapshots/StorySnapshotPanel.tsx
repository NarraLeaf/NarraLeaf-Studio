/**
 * Scene Snapshot panel (变量快照, right sidebar). Active while a Story scene editor is focused. A
 * snapshot is a named set of variable override values used to launch a row-precise Dev Mode preview
 * under conditions the editor cannot analyse statically (e.g. a global flag). The table lists every
 * variable in scope for the current scene (scene + saved + persistent); switching scene tabs re-binds
 * it. Comments in English per convention.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Camera, Plus, Trash2 } from "lucide-react";
import type { PanelComponentProps } from "../types";
import { useTranslation } from "@/lib/i18n";
import { Select, type SelectOption } from "@/lib/components/elements";
import { useWorkspace } from "@/apps/workspace/context";
import { useFreezeGuard, type FreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { Services } from "@/lib/workspace/services/services";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import { getSelectedSnapshotId, setSelectedSnapshotId } from "./storySnapshotSelection";
import type {
    StoryDocument,
    StoryLiteralValue,
    StorySceneSnapshot,
    StoryVariableValueType,
} from "@shared/types/story";
import { savedVariableDefs, sceneVariableDefs, storyPersistentDefs } from "@shared/types/story";
import type { StorySnapshotPanelPayload } from "./storySnapshotPanelId";

const INPUT_CLASS =
    "h-7 min-w-0 flex-1 rounded-md border border-edge bg-surface-raised px-2 text-xs text-fg outline-none focus:border-primary/50";

function asStoryValueType(valueType: string | undefined): StoryVariableValueType {
    return valueType === "boolean" || valueType === "number" || valueType === "string" ? valueType : "json";
}

function formatValue(value: StoryLiteralValue | undefined, valueType: StoryVariableValueType): string {
    if (value === undefined || value === null) return "";
    if (valueType === "json") return typeof value === "string" ? value : JSON.stringify(value);
    return String(value);
}

function parseValue(text: string, valueType: StoryVariableValueType): StoryLiteralValue {
    if (valueType === "boolean") return text.trim() === "true";
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

type SnapshotVarEntry = {
    refKey: string;
    name: string;
    valueType: StoryVariableValueType;
    defaultValue?: StoryLiteralValue;
};

function SnapshotValueRow(props: {
    entry: SnapshotVarEntry;
    /** The snapshot's explicit override for this variable, or undefined when it falls back to the default. */
    value: StoryLiteralValue | undefined;
    onChange: (raw: string) => void;
    onClear: () => void;
    booleanOptions: SelectOption[];
    /**
     * The panel's guard, handed down. Every control on this row edits the snapshot, which is part of
     * the story document, and the row had no guard of its own: on a frozen project the author could
     * set an override, watch the box take it, and lose it on thaw.
     */
    freeze: FreezeGuard;
}) {
    const { entry, value, freeze } = props;
    const overridden = value !== undefined;
    const shown = overridden ? formatValue(value, entry.valueType) : "";
    return (
        <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-xs text-fg" title={entry.name}>{entry.name}</span>
            {entry.valueType === "boolean" ? (
                // `readOnly` rather than `disabled`: which way a boolean was pinned, and that true and
                // false are the only choices, is what the reader came for, so the list still opens.
                <Select
                    options={props.booleanOptions}
                    value={overridden ? String(value === true) : ""}
                    onChange={next => props.onChange(String(next))}
                    size="sm"
                    portalMenu
                    readOnly={freeze.frozen}
                    className="w-28 shrink-0"
                />
            ) : (
                // Likewise the value box: the override is the thing being read, and a disabled input
                // is dimmed past reading.
                <input
                    className={`${INPUT_CLASS} max-w-[9rem] ${overridden ? "" : "border-dashed"}`}
                    value={shown}
                    placeholder={formatValue(entry.defaultValue, entry.valueType)}
                    inputMode={entry.valueType === "number" ? "decimal" : undefined}
                    onChange={event => props.onChange(event.target.value)}
                    readOnly={freeze.frozen}
                    title={freeze.frozen ? freeze.reason : undefined}
                />
            )}
            {/* Dropping an override rewrites the snapshot as much as setting one does. */}
            <button
                type="button"
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-subtle transition disabled:cursor-not-allowed disabled:opacity-40 ${overridden ? "hover:bg-fill hover:text-danger" : "pointer-events-none opacity-0"}`}
                onClick={props.onClear}
                aria-label="clear"
                {...freeze.writes(false, props.entry.name)}
            >
                <Trash2 className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}

export function StorySnapshotPanel({ payload }: PanelComponentProps<StorySnapshotPanelPayload>) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    // A snapshot is authored content (it ships in the story document), so making and deleting one is a
    // write. Picking which snapshot is shown is not, and stays live.
    const freeze = useFreezeGuard();
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
    const panelStateService = useMemo(
        () => (context && isInitialized ? context.services.get<PanelStateService>(Services.PanelState) : null),
        [context, isInitialized],
    );

    const [document, setDocument] = useState<StoryDocument | null>(null);
    const [blueprintPersistent, setBlueprintPersistent] = useState<SnapshotVarEntry[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);

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
            setBlueprintPersistent(
                blueprintService.listPersistentVariables().map(variable => ({
                    refKey: `persistent:${variable.storageKey}`,
                    name: variable.name,
                    valueType: asStoryValueType(variable.valueType),
                    defaultValue: variable.defaultValue as StoryLiteralValue | undefined,
                })),
            );
        read();
        return blueprintService.onBlueprintHistoryChanged(read);
    }, [blueprintService]);

    const snapshots: StorySceneSnapshot[] = useMemo(() => {
        if (!document || !sceneId) return [];
        return document.scenes[sceneId]?.sceneSnapshots ?? [];
    }, [document, sceneId]);

    // Keep the selection valid as the scene changes (payload.sceneId) or snapshots are added/removed,
    // preferring the author's last choice for this scene (shared with the row ▶ launcher).
    useEffect(() => {
        setSelectedId(current => {
            if (current && snapshots.some(snapshot => snapshot.id === current)) return current;
            const saved = panelStateService && storyId && sceneId
                ? getSelectedSnapshotId(panelStateService, storyId, sceneId)
                : undefined;
            if (saved && snapshots.some(snapshot => snapshot.id === saved)) return saved;
            return snapshots[0]?.id ?? null;
        });
    }, [snapshots, sceneId, panelStateService, storyId]);

    // Publish the selection so the tab's launcher uses the same snapshot the dropdown shows.
    useEffect(() => {
        if (panelStateService && storyId && sceneId && selectedId) {
            setSelectedSnapshotId(panelStateService, storyId, sceneId, selectedId);
        }
    }, [panelStateService, storyId, sceneId, selectedId]);

    const selected = useMemo(() => snapshots.find(snapshot => snapshot.id === selectedId) ?? null, [snapshots, selectedId]);

    // Every variable the current scene can address, in scope-chain order (scene → saved → persistent).
    const entries = useMemo<SnapshotVarEntry[]>(() => {
        if (!document || !sceneId) return [];
        const scene = document.scenes[sceneId];
        if (!scene) return [];
        const list: SnapshotVarEntry[] = [];
        for (const def of Object.values(sceneVariableDefs(scene))) {
            list.push({ refKey: `scene:${def.id}`, name: def.name, valueType: def.valueType, defaultValue: def.defaultValue });
        }
        for (const def of Object.values(savedVariableDefs(document))) {
            list.push({ refKey: `saved:${def.id}`, name: def.name, valueType: def.valueType, defaultValue: def.defaultValue });
        }
        const seen = new Set<string>();
        for (const def of Object.values(storyPersistentDefs(document))) {
            const refKey = `persistent:${def.storageKey}`;
            seen.add(refKey);
            list.push({ refKey, name: def.name, valueType: def.valueType, defaultValue: def.defaultValue });
        }
        for (const entry of blueprintPersistent) {
            if (seen.has(entry.refKey)) continue;
            list.push(entry);
        }
        return list;
    }, [document, sceneId, blueprintPersistent]);

    const booleanOptions: SelectOption[] = useMemo(
        () => [
            { value: "true", label: t("storySnapshot.value.true") },
            { value: "false", label: t("storySnapshot.value.false") },
        ],
        [t],
    );
    const snapshotOptions: SelectOption[] = useMemo(
        () => snapshots.map(snapshot => ({ value: snapshot.id, label: snapshot.name })),
        [snapshots],
    );

    const addSnapshot = useCallback(() => {
        if (!storyService || !storyId || !sceneId) return;
        const name = `${t("storySnapshot.defaultName")} ${snapshots.length + 1}`;
        const id = storyService.createSceneSnapshot(storyId, sceneId, name);
        if (id) setSelectedId(id);
    }, [storyService, storyId, sceneId, snapshots.length, t]);

    if (!storyId || !sceneId) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-fg-subtle">
                <Camera className="h-5 w-5" />
                {t("storySnapshot.empty")}
            </div>
        );
    }

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface">
            <div className="flex items-center gap-1.5 border-b border-edge px-3 py-2.5">
                {snapshots.length > 0 ? (
                    <Select
                        options={snapshotOptions}
                        value={selectedId ?? ""}
                        onChange={value => setSelectedId(String(value))}
                        size="sm"
                        className="min-w-0 flex-1"
                    />
                ) : (
                    // No snapshots: no picker, and nothing in its place. The Add button at the end of
                    // this same row is the way to make the first one.
                    <span className="min-w-0 flex-1" />
                )}
                {selected ? (
                    <button
                        type="button"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-edge text-fg-subtle hover:border-danger/50 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => storyService?.deleteSceneSnapshot(storyId, sceneId, selected.id)}
                        {...freeze.writes(false, t("storySnapshot.delete"))}
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </button>
                ) : null}
                <button
                    type="button"
                    className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-edge px-2 text-2xs text-fg-muted hover:border-primary/50 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={addSnapshot}
                    {...freeze.writes(false, t("storySnapshot.add"))}
                >
                    <Plus className="h-3 w-3" /> {t("common.add")}
                </button>
            </div>

            {selected ? (
                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                    {selected.name !== undefined ? (
                        // Renaming a snapshot writes the story document, and until this pass only the
                        // Add and Delete buttons above knew about the freeze: on a frozen project the
                        // box accepted a new name, showed it, and discarded it on thaw. `readOnly`
                        // rather than `disabled` - the name is what the reader is here to see.
                        <input
                            className={`${INPUT_CLASS} mb-3 h-8`}
                            value={selected.name}
                            onChange={event => storyService?.renameSceneSnapshot(storyId, sceneId, selected.id, event.target.value)}
                            readOnly={freeze.frozen}
                            title={freeze.frozen ? freeze.reason : undefined}
                            aria-label={t("storySnapshot.nameAria")}
                        />
                    ) : null}
                    {entries.length === 0 ? (
                        <div className="text-2xs text-fg-subtle">{t("storySnapshot.noVariables")}</div>
                    ) : (
                        <div className="flex flex-col gap-1.5">
                            {entries.map(entry => (
                                <SnapshotValueRow
                                    key={entry.refKey}
                                    entry={entry}
                                    value={selected.values[entry.refKey]}
                                    booleanOptions={booleanOptions}
                                    freeze={freeze}
                                    onChange={raw => storyService?.setSceneSnapshotValue(storyId, sceneId, selected.id, entry.refKey, parseValue(raw, entry.valueType))}
                                    onClear={() => storyService?.clearSceneSnapshotValue(storyId, sceneId, selected.id, entry.refKey)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs text-fg-subtle">
                    <Camera className="h-5 w-5" />
                    {t("storySnapshot.getStarted")}
                </div>
            )}
        </div>
    );
}
