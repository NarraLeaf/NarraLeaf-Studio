import type {
    StoryActionPayload,
    StoryBlock,
    StoryCodePayload,
    StoryControlPayload,
    StoryDocument,
    StoryTransformRef,
    StoryTextSegment,
    StoryVariableScope,
} from "@shared/types/story";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image as ImageIcon, Palette, Trash2 } from "lucide-react";
import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { useWorkspace } from "@/apps/workspace/context";
import { EnhancedInput } from "@/lib/components/inputs/EnhancedInput";
import type { Character } from "@/lib/workspace/services/character/Character";
import { Select, type SelectOption } from "@/lib/components/elements";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import { colorValueToCss, parseColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import type { ColorValue } from "@/apps/workspace/modules/properties/framework/types";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { Services } from "@/lib/workspace/services/services";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { describeBlock, getBlockBadgeInfo } from "./storySceneBlockUtils";

const FIELD_LABEL_CLASS = "block text-xs font-medium text-gray-400 mb-1";
const TEXTAREA_CLASS = "w-full resize-none rounded-md border border-white/10 bg-[#1e1f22] px-3 py-2 text-sm text-gray-300 outline-none transition-colors focus:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50";
const SELECT_CLASS = "[&>button]:h-9 [&>button]:min-h-[34px] [&>button]:py-0";

const VARIABLE_SCOPE_OPTIONS: SelectOption[] = [
    { value: "sceneLocal", label: "Scene local" },
    { value: "studioGlobal", label: "Studio global" },
    { value: "gamePersistent", label: "Game persistent" },
];

const CHARACTER_PRESET_OPTIONS: SelectOption[] = [
    { value: "", label: "None" },
    { value: "left", label: "Left" },
    { value: "center", label: "Center" },
    { value: "right", label: "Right" },
];

const WAIT_MODE_OPTIONS: SelectOption[] = [
    { value: "duration", label: "Duration" },
    { value: "click", label: "Click" },
];

const BRANCH_OPTIONS: SelectOption[] = [
    { value: "if", label: "If" },
    { value: "elseIf", label: "Else if" },
    { value: "else", label: "Else" },
];

const CODE_LANGUAGE_OPTIONS: SelectOption[] = [
    { value: "narraleaf", label: "NarraLeaf" },
    { value: "typescript", label: "TypeScript" },
    { value: "javascript", label: "JavaScript" },
];

export function ActionInspector(props: {
    block: StoryBlock;
    document: StoryDocument;
    characters: Character[];
    onUpdatePayload: (payload: StoryBlock["payload"]) => void;
    onClose: () => void;
    onSetDialogueCharacter: (characterId: string | undefined) => void;
    generateTextId: () => string;
}) {
    const block = props.block;
    const { label, icon: Icon, iconColor } = getBlockBadgeInfo(block);

    return (
        <div
            className="mt-2 max-w-3xl rounded-xl border border-white/10 bg-[#16191e] p-3 shadow-lg"
            onClick={event => event.stopPropagation()}
            onMouseDown={event => event.stopPropagation()}
        >
            <div className="mb-3 flex items-center gap-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.04]">
                    <Icon className="h-4 w-4" style={{ color: iconColor }} />
                </span>
                <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-100">{label}</div>
                    <div className="truncate text-xs text-slate-500">{describeBlock(block, props.characters)}</div>
                </div>
            </div>
            <InspectorFields
                block={block}
                document={props.document}
                characters={props.characters}
                onUpdatePayload={props.onUpdatePayload}
                onSetDialogueCharacter={props.onSetDialogueCharacter}
                generateTextId={props.generateTextId}
            />
        </div>
    );
}

function InspectorFields(props: {
    block: StoryBlock;
    document: StoryDocument;
    characters: Character[];
    onUpdatePayload: (payload: StoryBlock["payload"]) => void;
    onSetDialogueCharacter: (characterId: string | undefined) => void;
    generateTextId: () => string;
}) {
    const { block } = props;
    if (block.kind === "nodeAction") {
        const payload = block.payload;
        if (payload.action === "dialogue") {
            const characterOptions: SelectOption[] = [
                { value: "", label: "Unassigned" },
                ...props.characters.map(character => ({
                    value: character.profile.getId(),
                    label: character.profile.getName(),
                })),
            ];
            return (
                <div className="grid gap-2 sm:grid-cols-2">
                    <SelectField
                        label="Character"
                        options={characterOptions}
                        value={payload.characterId ?? ""}
                        onChange={value => props.onSetDialogueCharacter(String(value) || undefined)}
                    />
                    <TextIdReadout text={payload.text} />
                </div>
            );
        }
        if (payload.action === "choice") {
            return (
                <TextSegmentEditor
                    label="Prompt"
                    text={payload.prompt}
                    role="choicePrompt"
                    generateTextId={props.generateTextId}
                    onChange={text => props.onUpdatePayload({ ...payload, prompt: text })}
                />
            );
        }
        if (payload.action === "choiceOption") {
            return (
                <TextSegmentEditor
                    label="Option text"
                    text={payload.text}
                    role="choiceText"
                    generateTextId={props.generateTextId}
                    onChange={text => props.onUpdatePayload({ ...payload, text })}
                />
            );
        }
    }
    if (block.kind === "action") {
        return <ActionPayloadFields payload={block.payload} onChange={props.onUpdatePayload} />;
    }
    if (block.kind === "control") {
        return <ControlPayloadFields payload={block.payload} onChange={props.onUpdatePayload} />;
    }
    if (block.kind === "jump") {
        const payload = block.payload;
        const sceneOptions = Object.values(props.document.scenes).map(scene => ({
            value: scene.id,
            label: scene.name,
        }));
        return (
            <div className="max-w-sm">
                <SelectField
                    label="Target scene"
                    options={sceneOptions}
                    value={payload.targetSceneId}
                    onChange={targetSceneId => props.onUpdatePayload({ ...payload, targetSceneId: String(targetSceneId) })}
                />
            </div>
        );
    }
    if (block.kind === "code") {
        return <CodePayloadFields payload={block.payload} onChange={props.onUpdatePayload} />;
    }
    if (block.kind === "note") {
        return (
            <TextSegmentEditor
                label="Note"
                text={block.payload.text}
                role="note"
                generateTextId={props.generateTextId}
                onChange={text => props.onUpdatePayload({ ...block.payload, text })}
            />
        );
    }
    return <div className="text-sm text-slate-400">No editable fields for this action yet.</div>;
}

function ActionPayloadFields(props: { payload: StoryActionPayload; onChange: (payload: StoryBlock["payload"]) => void }) {
    const payload = props.payload;
    if (payload.action === "setBackground") {
        return (
            <BackgroundActionEditor
                payload={payload}
                onChange={props.onChange}
            />
        );
    }
    if (payload.action === "character") {
        return (
            <div className="grid gap-2 sm:grid-cols-3">
                <TextField label="Character id" value={payload.characterId ?? ""} onChange={characterId => props.onChange({ ...payload, characterId })} />
                <TextField label="Asset id" value={payload.assetId ?? ""} onChange={assetId => props.onChange({ ...payload, assetId })} />
                <TextField
                    label="Preset"
                    value={payload.transform?.preset ?? ""}
                    onChange={preset => props.onChange({ ...payload, transform: { ...payload.transform, preset: preset ? (preset as StoryTransformRef["preset"]) : undefined } })}
                    options={CHARACTER_PRESET_OPTIONS}
                />
                <NumberField
                    label="Duration ms"
                    value={payload.transform?.durationMs}
                    onChange={durationMs => props.onChange({ ...payload, transform: { ...payload.transform, durationMs } })}
                />
            </div>
        );
    }
    if (payload.action === "audio") {
        return (
            <div className="grid gap-2 sm:grid-cols-2">
                <TextField label="Asset id" value={payload.assetId ?? ""} onChange={assetId => props.onChange({ ...payload, assetId })} />
                <NumberField label="Fade ms" value={payload.fadeMs} onChange={fadeMs => props.onChange({ ...payload, fadeMs })} />
            </div>
        );
    }
    if (payload.action === "setVariable") {
        return (
            <div className="grid gap-2 sm:grid-cols-3">
                <TextField label="Key" value={payload.target.key} onChange={key => props.onChange({ ...payload, target: { ...payload.target, key } })} />
                <SelectField
                    label="Scope"
                    options={VARIABLE_SCOPE_OPTIONS}
                    value={payload.target.scope}
                    onChange={scope => props.onChange({ ...payload, target: { ...payload.target, scope: scope as StoryVariableScope } })}
                />
                <TextField label="Value" value={String(payload.value ?? "")} onChange={value => props.onChange({ ...payload, value })} />
            </div>
        );
    }
    if (payload.action === "wait") {
        return (
            <div className="grid gap-2 sm:grid-cols-2">
                <SelectField
                    label="Mode"
                    options={WAIT_MODE_OPTIONS}
                    value={payload.mode}
                    onChange={mode => props.onChange({ ...payload, mode: mode as "duration" | "click" })}
                />
                <NumberField label="Duration ms" value={payload.durationMs} onChange={durationMs => props.onChange({ ...payload, durationMs })} />
            </div>
        );
    }
    return null;
}

function BackgroundActionEditor(props: {
    payload: Extract<StoryActionPayload, { action: "setBackground" }>;
    onChange: (payload: Extract<StoryActionPayload, { action: "setBackground" }>) => void;
}) {
    const { context, isInitialized } = useWorkspace();
    const assetsService = useMemo(
        () => context && isInitialized ? context.services.get<AssetsService>(Services.Assets) : null,
        [context, isInitialized],
    );
    const selectedAsset = props.payload.assetId
        ? assetsService?.getAssets()[AssetType.Image]?.[props.payload.assetId] ?? null
        : null;
    const imageAssetId = props.payload.assetId ?? null;
    const { url, loading, error } = useAssetObjectUrl(imageAssetId);
    const [mode, setMode] = useState<"image" | "color">(() => props.payload.assetId ? "image" : "color");
    const [selectorOpen, setSelectorOpen] = useState(false);
    const imageButtonRef = useRef<HTMLButtonElement | null>(null);
    const latestPayloadRef = useRef(props.payload);
    const latestOnChangeRef = useRef(props.onChange);

    useEffect(() => {
        latestPayloadRef.current = props.payload;
        latestOnChangeRef.current = props.onChange;
    }, [props.payload, props.onChange]);

    const selectImageMode = useCallback(() => {
        setMode("image");
    }, []);

    const selectColorMode = useCallback(() => {
        setMode("color");
    }, []);

    const handleSelectImage = useCallback(
        (assets: Asset[]) => {
            const selected = assets[0];
            if (!selected) {
                return;
            }
            latestOnChangeRef.current({
                ...latestPayloadRef.current,
                assetId: selected.id,
                color: undefined,
            });
            setMode("image");
            setSelectorOpen(false);
        },
        [],
    );

    const clearImage = useCallback(() => {
        latestOnChangeRef.current({
            ...latestPayloadRef.current,
            assetId: undefined,
        });
    }, []);

    const handleColorChange = useCallback(
        (colorValue: ColorValue) => {
            latestOnChangeRef.current({
                ...latestPayloadRef.current,
                assetId: undefined,
                color: colorValueToCss({ hex: colorValue.hex, alpha: 1 }),
            });
        },
        [],
    );

    const parsedColorValue = parseColorValue(props.payload.color, {
        hex: "#000000",
        alpha: 1,
    });
    const colorValue: ColorValue = { hex: parsedColorValue.hex, alpha: 1 };
    const imageLabel = selectedAsset?.name ?? (props.payload.assetId ? "Missing image" : "No image");

    return (
        <div className="grid gap-3">
            <div className="inline-flex w-fit overflow-hidden rounded-md border border-white/10 bg-[#101216]">
                <button
                    type="button"
                    className={[
                        "flex h-8 items-center gap-1.5 px-3 text-xs transition-colors",
                        mode === "image" ? "bg-primary/20 text-primary" : "text-slate-400 hover:bg-white/[0.05] hover:text-slate-100",
                    ].join(" ")}
                    onClick={selectImageMode}
                >
                    <ImageIcon className="h-3.5 w-3.5" />
                    Image
                </button>
                <button
                    type="button"
                    className={[
                        "flex h-8 items-center gap-1.5 border-l border-white/10 px-3 text-xs transition-colors",
                        mode === "color" ? "bg-primary/20 text-primary" : "text-slate-400 hover:bg-white/[0.05] hover:text-slate-100",
                    ].join(" ")}
                    onClick={selectColorMode}
                >
                    <Palette className="h-3.5 w-3.5" />
                    Color
                </button>
            </div>

            {mode === "image" ? (
                <div className="grid gap-2 sm:grid-cols-[minmax(220px,320px)_minmax(0,1fr)]">
                    <button
                        ref={imageButtonRef}
                        type="button"
                        className="group relative aspect-[16/9] min-h-32 overflow-hidden rounded-lg border border-white/10 bg-[#0f1115] text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/70"
                        onClick={() => setSelectorOpen(true)}
                    >
                        {url ? (
                            <img
                                src={url}
                                alt=""
                                className="absolute inset-0 h-full w-full object-cover"
                                draggable={false}
                            />
                        ) : (
                            <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-slate-500">
                                <ImageIcon className="h-5 w-5 text-slate-600" />
                                <span>{imageLabel}</span>
                            </div>
                        )}
                        {loading ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs text-slate-100">
                                Loading...
                            </div>
                        ) : null}
                        <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-[10px] uppercase tracking-[0.22em] text-white opacity-0 transition-opacity group-hover:opacity-100">
                            Change
                        </div>
                    </button>
                    <div className="flex min-w-0 flex-col gap-2">
                        <div>
                            <div className={FIELD_LABEL_CLASS}>Image</div>
                            <div className="flex h-9 min-h-[34px] min-w-0 items-center rounded-md border border-white/10 bg-[#1e1f22] px-3 text-sm text-gray-300">
                                <span className={["truncate", selectedAsset ? "" : "italic text-gray-500"].join(" ")}>
                                    {imageLabel}
                                </span>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                className="h-8 rounded-md border border-white/10 bg-white/[0.04] px-3 text-xs text-slate-200 hover:border-primary/40 hover:text-primary"
                                onClick={() => setSelectorOpen(true)}
                            >
                                {selectedAsset ? "Change" : "Select"}
                            </button>
                            <button
                                type="button"
                                className="grid h-8 w-8 place-items-center rounded-md border border-white/10 bg-white/[0.04] text-slate-400 hover:border-red-400/40 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={clearImage}
                                disabled={!props.payload.assetId}
                                title="Clear image"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </div>
                        {props.payload.assetId && error ? (
                            <div className="text-[11px] leading-snug text-amber-400/90">
                                Image asset could not be resolved: {error}
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : (
                <div className="max-w-md">
                    <label className={FIELD_LABEL_CLASS}>Color</label>
                    <div>
                        <ColorPickerTrigger
                            value={colorValue}
                            displayMode="icon"
                            allowOpacity={false}
                            onChange={handleColorChange}
                        />
                    </div>
                </div>
            )}

            <AssetSelector
                visible={selectorOpen}
                assetType={AssetType.Image}
                onClose={() => setSelectorOpen(false)}
                onConfirm={handleSelectImage}
                selectedIds={props.payload.assetId ? [props.payload.assetId] : []}
                anchorRef={imageButtonRef}
                title="Select Background Image"
                multiple={false}
            />
        </div>
    );
}

function ControlPayloadFields(props: { payload: StoryControlPayload; onChange: (payload: StoryBlock["payload"]) => void }) {
    if (props.payload.control === "condition") {
        return <div className="text-sm text-slate-400">Condition container. Add condition branches as children.</div>;
    }
    const branchPayload = props.payload;
    return (
        <div className="grid gap-2 sm:grid-cols-2">
            <SelectField
                label="Branch"
                options={BRANCH_OPTIONS}
                value={branchPayload.branch}
                onChange={branch => props.onChange({ ...branchPayload, branch: branch as "if" | "elseIf" | "else" })}
            />
            <TextField
                label="Expression"
                value={branchPayload.condition?.kind === "expression" ? branchPayload.condition.source : ""}
                onChange={source => props.onChange({ ...branchPayload, condition: source ? { kind: "expression", source } : undefined })}
            />
        </div>
    );
}

function CodePayloadFields(props: { payload: StoryCodePayload; onChange: (payload: StoryBlock["payload"]) => void }) {
    return (
        <div className="grid gap-2">
            <div className="max-w-xs">
                <SelectField
                    label="Language"
                    options={CODE_LANGUAGE_OPTIONS}
                    value={props.payload.language}
                    onChange={language => props.onChange({ ...props.payload, language: language as StoryCodePayload["language"] })}
                />
            </div>
            <LabeledTextarea
                label="Source"
                className="min-h-28 font-mono"
                value={props.payload.source}
                onChange={source => props.onChange({ ...props.payload, source })}
            />
        </div>
    );
}

function TextSegmentEditor(props: {
    label: string;
    text: StoryTextSegment | undefined;
    role: StoryTextSegment["role"];
    generateTextId: () => string;
    onChange: (text: StoryTextSegment) => void;
}) {
    const text = props.text ?? { textId: props.generateTextId(), role: props.role, value: "" };
    return (
        <div className="grid gap-2">
            <LabeledTextarea
                label={props.label}
                className="min-h-20"
                value={text.value}
                onChange={value => props.onChange({ ...text, value })}
            />
            <TextIdReadout text={text} />
        </div>
    );
}

function TextIdReadout(props: { text: StoryTextSegment }) {
    return (
        <div>
            <div className={FIELD_LABEL_CLASS}>Text ID</div>
            <div className="flex h-9 min-h-[34px] min-w-0 items-center rounded-md border border-white/10 bg-[#1e1f22] px-3 text-xs text-gray-400">
                <span className="truncate font-mono">{props.text.textId}</span>
            </div>
        </div>
    );
}

function SelectField(props: { label: string; options: SelectOption[]; value: string | number; onChange: (value: string | number) => void }) {
    return (
        <div>
            <label className={FIELD_LABEL_CLASS}>{props.label}</label>
            <Select
                fullWidth
                portalMenu
                className={SELECT_CLASS}
                options={props.options}
                value={props.value}
                onChange={props.onChange}
            />
        </div>
    );
}

function TextField(props: { label: string; value: string; onChange: (value: string) => void; options?: SelectOption[] }) {
    if (props.options) {
        return (
            <SelectField
                label={props.label}
                options={props.options}
                value={props.value}
                onChange={value => props.onChange(String(value))}
            />
        );
    }
    return (
        <div>
            <label className={FIELD_LABEL_CLASS}>{props.label}</label>
            <EnhancedInput
                value={props.value}
                onChange={props.onChange}
            />
        </div>
    );
}

function NumberField(props: { label: string; value: number | undefined; onChange: (value: number | undefined) => void }) {
    return (
        <div>
            <label className={FIELD_LABEL_CLASS}>{props.label}</label>
            <EnhancedInput
                value={props.value === undefined ? "" : String(props.value)}
                onChange={value => {
                    if (value.trim() === "") {
                        props.onChange(undefined);
                        return;
                    }
                    const next = Number(value);
                    if (Number.isFinite(next)) {
                        props.onChange(next);
                    }
                }}
                type="text"
                inputMode="decimal"
            />
        </div>
    );
}

function LabeledTextarea(props: { label: string; value: string; onChange: (value: string) => void; className?: string }) {
    return (
        <div>
            <label className={FIELD_LABEL_CLASS}>{props.label}</label>
            <textarea
                className={[TEXTAREA_CLASS, props.className ?? ""].join(" ")}
                value={props.value}
                onChange={event => props.onChange(event.target.value)}
            />
        </div>
    );
}
