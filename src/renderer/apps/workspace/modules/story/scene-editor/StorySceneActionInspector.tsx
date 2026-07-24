import type {
    StoryActionPayload,
    StoryBlock,
    StoryBlockId,
    StoryCodePayload,
    StoryConditionRef,
    StoryControlPayload,
    StoryDeclarationPayload,
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
import {
    isStoryExpressionEvaluable,
    layerActionTargetRef,
    resolveDisplayableTargetRef,
    resolveStoryLayerRef,
    savedVariableDefs,
    sceneVariableDefs,
} from "@shared/types/story";
import { formatStorySecondsValue, storySecondsToMs } from "@shared/utils/storyTime";
import { useTranslation } from "@/lib/i18n";
import type { Translator } from "@shared/i18n";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRight, ExternalLink, Image as ImageIcon, Mic, Music, Palette, Play, Square, Trash2, Video, X } from "lucide-react";
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
import { StoryActionBlueprintPreviewCard } from "./StoryActionBlueprintPreviewCard";
import { ConditionEditor } from "./ConditionEditor";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { describeBlock, getBlockBadgeInfo } from "./storySceneBlockUtils";
import { useStoryVoiceState } from "./useStoryVoiceState";
import { CharacterAppearancePicker } from "./CharacterAppearancePicker";
import { DisplayableTargetField } from "./DisplayableTargetField";
import { StoryLayerField } from "./StoryLayerField";
import { MotionField } from "../../story-motion";

const FIELD_LABEL_CLASS = "block text-xs font-medium text-fg-muted mb-1";
const TEXTAREA_CLASS = "w-full resize-none rounded-md border border-edge bg-surface-raised px-3 py-2 text-sm text-fg-muted outline-none transition-colors focus:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50";
const SELECT_CLASS = "[&>button]:h-9 [&>button]:min-h-[34px] [&>button]:py-0";

type TFunc = Translator["t"];

const variableScopeOptions = (t: TFunc): SelectOption[] => [
    { value: "scene", label: t("storyInspector.variableScope.scene") },
    { value: "saved", label: t("storyInspector.variableScope.saved") },
    { value: "persistent", label: t("storyInspector.variableScope.persistent") },
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
            setPersistent(
                service.listPersistentVariables().map(variable => ({
                    id: variable.storageKey,
                    name: variable.name,
                    valueType: variable.valueType,
                })),
            );
        };
        read();
        return service.onBlueprintHistoryChanged(read);
    }, [context, isInitialized]);
    return useMemo(() => {
        const sceneDoc = document.scenes[sceneId];
        const scene = Object.values(sceneDoc ? sceneVariableDefs(sceneDoc) : {}).map(variable => ({
            id: variable.id,
            name: variable.name,
            valueType: variable.valueType,
        }));
        const saved = Object.values(savedVariableDefs(document)).map(variable => ({
            id: variable.id,
            name: variable.name,
            valueType: variable.valueType,
        }));
        return { scene, saved, persistent };
    }, [document, sceneId, persistent]);
}

function refVariableId(ref: StoryVariableRef): string {
    return ref.variableId;
}

function makeVariableRef(scope: StoryVariableScope, id: string): StoryVariableRef {
    return { scope, variableId: id };
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
    const { t } = useTranslation();
    const scope = props.value.scope;
    const declared = props.options[scope];
    const variableOptions: SelectOption[] = declared.length
        ? declared.map(option => ({ value: option.id, label: option.name }))
        : [{ value: "", label: t("storyInspector.noVariablesDeclared") }];
    return (
        <>
            <SelectField
                label={t("storyInspector.field.scope")}
                options={variableScopeOptions(t)}
                value={scope}
                onChange={next => props.onChange(makeVariableRef(next as StoryVariableScope, ""))}
            />
            <SelectField
                label={t("storyInspector.field.variable")}
                options={variableOptions}
                value={refVariableId(props.value)}
                onChange={id => props.onChange(makeVariableRef(scope, String(id)))}
            />
        </>
    );
}

/** Value editor whose control matches the declared variable type. */
function VariableValueField(props: {
    label?: string;
    valueType: StoryVariableValueType;
    value: StoryLiteralValue;
    onChange: (value: StoryLiteralValue) => void;
}) {
    const { t } = useTranslation();
    const label = props.label ?? t("storyInspector.field.value");
    if (props.valueType === "boolean") {
        return <CheckboxField label={label} checked={props.value === true} onChange={checked => props.onChange(checked)} />;
    }
    if (props.valueType === "number") {
        return (
            <NumberField
                label={label}
                value={typeof props.value === "number" ? props.value : undefined}
                onChange={value => props.onChange(value ?? 0)}
            />
        );
    }
    if (props.valueType === "json") {
        const text = typeof props.value === "string" ? props.value : JSON.stringify(props.value ?? null);
        return (
            <LabeledTextarea
                label={props.label ?? t("storyInspector.field.valueJson")}
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
    return <TextField label={label} value={String(props.value ?? "")} onChange={value => props.onChange(value)} />;
}

const transformPresetOptions = (t: TFunc): SelectOption[] => [
    { value: "none", label: t("common.none") },
    { value: "left", label: t("storyInspector.transformPreset.left") },
    { value: "center", label: t("storyInspector.transformPreset.center") },
    { value: "right", label: t("storyInspector.transformPreset.right") },
    { value: "fadeIn", label: t("storyInspector.transformPreset.fadeIn") },
    { value: "fadeOut", label: t("storyInspector.transformPreset.fadeOut") },
    { value: "slideLeft", label: t("storyInspector.transformPreset.slideLeft") },
    { value: "slideRight", label: t("storyInspector.transformPreset.slideRight") },
    { value: "slideUp", label: t("storyInspector.transformPreset.slideUp") },
    { value: "slideDown", label: t("storyInspector.transformPreset.slideDown") },
    { value: "zoom", label: t("storyInspector.transformPreset.zoom") },
    { value: "scale", label: t("storyInspector.transformPreset.scale") },
    { value: "rotate", label: t("storyInspector.transformPreset.rotate") },
    { value: "opacity", label: t("storyInspector.transformPreset.opacity") },
    { value: "darken", label: t("storyInspector.transformPreset.darken") },
    { value: "circleReveal", label: t("storyInspector.transformPreset.circleReveal") },
    { value: "circleClose", label: t("storyInspector.transformPreset.circleClose") },
    { value: "wipe", label: t("storyInspector.transformPreset.slideReveal") },
];

const easingOptions = (t: TFunc): SelectOption[] => [
    { value: "", label: t("storyInspector.easing.default") },
    { value: "linear", label: t("storyInspector.easing.linear") },
    { value: "easeIn", label: t("storyInspector.easing.easeIn") },
    { value: "easeOut", label: t("storyInspector.easing.easeOut") },
    { value: "easeInOut", label: t("storyInspector.easing.easeInOut") },
    { value: "circIn", label: t("storyInspector.easing.circIn") },
    { value: "circOut", label: t("storyInspector.easing.circOut") },
    { value: "circInOut", label: t("storyInspector.easing.circInOut") },
    { value: "backIn", label: t("storyInspector.easing.backIn") },
    { value: "backOut", label: t("storyInspector.easing.backOut") },
    { value: "backInOut", label: t("storyInspector.easing.backInOut") },
    { value: "anticipate", label: t("storyInspector.easing.anticipate") },
];

const transitionOptions = (t: TFunc): SelectOption[] => [
    { value: "none", label: t("common.none") },
    { value: "dissolve", label: t("storyInspector.transition.dissolve") },
    { value: "blurDissolve", label: t("storyInspector.transition.blurDissolve") },
    { value: "fadeIn", label: t("storyInspector.transition.fadeIn") },
    { value: "maskCircle", label: t("storyInspector.transition.maskCircle") },
    { value: "softIris", label: t("storyInspector.transition.softIris") },
    { value: "maskWipe", label: t("storyInspector.transition.maskWipe") },
    { value: "softWipe", label: t("storyInspector.transition.softWipe") },
    { value: "blinds", label: t("storyInspector.transition.blinds") },
    { value: "slide", label: t("storyInspector.transition.slide") },
    { value: "throughColor", label: t("storyInspector.transition.throughColor") },
];

const wipeDirectionOptions = (t: TFunc): SelectOption[] => [
    { value: "left", label: t("storyInspector.wipeDirection.left") },
    { value: "right", label: t("storyInspector.wipeDirection.right") },
    { value: "top", label: t("storyInspector.wipeDirection.top") },
    { value: "bottom", label: t("storyInspector.wipeDirection.bottom") },
];

const blindsOrientationOptions = (t: TFunc): SelectOption[] => [
    { value: "horizontal", label: t("storyInspector.blindsOrientation.horizontal") },
    { value: "vertical", label: t("storyInspector.blindsOrientation.vertical") },
];

const throughColorPatternOptions = (t: TFunc): SelectOption[] => [
    { value: "plain", label: t("storyInspector.throughColorPattern.plain") },
    { value: "linear", label: t("storyInspector.throughColorPattern.linear") },
    { value: "blinds", label: t("storyInspector.throughColorPattern.blinds") },
    { value: "iris", label: t("storyInspector.throughColorPattern.iris") },
];

const transitionHints = (t: TFunc): Record<string, string> => ({
    dissolve: t("storyInspector.transitionHint.dissolve"),
    blurDissolve: t("storyInspector.transitionHint.blurDissolve"),
    fadeIn: t("storyInspector.transitionHint.fadeIn"),
    maskCircle: t("storyInspector.transitionHint.maskCircle"),
    softIris: t("storyInspector.transitionHint.softIris"),
    maskWipe: t("storyInspector.transitionHint.maskWipe"),
    softWipe: t("storyInspector.transitionHint.softWipe"),
    blinds: t("storyInspector.transitionHint.blinds"),
    slide: t("storyInspector.transitionHint.slide"),
    throughColor: t("storyInspector.transitionHint.throughColor"),
});

const imageOperationOptions = (t: TFunc): SelectOption[] => [
    { value: "create", label: t("storyInspector.imageOperation.create") },
    { value: "setSource", label: t("storyInspector.imageOperation.setSource") },
    { value: "show", label: t("common.show") },
    { value: "hide", label: t("common.hide") },
];

const displayableOperationOptions = (t: TFunc): SelectOption[] => [
    { value: "transform", label: t("storyInspector.displayableOperation.transform") },
    { value: "show", label: t("common.show") },
    { value: "hide", label: t("common.hide") },
    { value: "mask", label: t("storyInspector.displayableOperation.mask") },
    { value: "clearMask", label: t("storyInspector.displayableOperation.clearMask") },
    { value: "clip", label: t("storyInspector.displayableOperation.clip") },
    { value: "clearClip", label: t("storyInspector.displayableOperation.clearClip") },
    { value: "filter", label: t("storyInspector.displayableOperation.filter") },
    { value: "clearFilter", label: t("storyInspector.displayableOperation.clearFilter") },
    { value: "darken", label: t("storyInspector.displayableOperation.darken") },
    { value: "circleReveal", label: t("storyInspector.displayableOperation.circleReveal") },
    { value: "circleClose", label: t("storyInspector.displayableOperation.circleClose") },
    { value: "wipe", label: t("storyInspector.displayableOperation.wipe") },
];

const DISPLAYABLE_EFFECT_OPERATIONS = new Set([
    "mask", "clearMask", "clip", "clearClip", "filter", "clearFilter", "darken", "circleReveal", "circleClose", "wipe",
]);

const displayableEffectHints = (t: TFunc): Record<string, string> => ({
    mask: t("storyInspector.displayableEffectHint.mask"),
    clearMask: t("storyInspector.displayableEffectHint.clearMask"),
    clip: t("storyInspector.displayableEffectHint.clip"),
    clearClip: t("storyInspector.displayableEffectHint.clearClip"),
    filter: t("storyInspector.displayableEffectHint.filter"),
    clearFilter: t("storyInspector.displayableEffectHint.clearFilter"),
    darken: t("storyInspector.displayableEffectHint.darken"),
    circleReveal: t("storyInspector.displayableEffectHint.circleReveal"),
    circleClose: t("storyInspector.displayableEffectHint.circleClose"),
    wipe: t("storyInspector.displayableEffectHint.wipe"),
});

const textOperationOptions = (t: TFunc): SelectOption[] => [
    { value: "create", label: t("storyInspector.textOperation.create") },
    { value: "setText", label: t("storyInspector.textOperation.setText") },
    { value: "show", label: t("common.show") },
    { value: "hide", label: t("common.hide") },
    { value: "setFontSize", label: t("storyInspector.textOperation.setFontSize") },
    { value: "setFontColor", label: t("storyInspector.textOperation.setFontColor") },
];

// `transform` is intentionally omitted: transforming a layer goes through the unified
// "Transform displayable" target list (which includes both built-in layers). The `layer` action
// stays layer-lifecycle only. `transform` remains valid in the type + compiler so pre-existing
// layer-transform blocks still compile; it is just no longer offered as a new choice here.
const layerOperationOptions = (t: TFunc): SelectOption[] => [
    { value: "create", label: t("common.create") },
    { value: "setZIndex", label: t("storyInspector.layerOperation.setZIndex") },
    { value: "show", label: t("common.show") },
    { value: "hide", label: t("common.hide") },
];

const videoOperationOptions = (t: TFunc): SelectOption[] => [
    { value: "create", label: t("common.create") },
    { value: "show", label: t("common.show") },
    { value: "hide", label: t("common.hide") },
    { value: "play", label: t("storyInspector.videoOperation.play") },
];

const audioOperationOptions = (t: TFunc): SelectOption[] => [
    { value: "setBgm", label: t("storyInspector.audioOperation.setBgm") },
    { value: "playSound", label: t("storyInspector.audioOperation.playSound") },
    { value: "stopSound", label: t("storyInspector.audioOperation.stopSound") },
    { value: "pauseSound", label: t("storyInspector.audioOperation.pauseSound") },
    { value: "resumeSound", label: t("storyInspector.audioOperation.resumeSound") },
    { value: "setVolume", label: t("storyInspector.audioOperation.setVolume") },
    { value: "setRate", label: t("storyInspector.audioOperation.setRate") },
    { value: "muteSound", label: t("storyInspector.audioOperation.muteSound") },
];

const screenEffectOptions = (t: TFunc): SelectOption[] => [
    { value: "blink", label: t("storyInspector.screenEffectOption.blink") },
    { value: "vignette", label: t("storyInspector.screenEffectOption.vignette") },
];

const waitModeOptions = (t: TFunc): SelectOption[] => [
    { value: "duration", label: t("storyInspector.waitMode.duration") },
    { value: "click", label: t("storyInspector.waitMode.click") },
];

const branchOptions = (t: TFunc): SelectOption[] => [
    { value: "if", label: t("storyInspector.branch.if") },
    { value: "elseIf", label: t("storyInspector.branch.elseIf") },
    { value: "else", label: t("storyInspector.branch.else") },
];

// Language names are product / technology proper nouns and are not translated.
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
    onCreateLayer: (beforeBlockId: StoryBlockId) => string | null;
}) {
    const { t } = useTranslation();
    const block = props.block;
    const { label, icon: Icon, iconColor } = getBlockBadgeInfo(block);

    return (
        // Fills the right-sidebar panel container (WI-1): the property editor that once expanded inline
        // under the row, now the panel body — so no floating-card chrome of its own.
        <div
            onKeyDown={event => {
                if (event.key === "Escape") {
                    event.stopPropagation();
                    props.onClose();
                }
            }}
        >
            <div className="mb-3 flex items-center gap-2">
                <span
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-edge bg-fill-subtle"
                    style={{ boxShadow: `inset 0 0 0 1px ${iconColor}22` }}
                >
                    <Icon className="h-4 w-4" style={{ color: iconColor }} />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-fg">{label}</div>
                    <div className="truncate text-xs text-fg-subtle">{describeBlock(block, props.characters, props.document.scenes[props.sceneId], props.document.scenes)}</div>
                </div>
                <button
                    type="button"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-edge bg-fill-subtle text-fg-muted transition-colors hover:border-edge-strong hover:text-fg"
                    title={t("storyInspector.closeEditor")}
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
                onCreateLayer={props.onCreateLayer}
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
    onCreateLayer: (beforeBlockId: StoryBlockId) => string | null;
}) {
    const { t } = useTranslation();
    const { block } = props;
    if (block.kind === "nodeAction") {
        const payload = block.payload;
        if (payload.action === "narration") {
            return (
                <div className="grid grid-cols-1 gap-2">
                    <div className="text-xs text-fg-subtle">{t("storyInspector.narration.editHint")}</div>
                    <TextIdReadout text={payload.text} />
                    <VoiceInspectorSection block={block} />
                </div>
            );
        }
        if (payload.action === "dialogue") {
            const characterOptions: SelectOption[] = [
                { value: "", label: t("storyInspector.unassigned") },
                ...props.characters.map(character => ({
                    value: character.profile.getId(),
                    label: character.profile.getName(),
                })),
            ];
            const pauseEnabled = payload.pauseAfter !== undefined;
            const pauseMs = typeof payload.pauseAfter === "number" ? payload.pauseAfter : undefined;
            return (
                <div className="grid grid-cols-1 gap-2">
                    <FieldGrid cols={2}>
                        <SelectField
                            label={t("storyInspector.field.character")}
                            options={characterOptions}
                            value={payload.characterId ?? ""}
                            onChange={value => props.onSetDialogueCharacter(String(value) || undefined)}
                        />
                        <TextIdReadout text={payload.text} />
                    </FieldGrid>
                    <Section title={t("storyInspector.section.timing")}>
                        <FieldGrid cols={2}>
                            <CheckboxField
                                label={t("storyInspector.dialogue.pauseAfter")}
                                checked={pauseEnabled}
                                onChange={checked => props.onUpdatePayload({ ...payload, pauseAfter: checked ? true : undefined })}
                            />
                            {pauseEnabled ? (
                                <SecondsField
                                    label={t("storyInspector.dialogue.pauseSeconds")}
                                    value={pauseMs}
                                    onChange={ms => props.onUpdatePayload({ ...payload, pauseAfter: ms === undefined ? true : ms })}
                                />
                            ) : null}
                        </FieldGrid>
                    </Section>
                    <VoiceInspectorSection block={block} />
                </div>
            );
        }
        if (payload.action === "choice") {
            return (
                <TextSegmentEditor
                    label={t("storyInspector.choice.prompt")}
                    text={payload.prompt}
                    role="choicePrompt"
                    generateTextId={props.generateTextId}
                    onChange={text => props.onUpdatePayload({ ...payload, prompt: text })}
                />
            );
        }
        if (payload.action === "choiceOption") {
            return (
                <div className="grid grid-cols-1 gap-2">
                    <TextSegmentEditor
                        label={t("storyInspector.choiceOption.optionText")}
                        text={payload.text}
                        role="choiceText"
                        generateTextId={props.generateTextId}
                        onChange={text => props.onUpdatePayload({ ...payload, text })}
                    />
                    <Section title={t("storyInspector.section.conditions")}>
                        <div className="grid grid-cols-1 gap-2">
                            <div>
                                <div className={FIELD_LABEL_CLASS}>{t("storyInspector.choiceOption.hiddenWhen")}</div>
                                <ConditionEditor
                                    document={props.document}
                                    sceneId={props.sceneId}
                                    value={payload.hiddenWhen}
                                    onChange={hiddenWhen => props.onUpdatePayload({ ...payload, hiddenWhen })}
                                />
                            </div>
                            <div>
                                <div className={FIELD_LABEL_CLASS}>{t("storyInspector.choiceOption.disabledWhen")}</div>
                                <ConditionEditor
                                    document={props.document}
                                    sceneId={props.sceneId}
                                    value={payload.disabledWhen}
                                    onChange={disabledWhen => props.onUpdatePayload({ ...payload, disabledWhen })}
                                />
                            </div>
                            <div className="text-2xs text-fg-subtle">{t("storyInspector.choiceOption.hint")}</div>
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
                onCreateLayer={props.onCreateLayer}
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
            <div className="grid grid-cols-1 gap-3">
                <div className="max-w-sm">
                    <SelectField
                        label={t("storyInspector.jump.targetScene")}
                        options={sceneOptions}
                        value={payload.targetSceneId}
                        onChange={targetSceneId => props.onUpdatePayload({ ...payload, targetSceneId: String(targetSceneId) })}
                    />
                </div>
                <TransitionEditor
                    value={payload.transition}
                    onChange={transition => props.onUpdatePayload({ ...payload, transition })}
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
                label={t("storyInspector.note.label")}
                text={block.payload.text}
                role="note"
                generateTextId={props.generateTextId}
                onChange={text => props.onUpdatePayload({ ...block.payload, text })}
            />
        );
    }
    if (block.kind === "declaration") {
        return <DeclarationPayloadFields payload={block.payload} onChange={props.onUpdatePayload} />;
    }
    return <div className="text-sm text-fg-muted">{t("storyInspector.noEditableFields")}</div>;
}

const declarationTypeOptions = (t: TFunc): SelectOption[] => [
    { value: "boolean", label: t("storyVars.valueType.boolean") },
    { value: "number", label: t("storyVars.valueType.number") },
    { value: "string", label: t("storyVars.valueType.string") },
    { value: "json", label: t("storyVars.valueType.json") },
];

/** The zero value a retype resets the default to (mirrors the Story Variables panel). */
function declarationDefaultForType(valueType: StoryVariableValueType): StoryLiteralValue {
    if (valueType === "boolean") return false;
    if (valueType === "number") return 0;
    if (valueType === "json") return {};
    return "";
}

/** Editor for a `declaration` row - the row IS the variable, so this edits the declaration itself. */
function DeclarationPayloadFields(props: {
    payload: StoryDeclarationPayload;
    onChange: (payload: StoryBlock["payload"]) => void;
}) {
    const { t } = useTranslation();
    const payload = props.payload;
    return (
        <div className="nl-field-grid">
            <TextField
                label={t("storyInspector.declaration.name")}
                value={payload.name}
                onChange={name => props.onChange({ ...payload, name })}
            />
            <SelectField
                label={t("storyInspector.declaration.type")}
                options={declarationTypeOptions(t)}
                value={payload.valueType}
                onChange={value => {
                    const valueType = String(value) as StoryVariableValueType;
                    props.onChange({ ...payload, valueType, defaultValue: declarationDefaultForType(valueType) });
                }}
            />
            <VariableValueField
                label={t("storyInspector.declaration.default")}
                valueType={payload.valueType}
                value={payload.defaultValue ?? null}
                onChange={defaultValue => props.onChange({ ...payload, defaultValue })}
            />
            <TextField
                label={t("storyInspector.declaration.description")}
                value={payload.description ?? ""}
                onChange={description => props.onChange({ ...payload, description: description || undefined })}
            />
        </div>
    );
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
        <div className="nl-field-grid">
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
    const { t } = useTranslation();
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
        openBlueprint({ blueprintId, ownerKind: "storyAction", title: t("storyInspector.blueprint.storyActionTitle") });
    }, [context, isInitialized, openBlueprint, props, t]);
    return (
        <Section title={t("storyInspector.section.blueprint")}>
            <StoryActionBlueprintPreviewCard
                blueprintId={props.payload.blueprintId}
                onOpen={handleOpen}
            />
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
    onCreateLayer: (beforeBlockId: StoryBlockId) => string | null;
}) {
    const { t } = useTranslation();
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
            <div className="grid grid-cols-1 gap-3">
                <div className="nl-field-grid">
                    <SelectField
                        label={t("storyInspector.field.operation")}
                        options={audioOperationOptions(t)}
                        value={payload.operation}
                        onChange={operation => props.onChange({ ...payload, operation: operation as Extract<StoryActionPayload, { action: "audio" }>["operation"] })}
                    />
                    <TextField label={t("storyInspector.audio.soundName")} value={payload.objectName ?? ""} onChange={objectName => props.onChange({ ...payload, objectName })} />
                    <AssetField
                        label={payload.operation === "setBgm" ? t("storyInspector.audio.bgmAsset") : t("storyInspector.audio.soundAsset")}
                        assetType={AssetType.Audio}
                        assetId={payload.assetId}
                        onChange={assetId => props.onChange({ ...payload, assetId })}
                    />
                    <SecondsField label={t("storyInspector.audio.fade")} value={payload.fadeMs} onChange={fadeMs => props.onChange({ ...payload, fadeMs })} />
                    <NumberField label={t("storyInspector.audio.volume")} value={payload.volume} onChange={volume => props.onChange({ ...payload, volume })} />
                    <NumberField label={t("storyInspector.audio.rate")} value={payload.rate} onChange={rate => props.onChange({ ...payload, rate })} />
                    <CheckboxField label={t("storyInspector.audio.loop")} checked={Boolean(payload.loop)} onChange={loop => props.onChange({ ...payload, loop })} />
                    <CheckboxField label={t("storyInspector.field.muted")} checked={Boolean(payload.muted)} onChange={muted => props.onChange({ ...payload, muted })} />
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
            <div className="nl-field-grid nl-field-grid-2">
                <SelectField
                    label={t("storyInspector.field.mode")}
                    options={waitModeOptions(t)}
                    value={payload.mode}
                    onChange={mode => props.onChange({ ...payload, mode: mode as "duration" | "click" })}
                />
                <SecondsField label={t("storyInspector.field.duration")} value={payload.durationMs} onChange={durationMs => props.onChange({ ...payload, durationMs })} />
            </div>
        );
    }
    if (payload.action === "image") {
        return (
            <div className="grid grid-cols-1 gap-3">
                <div className="nl-field-grid">
                    <SelectField
                        label={t("storyInspector.field.operation")}
                        options={imageOperationOptions(t)}
                        value={payload.operation}
                        onChange={operation => props.onChange({ ...payload, operation: operation as Extract<StoryActionPayload, { action: "image" }>["operation"] })}
                    />
                    <TextField label={t("storyInspector.image.imageName")} value={payload.objectName} onChange={objectName => props.onChange({ ...payload, objectName })} />
                    <StoryLayerField
                        document={props.document}
                        sceneId={props.sceneId}
                        blockId={props.block.id}
                        value={payload.layer}
                        onChange={layer => props.onChange({ ...payload, layer })}
                        onCreateLayer={() => props.onCreateLayer(props.block.id)}
                    />
                    <AssetField
                        label={t("storyInspector.image.imageAsset")}
                        assetType={AssetType.Image}
                        assetId={payload.assetId}
                        onChange={assetId => props.onChange({ ...payload, assetId })}
                    />
                    <CheckboxField label={t("storyInspector.image.autoFit")} checked={Boolean(payload.autoFit)} onChange={autoFit => props.onChange({ ...payload, autoFit })} />
                </div>
                <TransformPresetEditor
                    value={payload.transform}
                    motionTargetKind="image"
                    motionLabel={`${payload.objectName || t("storyInspector.motionTarget.image")} ${payload.operation}`}
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
            <div className="grid grid-cols-1 gap-3">
                <FieldGrid cols={2}>
                    <SelectField
                        label={t("storyInspector.field.operation")}
                        options={displayableOperationOptions(t)}
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
                        motionLabel={`${resolvedTarget.label || t("storyInspector.motionTarget.displayable")} ${payload.operation}`}
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
            <div className="grid grid-cols-1 gap-3">
                <div className="nl-field-grid">
                    <SelectField
                        label={t("storyInspector.field.operation")}
                        options={textOperationOptions(t)}
                        value={payload.operation}
                        onChange={operation => props.onChange({ ...payload, operation: operation as Extract<StoryActionPayload, { action: "text" }>["operation"] })}
                    />
                    <TextField label={t("storyInspector.text.textName")} value={payload.objectName} onChange={objectName => props.onChange({ ...payload, objectName })} />
                    <StoryLayerField
                        document={props.document}
                        sceneId={props.sceneId}
                        blockId={props.block.id}
                        value={payload.layer}
                        onChange={layer => props.onChange({ ...payload, layer })}
                        onCreateLayer={() => props.onCreateLayer(props.block.id)}
                    />
                    <NumberField label={t("storyInspector.text.fontSize")} value={payload.fontSize} onChange={fontSize => props.onChange({ ...payload, fontSize })} />
                    <ColorTextField label={t("storyInspector.text.fontColor")} value={payload.fontColor ?? "#ffffff"} onChange={fontColor => props.onChange({ ...payload, fontColor })} />
                </div>
                {payload.operation === "create" || payload.operation === "setText" ? (
                    <LabeledTextarea label={t("storyInspector.text.text")} className="min-h-16" value={payload.text ?? ""} onChange={text => props.onChange({ ...payload, text })} />
                ) : null}
                <TransformPresetEditor
                    value={payload.transform}
                    motionTargetKind="text"
                    motionLabel={`${payload.objectName || t("storyInspector.motionTarget.text")} ${payload.operation}`}
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
        const isCreate = payload.operation === "create";
        // Non-create ops target an existing layer (built-in or custom) via the layer picker; `create`
        // names a new one. Z-index only applies to create / setZIndex; transform/show/hide animate.
        const showZIndex = isCreate || payload.operation === "setZIndex";
        const showTransform = payload.operation === "transform" || payload.operation === "show" || payload.operation === "hide";
        const layerRefValue = layerActionTargetRef(payload.target, payload.objectName);
        const layerName = isCreate
            ? (payload.objectName || t("storyInspector.motionTarget.layer"))
            : (resolveStoryLayerRef(props.document.scenes[props.sceneId], layerRefValue).name || t("storyInspector.motionTarget.layer"));
        return (
            <div className="grid grid-cols-1 gap-3">
                <div className="nl-field-grid">
                    <SelectField
                        label={t("storyInspector.field.operation")}
                        options={layerOperationOptions(t)}
                        value={payload.operation}
                        onChange={operation => props.onChange({ ...payload, operation: operation as Extract<StoryActionPayload, { action: "layer" }>["operation"] })}
                    />
                    {isCreate ? (
                        <TextField label={t("storyInspector.layer.layerName")} value={payload.objectName} onChange={objectName => props.onChange({ ...payload, objectName })} />
                    ) : (
                        <StoryLayerField
                            label={t("storyInspector.field.layer")}
                            document={props.document}
                            sceneId={props.sceneId}
                            blockId={props.block.id}
                            value={layerRefValue}
                            onChange={target => props.onChange({ ...payload, target })}
                            onCreateLayer={() => props.onCreateLayer(props.block.id)}
                        />
                    )}
                    {showZIndex ? (
                        <NumberField label={t("storyInspector.layer.zIndex")} value={payload.zIndex} onChange={zIndex => props.onChange({ ...payload, zIndex })} />
                    ) : null}
                </div>
                {showTransform ? (
                    <TransformPresetEditor
                        value={payload.transform}
                        motionTargetKind="layer"
                        motionLabel={`${layerName} ${payload.operation}`}
                        storyId={props.document.id}
                        sceneId={props.sceneId}
                        blockId={props.block.id}
                        storyName={props.document.name}
                        onChange={transform => props.onChange({ ...payload, transform })}
                    />
                ) : null}
            </div>
        );
    }
    if (payload.action === "video") {
        return (
            <div className="nl-field-grid">
                <SelectField
                    label={t("storyInspector.field.operation")}
                    options={videoOperationOptions(t)}
                    value={payload.operation}
                    onChange={operation => props.onChange({ ...payload, operation: operation as Extract<StoryActionPayload, { action: "video" }>["operation"] })}
                />
                <TextField label={t("storyInspector.video.videoName")} value={payload.objectName} onChange={objectName => props.onChange({ ...payload, objectName })} />
                <AssetField
                    label={t("storyInspector.video.videoAsset")}
                    assetType={AssetType.Video}
                    assetId={payload.assetId}
                    onChange={assetId => props.onChange({ ...payload, assetId })}
                />
                <CheckboxField label={t("storyInspector.field.muted")} checked={Boolean(payload.muted)} onChange={muted => props.onChange({ ...payload, muted })} />
            </div>
        );
    }
    if (payload.action === "nvl") {
        return (
            <div className="grid grid-cols-1 gap-3">
                <div className="text-xs text-fg-subtle">{t("storyInspector.nvl.hint")}</div>
                <TransformPresetEditor
                    value={payload.transition}
                    motionTargetKind="layer"
                    motionLabel={t("storyInspector.nvl.motionLabel")}
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
            <div className="nl-field-grid">
                <SelectField
                    label={t("storyInspector.field.effect")}
                    options={screenEffectOptions(t)}
                    value={payload.effect}
                    onChange={effect => props.onChange({ ...payload, effect: effect as Extract<StoryActionPayload, { action: "screenEffect" }>["effect"] })}
                />
                <SecondsField label={t("storyInspector.field.duration")} value={payload.durationMs} onChange={durationMs => props.onChange({ ...payload, durationMs })} />
                <SecondsField label={t("storyInspector.field.hold")} value={payload.holdMs} onChange={holdMs => props.onChange({ ...payload, holdMs })} />
                <ColorTextField label={t("storyInspector.field.color")} value={payload.color ?? "#000000"} onChange={color => props.onChange({ ...payload, color })} />
                <NumberField label={t("storyInspector.field.opacity")} value={payload.opacity} onChange={opacity => props.onChange({ ...payload, opacity })} />
                <SelectField
                    label={t("storyInspector.field.easing")}
                    options={easingOptions(t)}
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
    const { t } = useTranslation();
    const payload = props.payload;
    const onChange = props.onChange;
    const characterOptions: SelectOption[] = [
        { value: "", label: t("storyInspector.unassigned") },
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
        <div className="grid grid-cols-1 gap-3">
            <FieldGrid cols={2}>
                <SelectField
                    label={t("storyInspector.field.character")}
                    options={characterOptions}
                    value={payload.characterId ?? ""}
                    onChange={updateCharacter}
                />
                <TextField
                    label={t("storyInspector.character.stageName")}
                    value={payload.objectName ?? ""}
                    onChange={objectName => onChange({ ...payload, objectName })}
                />
            </FieldGrid>
            {selectedCharacter ? (
                <Section title={t("storyInspector.section.appearance")}>
                    <CharacterAppearancePicker
                        character={selectedCharacter}
                        formName={payload.formName}
                        variants={payload.variants}
                        onChange={next => onChange({ ...payload, formName: next.formName, variants: next.variants })}
                    />
                </Section>
            ) : (
                <div className="text-xs text-fg-subtle">{t("storyInspector.character.chooseHint")}</div>
            )}
            <TransformPresetEditor
                value={payload.transform}
                motionTargetKind="character"
                motionLabel={`${selectedCharacter?.profile.getName() ?? payload.objectName ?? t("storyInspector.motionTarget.character")} ${payload.operation}`}
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
            <Disclosure title={t("storyInspector.advanced")}>
                <div className="max-w-sm">
                    <AssetField
                        label={t("storyInspector.character.overrideImage")}
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

export function AssetField(props: {
    label: string;
    assetType: AssetType;
    assetId: string | undefined;
    onChange: (assetId: string | undefined) => void;
}) {
    const { t } = useTranslation();
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
    const label = selectedAsset?.name ?? (props.assetId ? t("storyInspector.asset.missing") : t("storyInspector.asset.none"));

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
                    className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-edge bg-surface-raised px-3 text-left text-sm text-fg-muted hover:border-primary/40"
                    onClick={() => setSelectorOpen(true)}
                >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                    <span className={["truncate", selectedAsset ? "" : "italic text-fg-subtle"].join(" ")}>{label}</span>
                </button>
                <button
                    type="button"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-edge bg-fill-subtle text-fg-muted hover:border-danger/40 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={!props.assetId}
                    title={t("storyInspector.asset.clear")}
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
                title={t("storyInspector.asset.selectTitle", { label: props.label })}
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
    const { t } = useTranslation();
    const payload = props.payload;
    const op = payload.operation;
    const setEffectParam = (patch: Record<string, StoryLiteralValue | undefined>) =>
        props.onChange({ ...payload, effectProps: mergeParams(payload.effectProps, patch) });
    return (
        <Section title={t("storyInspector.section.effect")}>
            <FieldGrid cols={3}>
                <SecondsField label={t("storyInspector.field.duration")} value={payload.durationMs} onChange={durationMs => props.onChange({ ...payload, durationMs })} />
                <SelectField
                    label={t("storyInspector.field.easing")}
                    options={easingOptions(t)}
                    value={payload.easing ?? ""}
                    onChange={easing => props.onChange({ ...payload, easing: String(easing) || undefined })}
                />
                {op === "mask" ? (
                    <AssetField label={t("storyInspector.displayableEffect.maskImage")} assetType={AssetType.Image} assetId={payload.maskAssetId} onChange={maskAssetId => props.onChange({ ...payload, maskAssetId })} />
                ) : null}
                {op === "clip" ? (
                    <TextField label={t("storyInspector.displayableEffect.clipPath")} value={payload.clipPath ?? ""} onChange={clipPath => props.onChange({ ...payload, clipPath: clipPath || undefined })} />
                ) : null}
                {op === "filter" ? (
                    <TextField label={t("storyInspector.displayableEffect.cssFilter")} value={payload.filter ?? ""} onChange={filter => props.onChange({ ...payload, filter: filter || undefined })} />
                ) : null}
                {op === "darken" ? (
                    <NumberField label={t("storyInspector.displayableEffect.darkness")} value={payload.darkness} onChange={darkness => props.onChange({ ...payload, darkness })} />
                ) : null}
                {op === "circleReveal" || op === "circleClose" ? (
                    <>
                        <TextField label={t("storyInspector.field.center")} value={paramString(payload.effectProps, "center", "50% 50%")} onChange={center => setEffectParam({ center: center || undefined })} />
                        <NumberField label={t("storyInspector.field.fromRadius")} value={paramNumber(payload.effectProps, "from")} onChange={from => setEffectParam({ from })} />
                        <NumberField label={t("storyInspector.field.toRadius")} value={paramNumber(payload.effectProps, "to")} onChange={to => setEffectParam({ to })} />
                    </>
                ) : null}
                {op === "wipe" ? (
                    <>
                        <SelectField
                            label={t("storyInspector.field.direction")}
                            options={wipeDirectionOptions(t)}
                            value={paramString(payload.effectProps, "direction", "left")}
                            onChange={direction => setEffectParam({ direction: String(direction) })}
                        />
                        <CheckboxField label={t("storyInspector.field.reverse")} checked={paramBool(payload.effectProps, "reverse")} onChange={reverse => setEffectParam({ reverse: reverse || undefined })} />
                    </>
                ) : null}
            </FieldGrid>
            <div className="mt-1.5 text-2xs text-fg-subtle">{displayableEffectHints(t)[op] ?? ""}</div>
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
    const { t } = useTranslation();
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
            title={t("storyInspector.section.transform")}
            right={
                <SegToggle
                    value={mode}
                    options={[
                        { value: "preset", label: t("storyInspector.transform.presetMode") },
                        { value: "animation", label: t("storyInspector.transform.motionMode") },
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
                <div className="grid grid-cols-1 gap-2">
                    <FieldGrid cols={3}>
                        <SelectField
                            label={t("storyInspector.transform.preset")}
                            options={transformPresetOptions(t)}
                            value={value.preset ?? "none"}
                            onChange={preset => props.onChange({ ...value, mode: "preset", preset: preset as StoryTransformPreset })}
                        />
                        <SecondsField
                            label={t("storyInspector.field.duration")}
                            value={value.durationMs}
                            onChange={durationMs => props.onChange({ ...value, durationMs })}
                        />
                        <SelectField
                            label={t("storyInspector.field.easing")}
                            options={easingOptions(t)}
                            value={value.easing ?? ""}
                            onChange={easing => props.onChange({ ...value, easing: String(easing) || undefined })}
                        />
                    </FieldGrid>
                    <FieldGrid cols={3}>
                        <NumberField
                            label={t("storyInspector.transform.zoom")}
                            value={getTransformNumberProp(value, "zoom")}
                            onChange={zoom => props.onChange(setTransformNumberProp(value, "zoom", zoom, { preset: value.preset ?? "none" }))}
                        />
                        <NumberField
                            label={t("storyInspector.transform.xOffset")}
                            value={getTransformNumberProp(value, "xoffset")}
                            onChange={xoffset => props.onChange(setTransformNumberProp(value, "xoffset", xoffset, { preset: value.preset ?? "none" }))}
                        />
                        <NumberField
                            label={t("storyInspector.transform.yOffset")}
                            value={getTransformNumberProp(value, "yoffset")}
                            onChange={yoffset => props.onChange(setTransformNumberProp(value, "yoffset", yoffset, { preset: value.preset ?? "none" }))}
                        />
                    </FieldGrid>
                    <Disclosure title={t("storyInspector.advancedParams")}>
                        <TextField
                            label={t("storyInspector.transform.params")}
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
    const { t } = useTranslation();
    return (
        <Section title={t("storyInspector.section.transition")}>
            <FieldGrid cols={4}>
                <SelectField
                    label={t("storyInspector.field.kind")}
                    options={transitionOptions(t)}
                    value={kind}
                    onChange={next => next === "none"
                        ? props.onChange(undefined)
                        : props.onChange({ ...value, kind: next as StoryTransitionRef["kind"] })}
                />
                {kind === "none" ? null : (
                    <>
                        <SecondsField label={t("storyInspector.field.duration")} value={value.durationMs} onChange={durationMs => setBase({ durationMs })} />
                        <SelectField
                            label={t("storyInspector.field.easing")}
                            options={easingOptions(t)}
                            value={value.easing ?? ""}
                            onChange={easing => setBase({ easing: String(easing) || undefined })}
                        />
                    </>
                )}
                {kind === "fadeIn" ? (
                    <>
                        <NumberField label={t("storyInspector.transition.startX")} value={paramNumber(value.props, "x")} onChange={x => setParam({ x })} />
                        <NumberField label={t("storyInspector.transition.startY")} value={paramNumber(value.props, "y")} onChange={y => setParam({ y })} />
                    </>
                ) : null}
                {kind === "maskCircle" ? (
                    <>
                        <TextField label={t("storyInspector.field.center")} value={paramString(value.props, "center", "50% 50%")} onChange={center => setParam({ center: center || undefined })} />
                        <NumberField label={t("storyInspector.field.fromRadius")} value={paramNumber(value.props, "from")} onChange={from => setParam({ from })} />
                        <NumberField label={t("storyInspector.field.toRadius")} value={paramNumber(value.props, "to")} onChange={to => setParam({ to })} />
                    </>
                ) : null}
                {kind === "maskWipe" ? (
                    <SelectField
                        label={t("storyInspector.field.direction")}
                        options={wipeDirectionOptions(t)}
                        value={paramString(value.props, "direction", "left")}
                        onChange={direction => setParam({ direction: String(direction) })}
                    />
                ) : null}
                {kind === "softWipe" ? (
                    <>
                        <SelectField
                            label={t("storyInspector.field.direction")}
                            options={wipeDirectionOptions(t)}
                            value={paramString(value.props, "direction", "left")}
                            onChange={direction => setParam({ direction: String(direction) })}
                        />
                        <NumberField label={t("storyInspector.field.feather")} value={paramNumber(value.props, "feather")} onChange={feather => setParam({ feather })} />
                    </>
                ) : null}
                {kind === "blinds" ? (
                    <>
                        <SelectField
                            label={t("storyInspector.field.orientation")}
                            options={blindsOrientationOptions(t)}
                            value={paramString(value.props, "orientation", "horizontal")}
                            onChange={orientation => setParam({ orientation: String(orientation) })}
                        />
                        <NumberField label={t("storyInspector.field.slats")} value={paramNumber(value.props, "slats")} onChange={slats => setParam({ slats })} />
                    </>
                ) : null}
                {kind === "slide" ? (
                    <SelectField
                        label={t("storyInspector.field.direction")}
                        options={wipeDirectionOptions(t)}
                        value={paramString(value.props, "direction", "left")}
                        onChange={direction => setParam({ direction: String(direction) })}
                    />
                ) : null}
                {kind === "softIris" ? (
                    <>
                        <TextField label={t("storyInspector.field.center")} value={paramString(value.props, "center", "50% 50%")} onChange={center => setParam({ center: center || undefined })} />
                        <NumberField label={t("storyInspector.field.feather")} value={paramNumber(value.props, "feather")} onChange={feather => setParam({ feather })} />
                    </>
                ) : null}
                {kind === "blurDissolve" ? (
                    <NumberField label={t("storyInspector.transition.blurPx")} value={paramNumber(value.props, "blur")} onChange={blur => setParam({ blur })} />
                ) : null}
                {kind === "throughColor" ? (
                    <>
                        <SelectField
                            label={t("storyInspector.field.pattern")}
                            options={throughColorPatternOptions(t)}
                            value={paramString(value.props, "pattern", "plain")}
                            onChange={pattern => setParam({ pattern: String(pattern) })}
                        />
                        <ColorTextField label={t("storyInspector.field.color")} value={paramString(value.props, "color", "#000000")} onChange={color => setParam({ color })} />
                        <NumberField label={t("storyInspector.transition.holdPct")} value={paramNumber(value.props, "hold")} onChange={hold => setParam({ hold })} />
                    </>
                ) : null}
                {kind === "throughColor" && paramString(value.props, "pattern", "plain") === "linear" ? (
                    <>
                        <SelectField
                            label={t("storyInspector.field.direction")}
                            options={wipeDirectionOptions(t)}
                            value={paramString(value.props, "direction", "left")}
                            onChange={direction => setParam({ direction: String(direction) })}
                        />
                        <NumberField label={t("storyInspector.field.feather")} value={paramNumber(value.props, "feather")} onChange={feather => setParam({ feather })} />
                    </>
                ) : null}
                {kind === "throughColor" && paramString(value.props, "pattern", "plain") === "blinds" ? (
                    <>
                        <SelectField
                            label={t("storyInspector.field.orientation")}
                            options={blindsOrientationOptions(t)}
                            value={paramString(value.props, "orientation", "horizontal")}
                            onChange={orientation => setParam({ orientation: String(orientation) })}
                        />
                        <NumberField label={t("storyInspector.field.slats")} value={paramNumber(value.props, "slats")} onChange={slats => setParam({ slats })} />
                    </>
                ) : null}
                {kind === "throughColor" && paramString(value.props, "pattern", "plain") === "iris" ? (
                    <>
                        <TextField label={t("storyInspector.field.center")} value={paramString(value.props, "center", "50% 50%")} onChange={center => setParam({ center: center || undefined })} />
                        <NumberField label={t("storyInspector.field.feather")} value={paramNumber(value.props, "feather")} onChange={feather => setParam({ feather })} />
                    </>
                ) : null}
            </FieldGrid>
            {kind === "none" ? null : (
                <div className="mt-1.5 text-2xs text-fg-subtle">{transitionHints(t)[realKind] ?? ""}</div>
            )}
        </Section>
    );
}

function CheckboxField(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
    return (
        <label className="flex h-full min-h-[34px] items-end gap-2 pb-1 text-sm text-fg-muted">
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
    const { t } = useTranslation();
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
    const imageLabel = selectedAsset?.name ?? (props.payload.assetId ? t("storyInspector.background.missing") : t("storyInspector.background.none"));

    return (
        <div className="grid grid-cols-1 gap-3">
            <div className="inline-flex w-fit overflow-hidden rounded-md border border-edge bg-surface">
                <button
                    type="button"
                    className={[
                        "flex h-8 items-center gap-1.5 px-3 text-xs transition-colors",
                        mode === "image" ? "bg-primary/20 text-primary" : "text-fg-muted hover:bg-fill-subtle hover:text-fg",
                    ].join(" ")}
                    onClick={selectImageMode}
                >
                    <ImageIcon className="h-3.5 w-3.5" />
                    {t("storyInspector.background.image")}
                </button>
                <button
                    type="button"
                    className={[
                        "flex h-8 items-center gap-1.5 border-l border-edge px-3 text-xs transition-colors",
                        mode === "color" ? "bg-primary/20 text-primary" : "text-fg-muted hover:bg-fill-subtle hover:text-fg",
                    ].join(" ")}
                    onClick={selectColorMode}
                >
                    <Palette className="h-3.5 w-3.5" />
                    {t("storyInspector.background.color")}
                </button>
            </div>

            {mode === "image" ? (
                <div className="nl-field-grid nl-field-grid-2">
                    <button
                        ref={imageButtonRef}
                        type="button"
                        className="group relative aspect-[16/9] min-h-32 overflow-hidden rounded-lg border border-edge bg-surface text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/70"
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
                            <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-fg-subtle">
                                <ImageIcon className="h-5 w-5 text-fg-subtle" />
                                <span>{imageLabel}</span>
                            </div>
                        )}
                        {loading ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs text-white">
                                {t("common.loading")}
                            </div>
                        ) : null}
                        <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-2xs tracking-[0.22em] text-white opacity-0 transition-opacity group-hover:opacity-100">
                            {t("storyInspector.background.change")}
                        </div>
                    </button>
                    <div className="flex min-w-0 flex-col gap-2">
                        <div>
                            <div className={FIELD_LABEL_CLASS}>{t("storyInspector.background.image")}</div>
                            <div className="flex h-9 min-h-[34px] min-w-0 items-center rounded-md border border-edge bg-surface-raised px-3 text-sm text-fg-muted">
                                <span className={["truncate", selectedAsset ? "" : "italic text-fg-subtle"].join(" ")}>
                                    {imageLabel}
                                </span>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                className="h-8 rounded-md border border-edge bg-fill-subtle px-3 text-xs text-fg hover:border-primary/40 hover:text-primary"
                                onClick={() => setSelectorOpen(true)}
                            >
                                {selectedAsset ? t("storyInspector.background.change") : t("storyInspector.background.select")}
                            </button>
                            <button
                                type="button"
                                className="grid h-8 w-8 place-items-center rounded-md border border-edge bg-fill-subtle text-fg-muted hover:border-danger/40 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={clearImage}
                                disabled={!props.payload.assetId}
                                title={t("storyInspector.background.clearImage")}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </div>
                        {props.payload.assetId && error ? (
                            <div className="text-2xs leading-snug text-warning/90">
                                {t("storyInspector.background.assetError", { error })}
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : (
                <div className="max-w-md">
                    <label className={FIELD_LABEL_CLASS}>{t("storyInspector.background.color")}</label>
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
                title={t("storyInspector.background.selectImageTitle")}
                multiple={false}
            />
        </div>
    );
}

function ControlPayloadFields(props: { document: StoryDocument; sceneId: StorySceneId; payload: StoryControlPayload; onChange: (payload: StoryBlock["payload"]) => void }) {
    const { t } = useTranslation();
    if (props.payload.control === "condition") {
        return <div className="text-sm text-fg-muted">{t("storyInspector.control.conditionContainer")}</div>;
    }
    if (props.payload.control !== "conditionBranch") {
        const groupPayload = props.payload as Extract<StoryControlPayload, { control: "sequence" | "parallel" | "race" | "repeat" }>;
        return (
            <div className="nl-field-grid">
                <SelectField
                    label={t("storyInspector.control.control")}
                    options={[
                        { value: "sequence", label: t("storyInspector.control.sequence") },
                        { value: "parallel", label: t("storyInspector.control.parallel") },
                        { value: "race", label: t("storyInspector.control.race") },
                        { value: "repeat", label: t("storyInspector.control.repeat") },
                    ]}
                    value={groupPayload.control}
                    onChange={control => props.onChange({ ...groupPayload, control: control as "sequence" | "parallel" | "race" | "repeat" })}
                />
                <SelectField
                    label={t("storyInspector.field.mode")}
                    options={[
                        { value: "do", label: t("storyInspector.control.mode.do") },
                        { value: "doAsync", label: t("storyInspector.control.mode.doAsync") },
                        { value: "all", label: t("storyInspector.control.mode.all") },
                        { value: "allAsync", label: t("storyInspector.control.mode.allAsync") },
                        { value: "any", label: t("storyInspector.control.mode.any") },
                    ]}
                    value={groupPayload.mode ?? "do"}
                    onChange={mode => props.onChange({ ...groupPayload, mode: mode as "do" | "doAsync" | "all" | "allAsync" | "any" })}
                />
                <NumberField label={t("storyInspector.control.times")} value={groupPayload.times} onChange={times => props.onChange({ ...groupPayload, times })} />
            </div>
        );
    }
    const branchPayload = props.payload;
    return (
        <div className="grid grid-cols-1 gap-3">
            <SelectField
                label={t("storyInspector.control.branch")}
                options={branchOptions(t)}
                value={branchPayload.branch}
                onChange={branch => props.onChange({ ...branchPayload, branch: branch as "if" | "elseIf" | "else" })}
            />
            {branchPayload.branch !== "else" ? (
                <div className="flex flex-col gap-2">
                    <ConditionEditor
                        document={props.document}
                        sceneId={props.sceneId}
                        value={branchPayload.condition}
                        onChange={condition => props.onChange({ ...branchPayload, condition })}
                    />
                    {/* An expression condition used to warrant a "not supported" banner. It now compiles
                        and previews like any other, so the only thing worth surfacing is the opposite
                        case: an expression that stopped resolving (its variable was renamed or deleted). */}
                    {branchPayload.condition?.kind === "expression" && !isStoryExpressionEvaluable(branchPayload.condition.expression.ast) ? (
                        <div className="rounded-md border border-warning/20 bg-warning/10 px-2 py-1.5 text-xs text-warning">
                            {t("storyInspector.condition.brokenExpression")}
                        </div>
                    ) : null}
                    {branchPayload.condition ? (
                        <button
                            type="button"
                            className="h-8 w-fit rounded-md border border-edge px-2 text-xs text-fg-muted hover:border-danger/40 hover:text-danger"
                            onClick={() => props.onChange({ ...branchPayload, condition: undefined })}
                        >
                            {t("storyInspector.condition.clear")}
                        </button>
                    ) : null}
                </div>
            ) : (
                <div className="text-sm text-fg-muted">{t("storyInspector.control.elseHint")}</div>
            )}
        </div>
    );
}

function CodePayloadFields(props: { payload: StoryCodePayload; onChange: (payload: StoryBlock["payload"]) => void }) {
    const { t } = useTranslation();
    return (
        <div className="grid grid-cols-1 gap-2">
            <div className="max-w-xs">
                <SelectField
                    label={t("storyInspector.code.language")}
                    options={CODE_LANGUAGE_OPTIONS}
                    value={props.payload.language}
                    onChange={language => props.onChange({ ...props.payload, language: language as StoryCodePayload["language"] })}
                />
            </div>
            <LabeledTextarea
                label={t("storyInspector.code.source")}
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
        <div className="grid grid-cols-1 gap-2">
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
    const { t } = useTranslation();
    return (
        <div>
            <div className={FIELD_LABEL_CLASS}>{t("storyInspector.textId")}</div>
            <div className="flex h-9 min-h-[34px] min-w-0 items-center rounded-md border border-edge bg-surface-raised px-3 text-xs text-fg-muted">
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

/**
 * Edits a millisecond-backed timing field in seconds. `value` and `onChange` both speak the
 * stored milliseconds; only the text the author reads and types is seconds.
 */
function SecondsField(props: { label: string; value: number | undefined; onChange: (ms: number | undefined) => void }) {
    return (
        <div>
            <label className={FIELD_LABEL_CLASS}>{props.label}</label>
            <NumericDraftEnhancedInput
                committedDisplay={formatStorySecondsValue(props.value)}
                onFiniteNumber={seconds => props.onChange(storySecondsToMs(seconds))}
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
/**
 * The inspector's voice region (WI-4): the current take's state in the primary locale, an audition
 * play/stop button when a take exists, and a jump to the voice table where binding lives. Assignment
 * stays import-first in the voice table (no inline assignment, `dialogue.voiceAssetId` is not revived).
 * Hidden when the project has no voiced language or the block carries no voiceable line.
 */
function VoiceInspectorSection({ block }: { block: StoryBlock }) {
    const { t } = useTranslation();
    const voice = useStoryVoiceState(block);
    if (!voice.segment || !voice.primary) {
        return null;
    }
    const statusLabel = voice.stale
        ? t("storyInspector.voice.stale")
        : voice.hasTake
            ? t("storyInspector.voice.voiced")
            : t("storyInspector.voice.none");
    const statusClass = voice.stale ? "text-warning" : voice.hasTake ? "text-fg" : "text-fg-subtle";
    return (
        <Section
            title={t("storyInspector.section.voice")}
            right={
                <button
                    type="button"
                    className="grid h-6 w-6 place-items-center rounded text-fg-muted transition-colors hover:bg-fill hover:text-fg"
                    title={t("storyInspector.voice.openTable")}
                    onClick={voice.openVoiceTable}
                >
                    <ExternalLink className="h-3.5 w-3.5" />
                </button>
            }
        >
            <div className="flex items-center gap-2">
                <Mic className={`h-4 w-4 shrink-0 ${statusClass}`} />
                <span className={`min-w-0 flex-1 truncate text-sm ${statusClass}`}>{statusLabel}</span>
                {voice.hasTake ? (
                    <button
                        type="button"
                        className={`grid h-7 w-7 shrink-0 place-items-center rounded-md border border-edge bg-surface-raised transition-colors hover:text-fg ${voice.isPlaying ? "text-primary" : "text-fg-muted"}`}
                        title={voice.isPlaying ? t("story.rows.voiceStop") : t("story.rows.voicePlay")}
                        onClick={voice.toggleAudition}
                    >
                        {voice.isPlaying ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    </button>
                ) : null}
            </div>
        </Section>
    );
}

function Section(props: { title?: string; right?: ReactNode; className?: string; children: ReactNode }) {
    return (
        <section className={["rounded-lg border border-edge bg-fill-subtle p-2.5", props.className ?? ""].join(" ")}>
            {props.title || props.right ? (
                <div className="mb-2 flex items-center justify-between gap-2">
                    {props.title ? (
                        <div className="min-w-0 truncate text-2xs font-medium tracking-wide text-fg-muted">{props.title}</div>
                    ) : <span />}
                    {props.right ? <div className="shrink-0">{props.right}</div> : null}
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
            <summary className="flex cursor-pointer select-none list-none items-center gap-1 text-2xs font-medium tracking-wide text-fg-subtle transition-colors hover:text-fg-muted [&::-webkit-details-marker]:hidden">
                <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                {props.title}
            </summary>
            <div className="mt-2">{props.children}</div>
        </details>
    );
}

/**
 * Standard dense field grid used across every action editor. Columns respond to
 * the property card's own width (see `.nl-field-grid` in styles.css), so a narrow
 * editor pane collapses to fewer columns instead of overflowing horizontally.
 */
function FieldGrid(props: { cols?: 2 | 3 | 4; className?: string; children: ReactNode }) {
    const cols = props.cols ?? 3;
    const colClass = cols === 2 ? "nl-field-grid-2" : cols === 4 ? "nl-field-grid-4" : "";
    return <div className={["nl-field-grid", colClass, props.className ?? ""].join(" ")}>{props.children}</div>;
}

/** Compact inline segmented toggle (e.g. Preset / Motion). */
function SegToggle<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
    return (
        <div className="inline-flex overflow-hidden rounded-md border border-edge bg-surface">
            {props.options.map((option, index) => (
                <button
                    key={option.value}
                    type="button"
                    className={[
                        "h-7 px-2.5 text-xs transition-colors",
                        index > 0 ? "border-l border-edge" : "",
                        props.value === option.value ? "bg-primary/20 text-primary" : "text-fg-muted hover:bg-fill-subtle hover:text-fg",
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
