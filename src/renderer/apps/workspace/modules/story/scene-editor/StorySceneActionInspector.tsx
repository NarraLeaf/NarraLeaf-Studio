import type {
    StoryActionPayload,
    StoryBlock,
    StoryCodePayload,
    StoryConditionRef,
    StoryControlPayload,
    StoryDocument,
    StoryDisplayableTargetKind,
    StoryLiteralValue,
    StorySceneId,
    StoryTransitionRef,
    StoryTransformRef,
    StoryTransformPreset,
    StoryTextSegment,
    StoryVariableRef,
    StoryVariableScope,
    StoryVariableValueType,
} from "@shared/types/story";
import { resolveDisplayableTargetRef } from "@shared/types/story";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Image as ImageIcon, Music, Palette, Trash2, Video, X } from "lucide-react";
import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { useWorkspace } from "@/apps/workspace/context";
import { EnhancedInput } from "@/lib/components/inputs/EnhancedInput";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import type { Character } from "@/lib/workspace/services/character/Character";
import { Select, type SelectOption } from "@/lib/components/elements";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import { colorValueToCss, parseColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import type { ColorValue } from "@/apps/workspace/modules/properties/framework/types";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { Services } from "@/lib/workspace/services/services";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { useOpenBlueprintTarget } from "@/apps/workspace/modules/blueprint-lite/hooks/useOpenBlueprintTarget";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { describeBlock, getBlockBadgeInfo } from "./storySceneBlockUtils";
import { CharacterAppearancePicker } from "./CharacterAppearancePicker";
import { DisplayableTargetField } from "./DisplayableTargetField";
import { MotionField } from "../../story-motion";

const FIELD_LABEL_CLASS = "block text-xs font-medium text-gray-400 mb-1";
const TEXTAREA_CLASS = "w-full resize-none rounded-md border border-white/10 bg-[#1e1f22] px-3 py-2 text-sm text-gray-300 outline-none transition-colors focus:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50";
const SELECT_CLASS = "[&>button]:h-9 [&>button]:min-h-[34px] [&>button]:py-0";

const VARIABLE_SCOPE_OPTIONS: SelectOption[] = [
    { value: "scene", label: "Scene" },
    { value: "saved", label: "Saved" },
    { value: "persistent", label: "Persistent" },
];

type DeclaredVariableOption = { id: string; name: string; valueType: StoryVariableValueType };

type StoryVariableOptions = {
    scene: DeclaredVariableOption[];
    saved: DeclaredVariableOption[];
    persistent: DeclaredVariableOption[];
};

/** Read declared scene/saved variables (from the story document) and persistent variables (shared blueprint store). */
function useStoryVariableOptions(document: StoryDocument, sceneId: StorySceneId): StoryVariableOptions {
    const { context, isInitialized } = useWorkspace();
    const [persistent, setPersistent] = useState<DeclaredVariableOption[]>([]);
    useEffect(() => {
        if (!context || !isInitialized) return;
        const service = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
        const read = () => {
            const bpDoc = service.getBlueprintDocument();
            setPersistent(
                Object.values(bpDoc.persistentVariables ?? {}).map(variable => ({
                    id: variable.storageKey,
                    name: variable.name,
                    valueType: (variable.valueType as StoryVariableValueType) ?? "string",
                })),
            );
        };
        read();
        return service.onBlueprintHistoryChanged(read);
    }, [context, isInitialized]);
    return useMemo(() => {
        const scene = Object.values(document.scenes[sceneId]?.sceneVariables ?? {}).map(variable => ({
            id: variable.id,
            name: variable.name,
            valueType: variable.valueType,
        }));
        const saved = Object.values(document.savedVariables ?? {}).map(variable => ({
            id: variable.id,
            name: variable.name,
            valueType: variable.valueType,
        }));
        return { scene, saved, persistent };
    }, [document, sceneId, persistent]);
}

function refVariableId(ref: StoryVariableRef): string {
    return ref.scope === "persistent" ? ref.storageKey : ref.variableId;
}

function makeVariableRef(scope: StoryVariableScope, id: string): StoryVariableRef {
    return scope === "persistent" ? { scope: "persistent", storageKey: id } : { scope, variableId: id };
}

function resolveRefValueType(ref: StoryVariableRef, options: StoryVariableOptions): StoryVariableValueType {
    const id = refVariableId(ref);
    return options[ref.scope].find(option => option.id === id)?.valueType ?? "string";
}

/** Scope + declared-variable picker. Shows variable names; internal ids are never displayed. */
function VariableRefPicker(props: {
    value: StoryVariableRef;
    options: StoryVariableOptions;
    onChange: (ref: StoryVariableRef) => void;
}) {
    const scope = props.value.scope;
    const declared = props.options[scope];
    const variableOptions: SelectOption[] = declared.length
        ? declared.map(option => ({ value: option.id, label: option.name }))
        : [{ value: "", label: "No variables declared" }];
    return (
        <>
            <SelectField
                label="Scope"
                options={VARIABLE_SCOPE_OPTIONS}
                value={scope}
                onChange={next => props.onChange(makeVariableRef(next as StoryVariableScope, ""))}
            />
            <SelectField
                label="Variable"
                options={variableOptions}
                value={refVariableId(props.value)}
                onChange={id => props.onChange(makeVariableRef(scope, String(id)))}
            />
        </>
    );
}

/** Value editor whose control matches the declared variable type. */
function VariableValueField(props: {
    valueType: StoryVariableValueType;
    value: StoryLiteralValue;
    onChange: (value: StoryLiteralValue) => void;
}) {
    if (props.valueType === "boolean") {
        return <CheckboxField label="Value" checked={props.value === true} onChange={checked => props.onChange(checked)} />;
    }
    if (props.valueType === "number") {
        return (
            <NumberField
                label="Value"
                value={typeof props.value === "number" ? props.value : undefined}
                onChange={value => props.onChange(value ?? 0)}
            />
        );
    }
    if (props.valueType === "json") {
        const text = typeof props.value === "string" ? props.value : JSON.stringify(props.value ?? null);
        return (
            <LabeledTextarea
                label="Value (JSON)"
                value={text}
                onChange={next => {
                    try {
                        props.onChange(JSON.parse(next) as StoryLiteralValue);
                    } catch {
                        props.onChange(next);
                    }
                }}
            />
        );
    }
    return <TextField label="Value" value={String(props.value ?? "")} onChange={value => props.onChange(value)} />;
}

const TRANSFORM_PRESET_OPTIONS: SelectOption[] = [
    { value: "none", label: "None" },
    { value: "left", label: "Left" },
    { value: "center", label: "Center" },
    { value: "right", label: "Right" },
    { value: "fadeIn", label: "Fade in" },
    { value: "fadeOut", label: "Fade out" },
    { value: "slideLeft", label: "Slide left" },
    { value: "slideRight", label: "Slide right" },
    { value: "slideUp", label: "Slide up" },
    { value: "slideDown", label: "Slide down" },
    { value: "zoom", label: "Zoom" },
    { value: "scale", label: "Scale" },
    { value: "rotate", label: "Rotate" },
    { value: "opacity", label: "Opacity" },
    { value: "darken", label: "Darken" },
    { value: "circleReveal", label: "Circle reveal" },
    { value: "circleClose", label: "Circle close" },
    { value: "wipe", label: "Wipe" },
];

const EASING_OPTIONS: SelectOption[] = [
    { value: "", label: "Default" },
    { value: "linear", label: "Linear" },
    { value: "easeIn", label: "Ease in" },
    { value: "easeOut", label: "Ease out" },
    { value: "easeInOut", label: "Ease in/out" },
    { value: "circIn", label: "Circ in" },
    { value: "circOut", label: "Circ out" },
    { value: "circInOut", label: "Circ in/out" },
    { value: "backIn", label: "Back in" },
    { value: "backOut", label: "Back out" },
    { value: "backInOut", label: "Back in/out" },
    { value: "anticipate", label: "Anticipate" },
];

const TRANSITION_OPTIONS: SelectOption[] = [
    { value: "none", label: "None" },
    { value: "dissolve", label: "Dissolve" },
    { value: "fadeIn", label: "Fade in" },
    { value: "maskCircle", label: "Mask circle" },
    { value: "maskWipe", label: "Mask wipe" },
];

const WIPE_DIRECTION_OPTIONS: SelectOption[] = [
    { value: "left", label: "Left" },
    { value: "right", label: "Right" },
    { value: "top", label: "Top" },
    { value: "bottom", label: "Bottom" },
];

const TRANSITION_HINTS: Record<string, string> = {
    dissolve: "Crossfades from the previous image to the new one.",
    fadeIn: "Fades the new image in from a start position offset.",
    maskCircle: "Circular reveal / close driven by an animated mask radius.",
    maskWipe: "Directional wipe reveal driven by an animated mask.",
};

const IMAGE_OPERATION_OPTIONS: SelectOption[] = [
    { value: "create", label: "Create / update" },
    { value: "setSource", label: "Set source" },
    { value: "show", label: "Show" },
    { value: "hide", label: "Hide" },
];

const DISPLAYABLE_OPERATION_OPTIONS: SelectOption[] = [
    { value: "transform", label: "Transform" },
    { value: "show", label: "Show" },
    { value: "hide", label: "Hide" },
    { value: "mask", label: "Mask" },
    { value: "clearMask", label: "Clear mask" },
    { value: "clip", label: "Clip path" },
    { value: "clearClip", label: "Clear clip" },
    { value: "filter", label: "Filter" },
    { value: "clearFilter", label: "Clear filter" },
    { value: "darken", label: "Darken" },
    { value: "circleReveal", label: "Circle reveal" },
    { value: "circleClose", label: "Circle close" },
    { value: "wipe", label: "Wipe" },
];

const DISPLAYABLE_EFFECT_OPERATIONS = new Set([
    "mask", "clearMask", "clip", "clearClip", "filter", "clearFilter", "darken", "circleReveal", "circleClose", "wipe",
]);

const DISPLAYABLE_EFFECT_HINTS: Record<string, string> = {
    mask: "Applies an image asset as a CSS mask.",
    clearMask: "Removes the current mask.",
    clip: "Applies a CSS clip-path.",
    clearClip: "Removes the current clip-path.",
    filter: "Applies a CSS filter (e.g. blur(4px) grayscale(1)).",
    clearFilter: "Removes the current filter.",
    darken: "Fades a darkness overlay 0..1 (image / character targets only).",
    circleReveal: "Circular reveal via an animated mask.",
    circleClose: "Circular close via an animated mask.",
    wipe: "Directional wipe reveal via an animated mask.",
};

const TEXT_OPERATION_OPTIONS: SelectOption[] = [
    { value: "create", label: "Create / update" },
    { value: "setText", label: "Set text" },
    { value: "show", label: "Show" },
    { value: "hide", label: "Hide" },
    { value: "setFontSize", label: "Set font size" },
    { value: "setFontColor", label: "Set font color" },
];

const LAYER_OPERATION_OPTIONS: SelectOption[] = [
    { value: "create", label: "Create" },
    { value: "setZIndex", label: "Set z-index" },
    { value: "show", label: "Show" },
    { value: "hide", label: "Hide" },
    { value: "transform", label: "Transform" },
];

const VIDEO_OPERATION_OPTIONS: SelectOption[] = [
    { value: "create", label: "Create" },
    { value: "show", label: "Show" },
    { value: "hide", label: "Hide" },
    { value: "play", label: "Play" },
];

const AUDIO_OPERATION_OPTIONS: SelectOption[] = [
    { value: "setBgm", label: "Set BGM" },
    { value: "playSound", label: "Play sound" },
    { value: "stopSound", label: "Stop sound" },
    { value: "pauseSound", label: "Pause sound" },
    { value: "resumeSound", label: "Resume sound" },
    { value: "setVolume", label: "Set volume" },
    { value: "setRate", label: "Set rate" },
    { value: "muteSound", label: "Mute / unmute" },
];

const SCREEN_EFFECT_OPTIONS: SelectOption[] = [
    { value: "blink", label: "Blink" },
    { value: "vignette", label: "Vignette" },
];

const CONDITION_OPERATOR_OPTIONS: SelectOption[] = [
    { value: "isTrue", label: "Is true" },
    { value: "isFalse", label: "Is false" },
    { value: "equals", label: "Equals" },
    { value: "notEquals", label: "Not equals" },
    { value: "exists", label: "Exists" },
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
    sceneId: StorySceneId;
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
            className="mt-2 max-w-3xl animate-scale-in rounded-xl border border-white/10 bg-[#16191e] p-3 shadow-lg"
            onClick={event => event.stopPropagation()}
            onMouseDown={event => event.stopPropagation()}
            onKeyDown={event => {
                if (event.key === "Escape") {
                    event.stopPropagation();
                    props.onClose();
                }
            }}
        >
            <div className="mb-3 flex items-center gap-2">
                <span
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.04]"
                    style={{ boxShadow: `inset 0 0 0 1px ${iconColor}22` }}
                >
                    <Icon className="h-4 w-4" style={{ color: iconColor }} />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-100">{label}</div>
                    <div className="truncate text-xs text-slate-500">{describeBlock(block, props.characters, props.document.scenes[props.sceneId])}</div>
                </div>
                <button
                    type="button"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.03] text-slate-400 transition-colors hover:border-white/20 hover:text-slate-200"
                    title="Close editor"
                    onClick={props.onClose}
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>
            <InspectorFields
                block={block}
                document={props.document}
                sceneId={props.sceneId}
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
    sceneId: StorySceneId;
    characters: Character[];
    onUpdatePayload: (payload: StoryBlock["payload"]) => void;
    onSetDialogueCharacter: (characterId: string | undefined) => void;
    generateTextId: () => string;
}) {
    const { block } = props;
    if (block.kind === "nodeAction") {
        const payload = block.payload;
        if (payload.action === "narration") {
            return (
                <div className="grid gap-2">
                    <div className="text-xs text-slate-500">Double-click the row to edit narration text.</div>
                    <TextIdReadout text={payload.text} />
                </div>
            );
        }
        if (payload.action === "dialogue") {
            const characterOptions: SelectOption[] = [
                { value: "", label: "Unassigned" },
                ...props.characters.map(character => ({
                    value: character.profile.getId(),
                    label: character.profile.getName(),
                })),
            ];
            const pauseEnabled = payload.pauseAfter !== undefined;
            const pauseMs = typeof payload.pauseAfter === "number" ? payload.pauseAfter : undefined;
            return (
                <div className="grid gap-2">
                    <FieldGrid cols={2}>
                        <SelectField
                            label="Character"
                            options={characterOptions}
                            value={payload.characterId ?? ""}
                            onChange={value => props.onSetDialogueCharacter(String(value) || undefined)}
                        />
                        <TextIdReadout text={payload.text} />
                    </FieldGrid>
                    <Section title="Timing">
                        <FieldGrid cols={2}>
                            <CheckboxField
                                label="Pause after line"
                                checked={pauseEnabled}
                                onChange={checked => props.onUpdatePayload({ ...payload, pauseAfter: checked ? true : undefined })}
                            />
                            {pauseEnabled ? (
                                <NumberField
                                    label="Pause ms (optional)"
                                    value={pauseMs}
                                    onChange={ms => props.onUpdatePayload({ ...payload, pauseAfter: ms === undefined ? true : ms })}
                                />
                            ) : null}
                        </FieldGrid>
                    </Section>
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
                <div className="grid gap-2">
                    <TextSegmentEditor
                        label="Option text"
                        text={payload.text}
                        role="choiceText"
                        generateTextId={props.generateTextId}
                        onChange={text => props.onUpdatePayload({ ...payload, text })}
                    />
                    <Section title="Conditions">
                        <div className="grid gap-2">
                            <div>
                                <div className={FIELD_LABEL_CLASS}>Hidden when</div>
                                <ConditionRefEditor
                                    document={props.document}
                                    sceneId={props.sceneId}
                                    value={payload.hiddenWhen}
                                    onChange={hiddenWhen => props.onUpdatePayload({ ...payload, hiddenWhen })}
                                />
                            </div>
                            <div>
                                <div className={FIELD_LABEL_CLASS}>Disabled when</div>
                                <ConditionRefEditor
                                    document={props.document}
                                    sceneId={props.sceneId}
                                    value={payload.disabledWhen}
                                    onChange={disabledWhen => props.onUpdatePayload({ ...payload, disabledWhen })}
                                />
                            </div>
                            <div className="text-[11px] text-slate-500">Leave a condition untouched to always show / enable this option.</div>
                        </div>
                    </Section>
                </div>
            );
        }
    }
    if (block.kind === "action") {
        return (
            <ActionPayloadFields
                block={block}
                document={props.document}
                sceneId={props.sceneId}
                payload={block.payload}
                characters={props.characters}
                onChange={props.onUpdatePayload}
            />
        );
    }
    if (block.kind === "control") {
        return <ControlPayloadFields document={props.document} sceneId={props.sceneId} payload={block.payload} onChange={props.onUpdatePayload} />;
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

function SetVariableEditor(props: {
    document: StoryDocument;
    sceneId: StorySceneId;
    payload: Extract<StoryActionPayload, { action: "setVariable" }>;
    onChange: (payload: StoryBlock["payload"]) => void;
}) {
    const options = useStoryVariableOptions(props.document, props.sceneId);
    const valueType = resolveRefValueType(props.payload.target, options);
    return (
        <div className="grid gap-2 sm:grid-cols-3">
            <VariableRefPicker
                value={props.payload.target}
                options={options}
                onChange={target => props.onChange({ ...props.payload, target })}
            />
            <VariableValueField
                valueType={valueType}
                value={props.payload.value}
                onChange={value => props.onChange({ ...props.payload, value })}
            />
        </div>
    );
}

function StoryActionBlueprintEditor(props: {
    payload: Extract<StoryActionPayload, { action: "blueprint" }>;
    onChange: (payload: StoryBlock["payload"]) => void;
}) {
    const { context, isInitialized } = useWorkspace();
    const openBlueprint = useOpenBlueprintTarget();
    const handleOpen = useCallback(() => {
        if (!context || !isInitialized) return;
        const service = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
        let blueprintId = props.payload.blueprintId;
        if (!blueprintId) {
            blueprintId = service.ensureStoryActionBlueprint();
            props.onChange({ ...props.payload, blueprintId });
        }
        openBlueprint({ blueprintId, ownerKind: "storyAction", title: "Story Action" });
    }, [context, isInitialized, openBlueprint, props]);
    return (
        <Section title="Blueprint">
            <div className="flex flex-col gap-2">
                <div className="text-[11px] text-slate-500">
                    Runs a Story Action Blueprint. Open the editor to author its On Call logic.
                </div>
                <button
                    type="button"
                    className="h-8 w-fit rounded-md border border-white/10 px-3 text-xs text-slate-200 hover:border-primary/50 hover:text-white"
                    onClick={handleOpen}
                >
                    Open blueprint editor
                </button>
            </div>
        </Section>
    );
}

function ActionPayloadFields(props: {
    block: StoryBlock;
    document: StoryDocument;
    sceneId: StorySceneId;
    payload: StoryActionPayload;
    characters: Character[];
    onChange: (payload: StoryBlock["payload"]) => void;
}) {
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
            <CharacterActionEditor
                payload={payload}
                storyId={props.document.id}
                sceneId={props.sceneId}
                blockId={props.block.id}
                storyName={props.document.name}
                characters={props.characters}
                onChange={props.onChange}
            />
        );
    }
    if (payload.action === "audio") {
        return (
            <div className="grid gap-3">
                <div className="grid gap-2 sm:grid-cols-3">
                    <SelectField
                        label="Operation"
                        options={AUDIO_OPERATION_OPTIONS}
                        value={payload.operation}
                        onChange={operation => props.onChange({ ...payload, operation: operation as Extract<StoryActionPayload, { action: "audio" }>["operation"] })}
                    />
                    <TextField label="Sound name" value={payload.objectName ?? ""} onChange={objectName => props.onChange({ ...payload, objectName })} />
                    <AssetField
                        label={payload.operation === "setBgm" ? "BGM asset" : "Sound asset"}
                        assetType={AssetType.Audio}
                        assetId={payload.assetId}
                        onChange={assetId => props.onChange({ ...payload, assetId })}
                    />
                    <NumberField label="Fade ms" value={payload.fadeMs} onChange={fadeMs => props.onChange({ ...payload, fadeMs })} />
                    <NumberField label="Volume" value={payload.volume} onChange={volume => props.onChange({ ...payload, volume })} />
                    <NumberField label="Rate" value={payload.rate} onChange={rate => props.onChange({ ...payload, rate })} />
                    <CheckboxField label="Loop" checked={Boolean(payload.loop)} onChange={loop => props.onChange({ ...payload, loop })} />
                    <CheckboxField label="Muted" checked={Boolean(payload.muted)} onChange={muted => props.onChange({ ...payload, muted })} />
                </div>
            </div>
        );
    }
    if (payload.action === "setVariable") {
        return <SetVariableEditor document={props.document} sceneId={props.sceneId} payload={payload} onChange={props.onChange} />;
    }
    if (payload.action === "blueprint") {
        return <StoryActionBlueprintEditor payload={payload} onChange={props.onChange} />;
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
    if (payload.action === "image") {
        return (
            <div className="grid gap-3">
                <div className="grid gap-2 sm:grid-cols-3">
                    <SelectField
                        label="Operation"
                        options={IMAGE_OPERATION_OPTIONS}
                        value={payload.operation}
                        onChange={operation => props.onChange({ ...payload, operation: operation as Extract<StoryActionPayload, { action: "image" }>["operation"] })}
                    />
                    <TextField label="Image name" value={payload.objectName} onChange={objectName => props.onChange({ ...payload, objectName })} />
                    <TextField label="Layer" value={payload.layerName ?? ""} onChange={layerName => props.onChange({ ...payload, layerName: layerName || undefined })} />
                    <AssetField
                        label="Image asset"
                        assetType={AssetType.Image}
                        assetId={payload.assetId}
                        onChange={assetId => props.onChange({ ...payload, assetId })}
                    />
                    <CheckboxField label="Auto fit" checked={Boolean(payload.autoFit)} onChange={autoFit => props.onChange({ ...payload, autoFit })} />
                </div>
                <TransformPresetEditor
                    value={payload.transform}
                    motionTargetKind="image"
                    motionLabel={`${payload.objectName || "Image"} ${payload.operation}`}
                    storyId={props.document.id}
                    sceneId={props.sceneId}
                    blockId={props.block.id}
                    storyName={props.document.name}
                    onChange={transform => props.onChange({ ...payload, transform })}
                />
                <TransitionEditor value={payload.transition} onChange={transition => props.onChange({ ...payload, transition })} />
            </div>
        );
    }
    if (payload.action === "displayable") {
        const isEffect = DISPLAYABLE_EFFECT_OPERATIONS.has(payload.operation);
        const resolvedTarget = resolveDisplayableTargetRef(props.document.scenes[props.sceneId], payload.target);
        return (
            <div className="grid gap-3">
                <FieldGrid cols={2}>
                    <SelectField
                        label="Operation"
                        options={DISPLAYABLE_OPERATION_OPTIONS}
                        value={payload.operation}
                        onChange={operation => props.onChange({ ...payload, operation: operation as Extract<StoryActionPayload, { action: "displayable" }>["operation"] })}
                    />
                    <DisplayableTargetField
                        document={props.document}
                        sceneId={props.sceneId}
                        blockId={props.block.id}
                        target={payload.target}
                        onChange={target => props.onChange({ ...payload, target })}
                    />
                </FieldGrid>
                {isEffect ? (
                    <DisplayableEffectEditor payload={payload} onChange={props.onChange} />
                ) : (
                    <TransformPresetEditor
                        value={payload.transform}
                        motionTargetKind={resolvedTarget.kind ?? "image"}
                        motionLabel={`${resolvedTarget.name || "Displayable"} ${payload.operation}`}
                        storyId={props.document.id}
                        sceneId={props.sceneId}
                        blockId={props.block.id}
                        storyName={props.document.name}
                        onChange={transform => props.onChange({ ...payload, transform })}
                    />
                )}
            </div>
        );
    }
    if (payload.action === "text") {
        return (
            <div className="grid gap-3">
                <div className="grid gap-2 sm:grid-cols-3">
                    <SelectField
                        label="Operation"
                        options={TEXT_OPERATION_OPTIONS}
                        value={payload.operation}
                        onChange={operation => props.onChange({ ...payload, operation: operation as Extract<StoryActionPayload, { action: "text" }>["operation"] })}
                    />
                    <TextField label="Text name" value={payload.objectName} onChange={objectName => props.onChange({ ...payload, objectName })} />
                    <TextField label="Layer" value={payload.layerName ?? ""} onChange={layerName => props.onChange({ ...payload, layerName: layerName || undefined })} />
                    <NumberField label="Font size" value={payload.fontSize} onChange={fontSize => props.onChange({ ...payload, fontSize })} />
                    <ColorTextField label="Font color" value={payload.fontColor ?? "#ffffff"} onChange={fontColor => props.onChange({ ...payload, fontColor })} />
                </div>
                {payload.operation === "create" || payload.operation === "setText" ? (
                    <LabeledTextarea label="Text" className="min-h-16" value={payload.text ?? ""} onChange={text => props.onChange({ ...payload, text })} />
                ) : null}
                <TransformPresetEditor
                    value={payload.transform}
                    motionTargetKind="text"
                    motionLabel={`${payload.objectName || "Text"} ${payload.operation}`}
                    storyId={props.document.id}
                    sceneId={props.sceneId}
                    blockId={props.block.id}
                    storyName={props.document.name}
                    onChange={transform => props.onChange({ ...payload, transform })}
                />
            </div>
        );
    }
    if (payload.action === "layer") {
        return (
            <div className="grid gap-3">
                <div className="grid gap-2 sm:grid-cols-3">
                    <SelectField
                        label="Operation"
                        options={LAYER_OPERATION_OPTIONS}
                        value={payload.operation}
                        onChange={operation => props.onChange({ ...payload, operation: operation as Extract<StoryActionPayload, { action: "layer" }>["operation"] })}
                    />
                    <TextField label="Layer name" value={payload.objectName} onChange={objectName => props.onChange({ ...payload, objectName })} />
                    <NumberField label="Z-index" value={payload.zIndex} onChange={zIndex => props.onChange({ ...payload, zIndex })} />
                </div>
                <TransformPresetEditor
                    value={payload.transform}
                    motionTargetKind="layer"
                    motionLabel={`${payload.objectName || "Layer"} ${payload.operation}`}
                    storyId={props.document.id}
                    sceneId={props.sceneId}
                    blockId={props.block.id}
                    storyName={props.document.name}
                    onChange={transform => props.onChange({ ...payload, transform })}
                />
            </div>
        );
    }
    if (payload.action === "video") {
        return (
            <div className="grid gap-2 sm:grid-cols-3">
                <SelectField
                    label="Operation"
                    options={VIDEO_OPERATION_OPTIONS}
                    value={payload.operation}
                    onChange={operation => props.onChange({ ...payload, operation: operation as Extract<StoryActionPayload, { action: "video" }>["operation"] })}
                />
                <TextField label="Video name" value={payload.objectName} onChange={objectName => props.onChange({ ...payload, objectName })} />
                <AssetField
                    label="Video asset"
                    assetType={AssetType.Video}
                    assetId={payload.assetId}
                    onChange={assetId => props.onChange({ ...payload, assetId })}
                />
                <CheckboxField label="Muted" checked={Boolean(payload.muted)} onChange={muted => props.onChange({ ...payload, muted })} />
            </div>
        );
    }
    if (payload.action === "nvl") {
        return (
            <div className="grid gap-3">
                <div className="text-xs text-slate-500">Child rows run inside NLR NVL mode. The transform below animates the NVL layer as it enters.</div>
                <TransformPresetEditor
                    value={payload.transition}
                    motionTargetKind="layer"
                    motionLabel="NVL enter animation"
                    storyId={props.document.id}
                    sceneId={props.sceneId}
                    blockId={props.block.id}
                    storyName={props.document.name}
                    onChange={transition => props.onChange({ ...payload, transition })}
                />
            </div>
        );
    }
    if (payload.action === "screenEffect") {
        return (
            <div className="grid gap-2 sm:grid-cols-3">
                <SelectField
                    label="Effect"
                    options={SCREEN_EFFECT_OPTIONS}
                    value={payload.effect}
                    onChange={effect => props.onChange({ ...payload, effect: effect as Extract<StoryActionPayload, { action: "screenEffect" }>["effect"] })}
                />
                <NumberField label="Duration ms" value={payload.durationMs} onChange={durationMs => props.onChange({ ...payload, durationMs })} />
                <NumberField label="Hold ms" value={payload.holdMs} onChange={holdMs => props.onChange({ ...payload, holdMs })} />
                <ColorTextField label="Color" value={payload.color ?? "#000000"} onChange={color => props.onChange({ ...payload, color })} />
                <NumberField label="Opacity" value={payload.opacity} onChange={opacity => props.onChange({ ...payload, opacity })} />
                <SelectField
                    label="Easing"
                    options={EASING_OPTIONS}
                    value={payload.easing ?? ""}
                    onChange={easing => props.onChange({ ...payload, easing: String(easing) || undefined })}
                />
            </div>
        );
    }
    return null;
}

type CharacterActionPayload = Extract<StoryActionPayload, { action: "character" }>;

function CharacterActionEditor(props: {
    payload: CharacterActionPayload;
    storyId: string;
    sceneId: StorySceneId;
    blockId: string;
    storyName: string;
    characters: Character[];
    onChange: (payload: StoryBlock["payload"]) => void;
}) {
    const payload = props.payload;
    const onChange = props.onChange;
    const characterOptions: SelectOption[] = [
        { value: "", label: "Unassigned" },
        ...props.characters.map(character => ({
            value: character.profile.getId(),
            label: character.profile.getName(),
        })),
    ];
    const selectedCharacter = getCharacterById(props.characters, payload.characterId);

    const updateCharacter = useCallback((characterIdValue: string | number) => {
        const characterId = String(characterIdValue) || undefined;
        const nextCharacter = getCharacterById(props.characters, characterId);
        const previousName = getCharacterById(props.characters, payload.characterId)?.profile.getName();
        // Auto-fill the stage name with the character's name, unless the author set a custom one.
        const autofill = !payload.objectName || payload.objectName === previousName || payload.objectName === payload.characterId;
        const objectName = autofill ? nextCharacter?.profile.getName() ?? payload.objectName : payload.objectName;
        onChange({ ...payload, characterId, objectName, formName: undefined, variants: undefined });
    }, [onChange, payload, props.characters]);

    return (
        <div className="grid gap-3">
            <FieldGrid cols={2}>
                <SelectField
                    label="Character"
                    options={characterOptions}
                    value={payload.characterId ?? ""}
                    onChange={updateCharacter}
                />
                <TextField
                    label="Stage name"
                    value={payload.objectName ?? ""}
                    onChange={objectName => onChange({ ...payload, objectName })}
                />
            </FieldGrid>
            {selectedCharacter ? (
                <Section title="Appearance">
                    <CharacterAppearancePicker
                        character={selectedCharacter}
                        formName={payload.formName}
                        variants={payload.variants}
                        onChange={next => onChange({ ...payload, formName: next.formName, variants: next.variants })}
                    />
                </Section>
            ) : (
                <div className="text-xs text-slate-500">Choose a character to pick its appearance.</div>
            )}
            <TransformPresetEditor
                value={payload.transform}
                motionTargetKind="character"
                motionLabel={`${selectedCharacter?.profile.getName() ?? payload.objectName ?? "Character"} ${payload.operation}`}
                storyId={props.storyId}
                sceneId={props.sceneId}
                blockId={props.blockId}
                storyName={props.storyName}
                onChange={transform => onChange({ ...payload, transform })}
            />
            {/* A transition only applies where the image source is set (NLR `char(src, transition)`),
                i.e. changing a visible character's appearance. `exit` (`hide()`) and `move`
                (`transform()`) take a transform, not a transition; `enter`'s entrance is driven by
                its transform preset. So the transition editor is only meaningful for `expression`. */}
            {payload.operation === "expression" ? (
                <TransitionEditor
                    value={payload.transition}
                    onChange={transition => onChange({ ...payload, transition })}
                />
            ) : null}
            <Disclosure title="Advanced">
                <div className="max-w-sm">
                    <AssetField
                        label="Override image"
                        assetType={AssetType.Image}
                        assetId={payload.assetId}
                        onChange={assetId => onChange({ ...payload, assetId })}
                    />
                </div>
            </Disclosure>
        </div>
    );
}

function getCharacterById(characters: Character[], characterId: string | undefined): Character | null {
    if (!characterId) {
        return null;
    }
    return characters.find(character => character.profile.getId() === characterId) ?? null;
}

function getTransformNumberProp(transform: StoryTransformRef | undefined, key: string): number | undefined {
    const value = transform?.props?.[key];
    if (typeof value === "number") {
        return value;
    }
    if (typeof value === "string") {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : undefined;
    }
    return undefined;
}

function setTransformNumberProp(
    transform: StoryTransformRef | undefined,
    key: string,
    value: number | undefined,
    fallback: Pick<StoryTransformRef, "preset" | "durationMs">,
): StoryTransformRef {
    const nextProps = { ...(transform?.props ?? {}) };
    if (value === undefined) {
        delete nextProps[key];
    } else {
        nextProps[key] = value;
    }
    return {
        mode: "preset",
        ...fallback,
        ...transform,
        props: Object.keys(nextProps).length > 0 ? nextProps : undefined,
    };
}

function AssetField(props: {
    label: string;
    assetType: AssetType;
    assetId: string | undefined;
    onChange: (assetId: string | undefined) => void;
}) {
    const { context, isInitialized } = useWorkspace();
    const assetsService = useMemo(
        () => context && isInitialized ? context.services.get<AssetsService>(Services.Assets) : null,
        [context, isInitialized],
    );
    const selectedAsset = props.assetId
        ? (assetsService?.getAssets()[props.assetType] as Record<string, Asset> | undefined)?.[props.assetId] ?? null
        : null;
    const [selectorOpen, setSelectorOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const Icon = props.assetType === AssetType.Audio ? Music : props.assetType === AssetType.Video ? Video : ImageIcon;
    const label = selectedAsset?.name ?? (props.assetId ? "Missing asset" : "No asset");

    const handleSelect = useCallback((assets: Asset[]) => {
        const selected = assets[0];
        if (!selected) {
            return;
        }
        props.onChange(selected.id);
        setSelectorOpen(false);
    }, [props]);

    return (
        <div>
            <label className={FIELD_LABEL_CLASS}>{props.label}</label>
            <div className="flex gap-2">
                <button
                    ref={buttonRef}
                    type="button"
                    className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-white/10 bg-[#1e1f22] px-3 text-left text-sm text-gray-300 hover:border-primary/40"
                    onClick={() => setSelectorOpen(true)}
                >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <span className={["truncate", selectedAsset ? "" : "italic text-gray-500"].join(" ")}>{label}</span>
                </button>
                <button
                    type="button"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.04] text-slate-400 hover:border-red-400/40 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={!props.assetId}
                    title="Clear asset"
                    onClick={() => props.onChange(undefined)}
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </button>
            </div>
            <AssetSelector
                visible={selectorOpen}
                assetType={props.assetType}
                onClose={() => setSelectorOpen(false)}
                onConfirm={handleSelect}
                selectedIds={props.assetId ? [props.assetId] : []}
                anchorRef={buttonRef}
                title={`Select ${props.label}`}
                multiple={false}
            />
        </div>
    );
}

type DisplayableActionPayload = Extract<StoryActionPayload, { action: "displayable" }>;

function DisplayableEffectEditor(props: {
    payload: DisplayableActionPayload;
    onChange: (payload: StoryBlock["payload"]) => void;
}) {
    const payload = props.payload;
    const op = payload.operation;
    const setEffectParam = (patch: Record<string, StoryLiteralValue | undefined>) =>
        props.onChange({ ...payload, effectProps: mergeParams(payload.effectProps, patch) });
    return (
        <Section title="Effect">
            <FieldGrid cols={3}>
                <NumberField label="Duration ms" value={payload.durationMs} onChange={durationMs => props.onChange({ ...payload, durationMs })} />
                <SelectField
                    label="Easing"
                    options={EASING_OPTIONS}
                    value={payload.easing ?? ""}
                    onChange={easing => props.onChange({ ...payload, easing: String(easing) || undefined })}
                />
                {op === "mask" ? (
                    <AssetField label="Mask image" assetType={AssetType.Image} assetId={payload.maskAssetId} onChange={maskAssetId => props.onChange({ ...payload, maskAssetId })} />
                ) : null}
                {op === "clip" ? (
                    <TextField label="Clip path" value={payload.clipPath ?? ""} onChange={clipPath => props.onChange({ ...payload, clipPath: clipPath || undefined })} />
                ) : null}
                {op === "filter" ? (
                    <TextField label="CSS filter" value={payload.filter ?? ""} onChange={filter => props.onChange({ ...payload, filter: filter || undefined })} />
                ) : null}
                {op === "darken" ? (
                    <NumberField label="Darkness 0-1" value={payload.darkness} onChange={darkness => props.onChange({ ...payload, darkness })} />
                ) : null}
                {op === "circleReveal" || op === "circleClose" ? (
                    <>
                        <TextField label="Center" value={paramString(payload.effectProps, "center", "50% 50%")} onChange={center => setEffectParam({ center: center || undefined })} />
                        <NumberField label="From radius" value={paramNumber(payload.effectProps, "from")} onChange={from => setEffectParam({ from })} />
                        <NumberField label="To radius" value={paramNumber(payload.effectProps, "to")} onChange={to => setEffectParam({ to })} />
                    </>
                ) : null}
                {op === "wipe" ? (
                    <>
                        <SelectField
                            label="Direction"
                            options={WIPE_DIRECTION_OPTIONS}
                            value={paramString(payload.effectProps, "direction", "left")}
                            onChange={direction => setEffectParam({ direction: String(direction) })}
                        />
                        <CheckboxField label="Reverse" checked={paramBool(payload.effectProps, "reverse")} onChange={reverse => setEffectParam({ reverse: reverse || undefined })} />
                    </>
                ) : null}
            </FieldGrid>
            <div className="mt-1.5 text-[11px] text-slate-500">{DISPLAYABLE_EFFECT_HINTS[op] ?? ""}</div>
        </Section>
    );
}

function TransformPresetEditor(props: {
    value: StoryTransformRef | undefined;
    motionTargetKind: StoryDisplayableTargetKind;
    motionLabel: string;
    storyId: string;
    sceneId: StorySceneId;
    blockId: string;
    storyName: string;
    onChange: (value: StoryTransformRef | undefined) => void;
}) {
    const value = props.value ?? { preset: "none" as StoryTransformPreset };
    const mode: "preset" | "animation" = value.mode === "animation" ? "animation" : "preset";
    const propsText = formatPropsText(value.props);
    const actionContext = {
        storyId: props.storyId,
        sceneId: props.sceneId,
        blockId: props.blockId,
        storyName: props.storyName,
    };
    return (
        <Section
            title="Transform"
            right={
                <SegToggle
                    value={mode}
                    options={[
                        { value: "preset", label: "Preset" },
                        { value: "animation", label: "Motion" },
                    ]}
                    onChange={next => props.onChange(next === "animation"
                        ? { ...value, mode: "animation", preset: undefined }
                        : { ...value, mode: "preset", animationId: undefined, preset: value.preset ?? "none" })}
                />
            }
        >
            {mode === "animation" ? (
                <MotionField
                    value={props.value}
                    targetKind={props.motionTargetKind}
                    motionLabel={props.motionLabel}
                    actionContext={actionContext}
                    onChange={props.onChange}
                />
            ) : (
                <div className="grid gap-2">
                    <FieldGrid cols={3}>
                        <SelectField
                            label="Preset"
                            options={TRANSFORM_PRESET_OPTIONS}
                            value={value.preset ?? "none"}
                            onChange={preset => props.onChange({ ...value, mode: "preset", preset: preset as StoryTransformPreset })}
                        />
                        <NumberField
                            label="Duration ms"
                            value={value.durationMs}
                            onChange={durationMs => props.onChange({ ...value, durationMs })}
                        />
                        <SelectField
                            label="Easing"
                            options={EASING_OPTIONS}
                            value={value.easing ?? ""}
                            onChange={easing => props.onChange({ ...value, easing: String(easing) || undefined })}
                        />
                    </FieldGrid>
                    <FieldGrid cols={3}>
                        <NumberField
                            label="Zoom"
                            value={getTransformNumberProp(value, "zoom")}
                            onChange={zoom => props.onChange(setTransformNumberProp(value, "zoom", zoom, { preset: value.preset ?? "none" }))}
                        />
                        <NumberField
                            label="X offset"
                            value={getTransformNumberProp(value, "xoffset")}
                            onChange={xoffset => props.onChange(setTransformNumberProp(value, "xoffset", xoffset, { preset: value.preset ?? "none" }))}
                        />
                        <NumberField
                            label="Y offset"
                            value={getTransformNumberProp(value, "yoffset")}
                            onChange={yoffset => props.onChange(setTransformNumberProp(value, "yoffset", yoffset, { preset: value.preset ?? "none" }))}
                        />
                    </FieldGrid>
                    <Disclosure title="Advanced params">
                        <TextField
                            label="Params"
                            value={propsText}
                            onChange={nextProps => props.onChange({ ...value, props: parsePropsText(nextProps) })}
                        />
                    </Disclosure>
                </div>
            )}
        </Section>
    );
}

function TransitionEditor(props: {
    value: StoryTransitionRef | undefined;
    onChange: (value: StoryTransitionRef | undefined) => void;
}) {
    const value = props.value ?? { kind: "none" as const };
    const kind = value.kind;
    const realKind = kind === "none" ? "dissolve" : kind;
    const setBase = (patch: Partial<StoryTransitionRef>) => props.onChange({ ...value, kind: realKind, ...patch });
    const setParam = (patch: Record<string, StoryLiteralValue | undefined>) =>
        props.onChange({ ...value, kind: realKind, props: mergeParams(value.props, patch) });
    return (
        <Section title="Transition">
            <FieldGrid cols={4}>
                <SelectField
                    label="Kind"
                    options={TRANSITION_OPTIONS}
                    value={kind}
                    onChange={next => next === "none"
                        ? props.onChange(undefined)
                        : props.onChange({ ...value, kind: next as StoryTransitionRef["kind"] })}
                />
                {kind === "none" ? null : (
                    <>
                        <NumberField label="Duration ms" value={value.durationMs} onChange={durationMs => setBase({ durationMs })} />
                        <SelectField
                            label="Easing"
                            options={EASING_OPTIONS}
                            value={value.easing ?? ""}
                            onChange={easing => setBase({ easing: String(easing) || undefined })}
                        />
                    </>
                )}
                {kind === "fadeIn" ? (
                    <>
                        <NumberField label="Start X" value={paramNumber(value.props, "x")} onChange={x => setParam({ x })} />
                        <NumberField label="Start Y" value={paramNumber(value.props, "y")} onChange={y => setParam({ y })} />
                    </>
                ) : null}
                {kind === "maskCircle" ? (
                    <>
                        <TextField label="Center" value={paramString(value.props, "center", "50% 50%")} onChange={center => setParam({ center: center || undefined })} />
                        <NumberField label="From radius" value={paramNumber(value.props, "from")} onChange={from => setParam({ from })} />
                        <NumberField label="To radius" value={paramNumber(value.props, "to")} onChange={to => setParam({ to })} />
                    </>
                ) : null}
                {kind === "maskWipe" ? (
                    <>
                        <SelectField
                            label="Direction"
                            options={WIPE_DIRECTION_OPTIONS}
                            value={paramString(value.props, "direction", "left")}
                            onChange={direction => setParam({ direction: String(direction) })}
                        />
                        <CheckboxField label="Reverse" checked={paramBool(value.props, "reverse")} onChange={reverse => setParam({ reverse: reverse || undefined })} />
                    </>
                ) : null}
            </FieldGrid>
            {kind === "none" ? null : (
                <div className="mt-1.5 text-[11px] text-slate-500">{TRANSITION_HINTS[realKind] ?? ""}</div>
            )}
        </Section>
    );
}

function CheckboxField(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
    return (
        <label className="flex h-full min-h-[34px] items-end gap-2 pb-1 text-sm text-slate-300">
            <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={props.checked}
                onChange={event => props.onChange(event.target.checked)}
            />
            <span>{props.label}</span>
        </label>
    );
}

function ColorTextField(props: { label: string; value: string; onChange: (value: string) => void }) {
    const parsedColorValue = parseColorValue(props.value, {
        hex: "#ffffff",
        alpha: 1,
    });
    const colorValue: ColorValue = { hex: parsedColorValue.hex, alpha: 1 };
    return (
        <div>
            <label className={FIELD_LABEL_CLASS}>{props.label}</label>
            <div className="flex items-center gap-2">
                <ColorPickerTrigger
                    value={colorValue}
                    displayMode="icon"
                    allowOpacity={false}
                    onChange={next => props.onChange(colorValueToCss({ hex: next.hex, alpha: 1 }))}
                />
                <EnhancedInput value={props.value} onChange={props.onChange} />
            </div>
        </div>
    );
}

function formatPropsText(props: Record<string, unknown> | undefined): string {
    if (!props) {
        return "";
    }
    return Object.entries(props)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(", ");
}

function parsePropsText(value: string): Record<string, string | number | boolean> | undefined {
    const entries = value
        .split(",")
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => {
            const separator = part.indexOf("=");
            if (separator === -1) {
                return [part, true] as const;
            }
            const key = part.slice(0, separator).trim();
            const raw = part.slice(separator + 1).trim();
            return [key, parseScalar(raw)] as const;
        })
        .filter(([key]) => key);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function parseScalar(value: string): string | number | boolean {
    if (value === "true") return true;
    if (value === "false") return false;
    const numeric = Number(value);
    return Number.isFinite(numeric) && value.trim() !== "" ? numeric : value;
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
                        <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-[10px] tracking-[0.22em] text-white opacity-0 transition-opacity group-hover:opacity-100">
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

            <TransitionEditor
                value={props.payload.transition}
                onChange={transition => props.onChange({ ...props.payload, transition })}
            />

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

function ControlPayloadFields(props: { document: StoryDocument; sceneId: StorySceneId; payload: StoryControlPayload; onChange: (payload: StoryBlock["payload"]) => void }) {
    if (props.payload.control === "condition") {
        return <div className="text-sm text-slate-400">Condition container. Add condition branches as children.</div>;
    }
    if (props.payload.control !== "conditionBranch") {
        const groupPayload = props.payload as Extract<StoryControlPayload, { control: "sequence" | "parallel" | "race" | "repeat" }>;
        return (
            <div className="grid gap-2 sm:grid-cols-3">
                <SelectField
                    label="Control"
                    options={[
                        { value: "sequence", label: "Sequence" },
                        { value: "parallel", label: "Parallel all" },
                        { value: "race", label: "Race any" },
                        { value: "repeat", label: "Repeat" },
                    ]}
                    value={groupPayload.control}
                    onChange={control => props.onChange({ ...groupPayload, control: control as "sequence" | "parallel" | "race" | "repeat" })}
                />
                <SelectField
                    label="Mode"
                    options={[
                        { value: "do", label: "Do" },
                        { value: "doAsync", label: "Do async" },
                        { value: "all", label: "All" },
                        { value: "allAsync", label: "All async" },
                        { value: "any", label: "Any" },
                    ]}
                    value={groupPayload.mode ?? "do"}
                    onChange={mode => props.onChange({ ...groupPayload, mode: mode as "do" | "doAsync" | "all" | "allAsync" | "any" })}
                />
                <NumberField label="Times" value={groupPayload.times} onChange={times => props.onChange({ ...groupPayload, times })} />
            </div>
        );
    }
    const branchPayload = props.payload;
    return (
        <div className="grid gap-3">
            <SelectField
                label="Branch"
                options={BRANCH_OPTIONS}
                value={branchPayload.branch}
                onChange={branch => props.onChange({ ...branchPayload, branch: branch as "if" | "elseIf" | "else" })}
            />
            {branchPayload.branch !== "else" ? (
                <ConditionRefEditor
                    document={props.document}
                    sceneId={props.sceneId}
                    value={branchPayload.condition}
                    onChange={condition => props.onChange({ ...branchPayload, condition })}
                />
            ) : (
                <div className="text-sm text-slate-400">Else branch runs when previous branches do not match.</div>
            )}
        </div>
    );
}

function ConditionRefEditor(props: {
    document: StoryDocument;
    sceneId: StorySceneId;
    value: StoryConditionRef | undefined;
    onChange: (condition: StoryConditionRef | undefined) => void;
}) {
    const options = useStoryVariableOptions(props.document, props.sceneId);
    const value: Extract<StoryConditionRef, { kind: "variable" }> = props.value?.kind === "variable"
        ? props.value
        : {
            kind: "variable" as const,
            target: { scope: "scene" as const, variableId: "" },
            operator: "isTrue" as const,
        };
    const valueType = resolveRefValueType(value.target, options);
    return (
        <div className="grid gap-2 sm:grid-cols-4">
            <VariableRefPicker
                value={value.target}
                options={options}
                onChange={target => props.onChange({ ...value, target })}
            />
            <SelectField
                label="Operator"
                options={CONDITION_OPERATOR_OPTIONS}
                value={value.operator}
                onChange={operator => props.onChange({ ...value, operator: operator as Extract<StoryConditionRef, { kind: "variable" }>["operator"] })}
            />
            {value.operator === "equals" || value.operator === "notEquals" ? (
                <VariableValueField
                    valueType={valueType}
                    value={value.value ?? ""}
                    onChange={next => props.onChange({ ...value, value: next })}
                />
            ) : null}
            {props.value?.kind === "expression" ? (
                <div className="sm:col-span-4 rounded-md border border-amber-400/20 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200">
                    Legacy expression conditions are preserved in the document but are not part of the NLR action surface.
                </div>
            ) : null}
            <button
                type="button"
                className="h-8 w-fit rounded-md border border-white/10 px-2 text-xs text-slate-400 hover:border-red-400/40 hover:text-red-300"
                onClick={() => props.onChange(undefined)}
            >
                Clear condition
            </button>
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
            <NumericDraftEnhancedInput
                committedDisplay={props.value === undefined ? "" : String(props.value)}
                onFiniteNumber={props.onChange}
                onEmpty={() => props.onChange(undefined)}
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

/**
 * A titled, boxed group used to organise the compact action editor into scannable
 * sections (Basics / Appearance / Motion / Transition / Timing / ...).
 */
function Section(props: { title?: string; right?: ReactNode; className?: string; children: ReactNode }) {
    return (
        <section className={["rounded-lg border border-white/10 bg-white/[0.02] p-2.5", props.className ?? ""].join(" ")}>
            {props.title || props.right ? (
                <div className="mb-2 flex items-center justify-between gap-2">
                    {props.title ? (
                        <div className="text-[11px] font-medium tracking-wide text-slate-400">{props.title}</div>
                    ) : <span />}
                    {props.right ?? null}
                </div>
            ) : null}
            {props.children}
        </section>
    );
}

/** Collapsible disclosure using the project chevron (matches the story panel accordion). */
function Disclosure(props: { title: string; children: ReactNode }) {
    return (
        <details className="group">
            <summary className="flex cursor-pointer select-none list-none items-center gap-1 text-[11px] font-medium tracking-wide text-slate-500 transition-colors hover:text-slate-300 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                {props.title}
            </summary>
            <div className="mt-2">{props.children}</div>
        </details>
    );
}

/** Standard dense responsive field grid used across every action editor. */
function FieldGrid(props: { cols?: 2 | 3 | 4; className?: string; children: ReactNode }) {
    const cols = props.cols ?? 3;
    const colClass = cols === 2 ? "sm:grid-cols-2" : cols === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3";
    return <div className={["grid gap-x-3 gap-y-2", colClass, props.className ?? ""].join(" ")}>{props.children}</div>;
}

/** Compact inline segmented toggle (e.g. Preset / Motion). */
function SegToggle<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
    return (
        <div className="inline-flex overflow-hidden rounded-md border border-white/10 bg-[#101216]">
            {props.options.map((option, index) => (
                <button
                    key={option.value}
                    type="button"
                    className={[
                        "h-7 px-2.5 text-xs transition-colors",
                        index > 0 ? "border-l border-white/10" : "",
                        props.value === option.value ? "bg-primary/20 text-primary" : "text-slate-400 hover:bg-white/[0.05] hover:text-slate-100",
                    ].join(" ")}
                    onClick={() => props.onChange(option.value)}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
}

/** Merge a patch into a transition/transform props record, dropping empty values. */
function mergeParams(
    current: Record<string, StoryLiteralValue> | undefined,
    patch: Record<string, StoryLiteralValue | undefined>,
): Record<string, StoryLiteralValue> | undefined {
    const next: Record<string, StoryLiteralValue> = { ...(current ?? {}) };
    for (const [key, val] of Object.entries(patch)) {
        if (val === undefined || val === "") {
            delete next[key];
        } else {
            next[key] = val;
        }
    }
    return Object.keys(next).length > 0 ? next : undefined;
}

function paramNumber(props: Record<string, StoryLiteralValue> | undefined, key: string): number | undefined {
    const value = props?.[key];
    if (typeof value === "number") {
        return value;
    }
    if (typeof value === "string") {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : undefined;
    }
    return undefined;
}

function paramString(props: Record<string, StoryLiteralValue> | undefined, key: string, fallback: string): string {
    const value = props?.[key];
    if (typeof value === "string") {
        return value;
    }
    return typeof value === "number" ? String(value) : fallback;
}

function paramBool(props: Record<string, StoryLiteralValue> | undefined, key: string): boolean {
    return props?.[key] === true || props?.[key] === "true";
}
