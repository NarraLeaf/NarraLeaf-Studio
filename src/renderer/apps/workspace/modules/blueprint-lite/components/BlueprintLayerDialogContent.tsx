import { useEffect, useMemo, useState } from "react";
import { FileCode2, Plus, Workflow } from "lucide-react";
import { Input, InputGroup } from "@/lib/components/elements/Input";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";

/**
 * What a new layer will be.
 *
 * `graph` carries the name the layer starts with; `script` carries the file it runs, or nothing at
 * all, which means "write me a new one".
 */
export type BlueprintLayerDialogValue =
    | { kind: "graph"; name: string; valid: boolean }
    | { kind: "script"; scriptRef: string | null; valid: boolean };

export function createDefaultBlueprintLayerValue(defaultName: string): BlueprintLayerDialogValue {
    return { kind: "graph", name: defaultName.trim(), valid: defaultName.trim().length > 0 };
}

type Props = {
    defaultName: string;
    /**
     * Every file under `scripts/`, with what already runs it.
     *
     * Files two layers share are a legitimate arrangement rather than a mistake, so one that is
     * already used is offered like any other and says so instead of being hidden. A hidden file is
     * indistinguishable from one Studio failed to notice.
     */
    scriptFiles: readonly { scriptRef: string; usedBy: number }[];
    /** Absent when this slot cannot be written as a script - a value binding is the only one. */
    scriptAllowed: boolean;
    onChange: (value: BlueprintLayerDialogValue) => void;
};

/**
 * The one place a layer's kind is chosen, and the only moment it can be.
 *
 * The choice sits here rather than beside the blueprint, because a layer is what a script actually
 * is: the dispatcher runs every layer that answers an event, so a file and a graph are siblings in
 * one slot. The offer used to be three buttons under a "revisions" list, where choosing a script
 * displaced the whole blueprint.
 *
 * There is no event-head picker. It seeded the new layer with a head node, which the palette adds
 * in one gesture anyway, and it asked an author who had not yet seen a canvas to name the event
 * before the thing that would answer it.
 */
export function BlueprintLayerDialogContent({ defaultName, scriptFiles, scriptAllowed, onChange }: Props) {
    const { t, tn } = useTranslation();
    const [kind, setKind] = useState<"graph" | "script">("graph");
    const [name, setName] = useState(defaultName);
    const [scriptRef, setScriptRef] = useState<string | null>(null);

    const trimmedName = name.trim();
    const nameError = trimmedName.length === 0 ? t("blueprint.validation.nameRequired") : undefined;

    const value = useMemo<BlueprintLayerDialogValue>(
        () =>
            kind === "graph"
                ? { kind, name: trimmedName, valid: !nameError }
                : { kind, scriptRef, valid: true },
        [kind, nameError, scriptRef, trimmedName],
    );

    useEffect(() => {
        onChange(value);
    }, [onChange, value]);

    return (
        <div className="space-y-4">
            {scriptAllowed ? (
                <div className="grid grid-cols-2 gap-2">
                    <KindOption
                        active={kind === "graph"}
                        icon={<Workflow className="h-4 w-4" aria-hidden />}
                        label={t("blueprint.frontend.visual")}
                        description={t("blueprint.layerDialog.graphDescription")}
                        onClick={() => setKind("graph")}
                    />
                    <KindOption
                        active={kind === "script"}
                        icon={<FileCode2 className="h-4 w-4" aria-hidden />}
                        label={t("blueprint.frontend.script")}
                        description={t("blueprint.layerDialog.scriptDescription")}
                        onClick={() => setKind("script")}
                    />
                </div>
            ) : null}

            {kind === "graph" ? (
                <InputGroup label={t("blueprint.eventLayer.layerName")} required error={nameError}>
                    <Input
                        value={name}
                        onChange={event => setName(event.target.value)}
                        onKeyDown={event => event.stopPropagation()}
                        fullWidth
                        autoFocus
                    />
                </InputGroup>
            ) : (
                <div className="space-y-1">
                    <p className="text-2xs text-fg-subtle">{t("blueprint.layerDialog.scriptPickerLabel")}</p>
                    <ul className="max-h-64 space-y-0.5 overflow-y-auto rounded-md border border-edge p-1">
                        <li>
                            <ScriptRow
                                active={scriptRef === null}
                                icon={<Plus className="h-3.5 w-3.5" aria-hidden />}
                                title={t("blueprint.layerDialog.newScript")}
                                detail={t("blueprint.layerDialog.newScriptDetail")}
                                onClick={() => setScriptRef(null)}
                            />
                        </li>
                        {scriptFiles.map(file => (
                            <li key={file.scriptRef}>
                                <ScriptRow
                                    active={scriptRef === file.scriptRef}
                                    icon={<FileCode2 className="h-3.5 w-3.5" aria-hidden />}
                                    title={file.scriptRef}
                                    mono
                                    detail={
                                        file.usedBy > 0
                                            ? tn("blueprint.layerDialog.alreadyRun", file.usedBy)
                                            : t("blueprint.script.unbound")
                                    }
                                    onClick={() => setScriptRef(file.scriptRef)}
                                />
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

function KindOption(props: {
    active: boolean;
    icon: React.ReactNode;
    label: string;
    description: string;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            aria-pressed={props.active}
            onClick={props.onClick}
            className={cn(
                "flex flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left transition-colors",
                props.active
                    ? "border-primary bg-primary/10 text-fg"
                    : "border-edge text-fg-muted hover:bg-fill-subtle",
            )}
        >
            <span className="flex items-center gap-1.5 text-xs font-medium">
                {props.icon}
                {props.label}
            </span>
            <span className="text-2xs text-fg-subtle">{props.description}</span>
        </button>
    );
}

function ScriptRow(props: {
    active: boolean;
    icon: React.ReactNode;
    title: string;
    detail: string;
    mono?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            aria-pressed={props.active}
            onClick={props.onClick}
            className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
                props.active ? "bg-primary/15 text-fg" : "text-fg-muted hover:bg-fill-subtle",
            )}
        >
            <span className="shrink-0 text-fg-subtle">{props.icon}</span>
            <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-2xs", props.mono && "font-mono")}>{props.title}</span>
                <span className="block truncate text-2xs text-fg-subtle">{props.detail}</span>
            </span>
        </button>
    );
}
