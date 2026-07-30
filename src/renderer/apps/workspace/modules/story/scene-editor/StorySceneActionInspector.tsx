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
    StoryVfxBlendMode,
} from "@shared/types/story";
import {
    characterStageName,
    isStoryExpressionEvaluable,
    layerActionTargetRef,
    listScenesInDocumentOrder,
    resolveDisplayableTargetRef,
    resolveStoryLayerRef,
    savedVariableDefs,
    sceneLabelNames,
    sceneVariableDefs,
} from "@shared/types/story";
import { formatStorySecondsValue, storySecondsToMs } from "@shared/utils/storyTime";
import { useTranslation } from "@/lib/i18n";
import type { Translator, TranslationKey } from "@shared/i18n";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Copy, ExternalLink, Image as ImageIcon, Mic, Music, Palette, Play, RefreshCw, Square, Trash2, Video } from "lucide-react";
import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { useWorkspace } from "@/apps/workspace/context";
import { EnhancedInput } from "@/lib/components/inputs/EnhancedInput";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import type { Character } from "@/lib/workspace/services/character/Character";
import { isPuppetAppearanceKind } from "@shared/utils/characterAppearanceKinds";
import { Select, Slider, type SelectOption } from "@/lib/components/elements";
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
import { describeBlockSubject, getBlockBadgeInfo } from "./storySceneBlockUtils";
import { useStoryMotionNames } from "./useStoryMotionNames";
import { useStoryVoiceState } from "./useStoryVoiceState";
import { CharacterAppearancePicker } from "./CharacterAppearancePicker";
import { DisplayableTargetField } from "./DisplayableTargetField";
import { StoryLayerField } from "./StoryLayerField";
import { MotionField } from "../../story-motion";
import { PuppetPreview } from "@/apps/workspace/modules/characters/editors/components/PuppetPreview";
import {
    puppetDescribeStatusKey,
    puppetDescriptionRequestFor,
    usePuppetDescription,
} from "@/apps/workspace/modules/characters/editors/components/usePuppetDescription";
import { puppetChoiceOptions } from "@/lib/workspace/services/puppet/puppetDescriptionModel";
import { CameraActionEditor } from "./CameraActionEditor";
import {
    Disclosure,
    FIELD_LABEL_CLASS,
    FieldGrid,
    NumberField,
    SecondsField,
    SegToggle,
    SelectField,
    Section,
    easingOptions,
    type TFunc,
} from "./inspectorFieldKit";

const TEXTAREA_CLASS = "w-full resize-none rounded-md border border-edge bg-surface-raised px-3 py-2 text-sm text-fg-muted outline-none transition-colors focus:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50";

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
    { value: "barnDoor", label: t("storyInspector.transition.barnDoor") },
    { value: "clock", label: t("storyInspector.transition.clock") },
    { value: "fan", label: t("storyInspector.transition.fan") },
    { value: "dots", label: t("storyInspector.transition.dots") },
    { value: "slide", label: t("storyInspector.transition.slide") },
    { value: "throughColor", label: t("storyInspector.transition.throughColor") },
    { value: "darkness", label: t("storyInspector.transition.darkness") },
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

const clockDirectionOptions = (t: TFunc): SelectOption[] => [
    { value: "clockwise", label: t("storyInspector.clockDirection.clockwise") },
    { value: "counterclockwise", label: t("storyInspector.clockDirection.counterclockwise") },
];

const irisShapeOptions = (t: TFunc): SelectOption[] => [
    { value: "circle", label: t("storyInspector.irisShape.circle") },
    { value: "ellipse", label: t("storyInspector.irisShape.ellipse") },
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
    barnDoor: t("storyInspector.transitionHint.barnDoor"),
    clock: t("storyInspector.transitionHint.clock"),
    fan: t("storyInspector.transitionHint.fan"),
    dots: t("storyInspector.transitionHint.dots"),
    slide: t("storyInspector.transitionHint.slide"),
    throughColor: t("storyInspector.transitionHint.throughColor"),
    darkness: t("storyInspector.transitionHint.darkness"),
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
    { value: "backdrop", label: t("storyInspector.displayableOperation.backdrop") },
    { value: "blend", label: t("storyInspector.displayableOperation.blend") },
    { value: "darken", label: t("storyInspector.displayableOperation.darken") },
    { value: "circleReveal", label: t("storyInspector.displayableOperation.circleReveal") },
    { value: "circleClose", label: t("storyInspector.displayableOperation.circleClose") },
    { value: "wipe", label: t("storyInspector.displayableOperation.wipe") },
];

const DISPLAYABLE_EFFECT_OPERATIONS = new Set([
    "mask", "clearMask", "clip", "clearClip", "filter", "clearFilter", "backdrop", "blend", "darken", "circleReveal", "circleClose", "wipe",
]);

const displayableEffectHints = (t: TFunc): Record<string, string> => ({
    mask: t("storyInspector.displayableEffectHint.mask"),
    clearMask: t("storyInspector.displayableEffectHint.clearMask"),
    clip: t("storyInspector.displayableEffectHint.clip"),
    clearClip: t("storyInspector.displayableEffectHint.clearClip"),
    filter: t("storyInspector.displayableEffectHint.filter"),
    clearFilter: t("storyInspector.displayableEffectHint.clearFilter"),
    backdrop: t("storyInspector.displayableEffectHint.backdrop"),
    blend: t("storyInspector.displayableEffectHint.blend"),
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
    // `play` waits for the clip to end, `resume` does not - the labels have to carry that, since the
    // two are otherwise indistinguishable in a list.
    { value: "play", label: t("storyInspector.videoOperation.play") },
    { value: "pause", label: t("storyInspector.videoOperation.pause") },
    { value: "resume", label: t("storyInspector.videoOperation.resume") },
    { value: "stop", label: t("storyInspector.videoOperation.stop") },
    { value: "seek", label: t("storyInspector.videoOperation.seek") },
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
    { value: "seekSound", label: t("storyInspector.audioOperation.seekSound") },
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
    const { context, isInitialized } = useWorkspace();
    const block = props.block;
    const { label, icon: Icon, iconColor } = getBlockBadgeInfo(block);
    const assetsService = useMemo(
        () => (context && isInitialized ? context.services.get<AssetsService>(Services.Assets) : null),
        [context, isInitialized],
    );
    /** Names, not ids: an asset id in the heading tells the author nothing about what they picked. */
    const resolveAssetName = useCallback((assetId: string): string | null => {
        const table = assetsService?.getAssets();
        if (!table) {
            return null;
        }
        for (const byId of Object.values(table)) {
            const asset = (byId as Record<string, { name?: string }> | undefined)?.[assetId];
            if (asset?.name) {
                return asset.name;
            }
        }
        return null;
    }, [assetsService]);
    const resolveMotionName = useStoryMotionNames();
    const subject = describeBlockSubject(
        block,
        props.characters,
        resolveAssetName,
        props.document.scenes[props.sceneId],
        props.document.scenes,
        resolveMotionName,
    );

    return (
        // The body of the properties panel: no floating-card chrome, and no close button either — the
        // rail follows the selection now, so there is nothing here to dismiss. Escape still reaches the
        // controller (the row keeps its selection, the editor leaves inspector mode).
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
                    <div className="truncate text-xs text-fg-subtle">{subject}</div>
                </div>
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
        const sceneOptions = listScenesInDocumentOrder(props.document).map(scene => ({
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
    // A block kind with no fields of its own contributes no field stack. The inspector's header
    // already names the row; a line reporting that there is nothing to edit is that fact twice.
    return null;
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
                    <SecondsField label={t("storyInspector.audio.seekTime")} value={payload.timeMs} onChange={timeMs => props.onChange({ ...payload, timeMs })} />
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
                {payload.operation === "seek" ? (
                    <SecondsField
                        label={t("storyInspector.video.seekTime")}
                        value={payload.timeMs}
                        onChange={timeMs => props.onChange({ ...payload, timeMs: timeMs === undefined ? undefined : Math.max(0, timeMs) })}
                    />
                ) : null}
            </div>
        );
    }
    if (payload.action === "vfx") {
        return <VfxActionEditor payload={payload} onChange={props.onChange} />;
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
    if (payload.action === "camera") {
        return (
            <CameraActionEditor
                payload={payload}
                storyId={props.document.id}
                sceneId={props.sceneId}
                blockId={props.block.id}
                storyName={props.document.name}
                onChange={props.onChange}
            />
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

type VfxActionPayload = Extract<StoryActionPayload, { action: "vfx" }>;

const vfxOperationOptions = (t: TFunc): SelectOption[] => [
    { value: "create", label: t("common.create") },
    { value: "show", label: t("common.show") },
    { value: "hide", label: t("common.hide") },
    { value: "pause", label: t("storyInspector.vfxOperation.pause") },
    { value: "resume", label: t("storyInspector.vfxOperation.resume") },
    { value: "setRate", label: t("storyInspector.vfxOperation.setRate") },
];

/**
 * Blend mode, named by the MATERIAL it belongs to rather than by the CSS keyword.
 *
 * An author picking here is not expressing a preference, they are declaring which of two production
 * routes their clip came down: a true-alpha WebM composites plainly, glow rendered on black has to be
 * added. Naming the routes is what makes the choice answerable without a paragraph of explanation
 * (M3 card §1) - the keyword alone tells someone who already knows the answer.
 */
const vfxBlendOptions = (t: TFunc): SelectOption[] => [
    { value: "normal", label: t("storyInspector.vfxBlend.normal") },
    { value: "screen", label: t("storyInspector.vfxBlend.screen") },
    { value: "multiply", label: t("storyInspector.vfxBlend.multiply") },
    { value: "lighten", label: t("storyInspector.vfxBlend.lighten") },
    { value: "color-dodge", label: t("storyInspector.vfxBlend.colorDodge") },
    { value: "overlay", label: t("storyInspector.vfxBlend.overlay") },
];

const vfxFitOptions = (t: TFunc): SelectOption[] => [
    { value: "cover", label: t("storyInspector.vfxFit.cover") },
    { value: "contain", label: t("storyInspector.vfxFit.contain") },
    { value: "fill", label: t("storyInspector.vfxFit.fill") },
];

/**
 * An ambience overlay's knobs. Two things the layout carries rather than explains:
 *  - the placement knobs (clip, blend, opacity, fit, z, loop) only appear on the row that CREATES the
 *    overlay - a later `/hide petals` row cannot change how it composites;
 *  - there is no transform section at all, because a `Vfx` is not a Displayable and has no transform
 *    pipeline to offer.
 */
function VfxActionEditor(props: { payload: VfxActionPayload; onChange: (payload: StoryBlock["payload"]) => void }) {
    const { t } = useTranslation();
    const payload = props.payload;
    const isCreate = payload.operation === "create";
    const fades = payload.operation === "show" || payload.operation === "hide" || isCreate;
    return (
        <Section title={t("storyInspector.section.vfx")}>
            <FieldGrid cols={2}>
                <SelectField
                    label={t("storyInspector.field.operation")}
                    options={vfxOperationOptions(t)}
                    value={payload.operation}
                    onChange={operation => props.onChange({ ...payload, operation: operation as VfxActionPayload["operation"] })}
                />
                <TextField
                    label={t("storyInspector.vfx.name")}
                    value={payload.objectName}
                    onChange={objectName => props.onChange({ ...payload, objectName })}
                />
                {isCreate ? (
                    <>
                        <AssetField
                            label={t("storyInspector.vfx.clip")}
                            assetType={AssetType.Video}
                            assetId={payload.assetId}
                            onChange={assetId => props.onChange({ ...payload, assetId })}
                        />
                        <SelectField
                            label={t("storyInspector.vfx.blendMode")}
                            options={vfxBlendOptions(t)}
                            value={payload.blendMode ?? "normal"}
                            onChange={blendMode => props.onChange({ ...payload, blendMode: blendMode as VfxActionPayload["blendMode"] })}
                        />
                        <NumberField
                            label={t("storyInspector.vfx.opacity")}
                            value={payload.opacity}
                            onChange={opacity => props.onChange({ ...payload, opacity: opacity === undefined ? undefined : Math.min(1, Math.max(0, opacity)) })}
                        />
                        <SelectField
                            label={t("storyInspector.vfx.fit")}
                            options={vfxFitOptions(t)}
                            value={payload.fit ?? "cover"}
                            onChange={fit => props.onChange({ ...payload, fit: fit as VfxActionPayload["fit"] })}
                        />
                        <NumberField
                            label={t("storyInspector.vfx.zIndex")}
                            value={payload.zIndex}
                            onChange={zIndex => props.onChange({ ...payload, zIndex })}
                        />
                        <CheckboxField
                            label={t("storyInspector.vfx.loop")}
                            checked={payload.loop !== false}
                            onChange={loop => props.onChange({ ...payload, loop })}
                        />
                    </>
                ) : null}
                {isCreate || payload.operation === "setRate" ? (
                    <NumberField
                        label={t("storyInspector.vfx.rate")}
                        value={payload.rate}
                        onChange={rate => props.onChange({ ...payload, rate: rate === undefined ? undefined : Math.max(0, rate) })}
                    />
                ) : null}
                {fades ? (
                    <SecondsField
                        label={t("storyInspector.vfx.fade")}
                        value={payload.durationMs}
                        onChange={durationMs => props.onChange({ ...payload, durationMs: durationMs === undefined ? undefined : Math.max(0, durationMs) })}
                    />
                ) : null}
                {fades ? (
                    <SelectField
                        label={t("storyInspector.field.easing")}
                        options={easingOptions(t)}
                        value={payload.easing ?? ""}
                        onChange={easing => props.onChange({ ...payload, easing: String(easing) || undefined })}
                    />
                ) : null}
            </FieldGrid>
        </Section>
    );
}

/** The three channels of `PuppetState` a character row can address, and which list fills each one. */
type PuppetChannel = "motion" | "expression" | "skin";

const PUPPET_CHANNEL_LABEL: Record<PuppetChannel, TranslationKey> = {
    motion: "storyInspector.character.puppetMotion",
    expression: "storyInspector.character.puppetExpression",
    skin: "storyInspector.character.puppetSkin",
};

/**
 * Blank means the engine's `null` on every channel, but `null` does not *look* the same on each: a
 * cleared motion is the model at rest, a cleared expression is whatever the motion and skin make, a
 * cleared skin is the model's own default. Naming the outcome is the difference between a field that
 * reads as unfilled and one that reads as a choice.
 */
const PUPPET_CHANNEL_NONE: Record<PuppetChannel, TranslationKey> = {
    motion: "storyInspector.character.puppetNone",
    expression: "storyInspector.character.puppetNone",
    skin: "storyInspector.character.puppetSkinDefault",
};

/**
 * The control for one puppet channel: the names the model reported, the model itself, and where the
 * list came from.
 *
 * The reason this is not a plain text field. A puppet's motions, expressions and skins are named by
 * the model, not enumerated in the project — so for a while the honest control looked like free text,
 * and the author typed a name from memory that nothing could check. That stopped being true when the
 * engine's `PuppetInstance.describe()` landed and `PuppetDescriptionService` began mounting the
 * author's own runtime to ask: the names exist, in the editor, synchronously, and every other action
 * in this inspector picks from a list.
 *
 * It still degrades to free text, per field and not per model — a skeleton with eleven animations and
 * no expressions gets a list for its animations and a text box for its face — because a backend is
 * free to implement no `describe()` at all and a project written on one machine opens on another that
 * never installed the runtime. The status line is what tells those two apart; without it "no options"
 * and "not asked" look identical.
 */
function PuppetChannelControl(props: {
    character: Character;
    channel: PuppetChannel;
    value: string;
    onChange: (value: string) => void;
}) {
    const { t } = useTranslation();
    const appearance = props.character.profile.appearance;
    const puppet = appearance.getKind() === "puppet" ? appearance.getPuppet() : null;
    // Memoised on the puppet's individual fields: the appearance object is mutable and keeps the same
    // reference across an edit, so depending on it alone would never re-ask.
    const request = useMemo(
        () => puppetDescriptionRequestFor(appearance),
        [appearance, puppet?.assetId, puppet?.backend, puppet?.entry, puppet?.options, puppet?.size],
    );
    const { result, loading, refresh } = usePuppetDescription(request);
    const description = result?.status === "ok" ? result.description : null;
    const available = props.channel === "motion"
        ? description?.motions
        : props.channel === "expression"
            ? description?.expressions
            : description?.skins;

    const placeholder = t(PUPPET_CHANNEL_NONE[props.channel]);
    // A name the model no longer lists is kept at the head of the options rather than dropped, so a
    // re-exported model shows the author what went missing instead of silently rewriting the row.
    const names = puppetChoiceOptions(available ?? [], props.value || null);
    const options: SelectOption[] | undefined = names.length > 0
        ? [{ value: "", label: placeholder }, ...names.map(name => ({ value: name, label: name }))]
        : undefined;

    /** The state the preview is put in: the character's resting pose with this row's channel applied. */
    const previewState = useMemo(() => ({
        ...appearance.getPuppetDefaultState(),
        [props.channel]: props.value || null,
    }), [appearance, props.channel, props.value]);

    return (
        <div className="grid grid-cols-1 gap-2">
            <div className="max-w-sm">
                <TextField
                    label={t(PUPPET_CHANNEL_LABEL[props.channel])}
                    value={props.value}
                    placeholder={placeholder}
                    options={options}
                    onChange={props.onChange}
                />
            </div>
            <PuppetPreview request={request} state={previewState} />
            {request ? (
                <div className="flex items-center gap-2 text-2xs text-fg-subtle">
                    <span className="min-w-0 flex-1 truncate">
                        {loading
                            ? t("characters.editor.puppet.describing")
                            : t(puppetDescribeStatusKey(result?.status === "unavailable" ? result.reason : null))}
                    </span>
                    <button
                        type="button"
                        className="rounded-md p-1 text-fg-muted transition-colors hover:bg-fill hover:text-fg"
                        aria-label={t("characters.editor.puppet.redescribe")}
                        title={t("characters.editor.puppet.redescribe")}
                        onClick={refresh}
                    >
                        <RefreshCw className={`h-3 w-3${loading ? " animate-spin" : ""}`} />
                    </button>
                </div>
            ) : null}
        </div>
    );
}

/**
 * The numeric-parameter rows of a `setParams` block.
 *
 * A parameter is the one free channel a model describes with a *shape* — an id, a range and a default
 * — which is why it earns controls rather than a text box: the id is picked from what the model
 * reported, and the value rides a slider that cannot leave the range. Where the model said nothing,
 * both degrade (a text id, an unbounded number) rather than disappearing.
 *
 * The row holds a **map**, not one pair, because one authorial gesture is several parameters — turning
 * a head is three of them moving together. `Puppet.setParam` merges, so the compiler emitting one call
 * per entry is exactly equivalent to the row's intent.
 */
function PuppetParamRows(props: {
    character: Character;
    params: Record<string, number>;
    onChange: (params: Record<string, number>) => void;
}) {
    const { t } = useTranslation();
    const appearance = props.character.profile.appearance;
    const puppet = appearance.getKind() === "puppet" ? appearance.getPuppet() : null;
    const request = useMemo(
        () => puppetDescriptionRequestFor(appearance),
        [appearance, puppet?.assetId, puppet?.backend, puppet?.entry, puppet?.options, puppet?.size],
    );
    const { result, loading, refresh } = usePuppetDescription(request);
    const specs = result?.status === "ok" ? result.description.params : [];
    const entries = Object.entries(props.params);

    /** Rename a key while keeping its position, so the list does not reorder under the author's cursor. */
    const renameKey = (from: string, to: string) => {
        const next: Record<string, number> = {};
        for (const [id, value] of entries) {
            next[id === from ? to : id] = value;
        }
        delete next[""];
        props.onChange(next);
    };

    /** The first id the model reported that this row does not already carry. */
    const nextUnusedId = specs.find(spec => !(spec.id in props.params));

    return (
        <div className="grid grid-cols-1 gap-2">
            {entries.length === 0 ? (
                <div className="text-xs text-fg-subtle">{t("storyInspector.character.puppetNoParams")}</div>
            ) : null}
            {entries.map(([id, value]) => {
                const spec = specs.find(entry => entry.id === id);
                // Ids the model listed, plus this row's own even when the model no longer lists it, minus
                // the ones already spoken for on other rows - picking a duplicate would silently merge two.
                const options: SelectOption[] | undefined = specs.length > 0
                    ? [
                        ...(spec ? [] : [{ value: id, label: id }]),
                        ...specs.filter(entry => entry.id === id || !(entry.id in props.params)).map(entry => ({ value: entry.id, label: entry.id })),
                    ]
                    : undefined;
                return (
                    // Two lines per parameter, not one. The inspector is a ~360px column, and an
                    // id + slider + number + delete on one row overflowed it: the id select collapsed
                    // to its chevron, the number field left the panel, and the whole pane grew a
                    // horizontal scrollbar. `min-w-0` on each flex child is the other half of the fix -
                    // a flex item's default `min-width:auto` refuses to shrink below its content.
                    <div key={id} className="rounded-md border border-edge/60 p-1.5">
                        <div className="flex items-end gap-1.5">
                            <div className="min-w-0 flex-1">
                                <TextField
                                    label={t("storyInspector.character.puppetParamId")}
                                    value={id}
                                    options={options}
                                    onChange={next => renameKey(id, next.trim())}
                                />
                            </div>
                            <button
                                type="button"
                                className="mb-1 shrink-0 rounded-md p-1 text-fg-subtle transition-colors hover:bg-fill hover:text-fg"
                                aria-label={t("storyInspector.character.puppetParamRemove")}
                                title={t("storyInspector.character.puppetParamRemove")}
                                onClick={() => {
                                    const next = { ...props.params };
                                    delete next[id];
                                    props.onChange(next);
                                }}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                            {spec ? (
                                <Slider
                                    className="min-w-0 flex-1"
                                    min={spec.min}
                                    max={spec.max}
                                    // A rig parameter is continuous and its range may be a fraction of
                                    // one unit, so the step is derived from the range, not left at 1.
                                    step={Math.max((spec.max - spec.min) / 200, 0.001)}
                                    value={value}
                                    onValueChange={next => props.onChange({ ...props.params, [id]: next })}
                                />
                            ) : null}
                            <NumericDraftEnhancedInput
                                committedDisplay={String(value)}
                                onFiniteNumber={next => props.onChange({ ...props.params, [id]: next })}
                                onEmpty={() => props.onChange({ ...props.params, [id]: 0 })}
                                type="text"
                                inputMode="decimal"
                                popoverWhenNarrow={false}
                                className={spec ? "w-14 shrink-0" : "min-w-0 flex-1"}
                                inputClassName="h-7 w-full rounded-md border border-edge bg-surface-raised px-1.5 text-right text-xs text-fg outline-none focus:border-primary/50"
                            />
                            {spec ? (
                                // The range the model gave. Without it the slider is a knob with no
                                // scale - `-30…30` says what dragging it all the way will do.
                                <span className="shrink-0 text-2xs tabular-nums text-fg-subtle">{spec.min}…{spec.max}</span>
                            ) : null}
                        </div>
                    </div>
                );
            })}
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    className="rounded-md border border-edge px-2 py-1 text-2xs text-fg-muted transition-colors hover:bg-fill hover:text-fg"
                    onClick={() => props.onChange({
                        ...props.params,
                        // The model's own default for the parameter, which is the value that changes
                        // nothing - so a freshly added row is visible without having moved the model yet.
                        [nextUnusedId?.id ?? ""]: nextUnusedId?.default ?? 0,
                    })}
                    // Every id the model has is already on the row, and an un-described model has no id
                    // to invent - in both cases there is nothing left to add.
                    disabled={specs.length > 0 && !nextUnusedId}
                >
                    {t("storyInspector.character.puppetParamAdd")}
                </button>
                <span className="min-w-0 flex-1 truncate text-2xs text-fg-subtle">
                    {loading
                        ? t("characters.editor.puppet.describing")
                        : t(puppetDescribeStatusKey(result?.status === "unavailable" ? result.reason : null))}
                </span>
                <button
                    type="button"
                    className="rounded-md p-1 text-fg-muted transition-colors hover:bg-fill hover:text-fg"
                    aria-label={t("characters.editor.puppet.redescribe")}
                    title={t("characters.editor.puppet.redescribe")}
                    onClick={refresh}
                >
                    <RefreshCw className={`h-3 w-3${loading ? " animate-spin" : ""}`} />
                </button>
            </div>
        </div>
    );
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
        onChange({ ...payload, characterId, objectName, pose: undefined, tags: undefined });
    }, [onChange, payload, props.characters]);

    /**
     * The name later commands use to reach this character on stage. Two things put a value in there
     * without anyone typing it: the bare block's literal `"character"`, and the auto-fill from the
     * profile above. Neither is authored content, so neither prints as a value — they show as a
     * placeholder, and only a name the author actually chose reads as one.
     *
     * "Is this authored?" is `characterStageName`'s question, not a second opinion: that rule
     * discards `"character"` and keys on the id instead, so a stage key that is not the trimmed
     * text means the text was never a name.
     *
     * Display only. Whatever the payload already carries stays exactly as it is, and typing still
     * writes exactly what was typed.
     */
    const derivedObjectName = selectedCharacter?.profile.getName() ?? "";
    const authoredObjectName = (payload.objectName ?? "").trim();
    const objectNameIsDerived = !authoredObjectName
        || authoredObjectName === derivedObjectName
        || characterStageName(payload.characterId, payload.objectName) !== authoredObjectName;

    // The free numeric channel. Its own arm rather than a third `PuppetChannelControl` because it is
    // the one that is not a single name: a map of ids to numbers, each with the range the model gave.
    if (payload.operation === "setParams") {
        return (
            <div className="grid grid-cols-1 gap-3">
                <FieldGrid cols={2}>
                    <SelectField
                        label={t("storyInspector.field.character")}
                        options={characterOptions}
                        value={payload.characterId ?? ""}
                        onChange={updateCharacter}
                    />
                </FieldGrid>
                {selectedCharacter && selectedCharacter.profile.appearance.getKind() === "puppet" ? (
                    <Section title={t("storyInspector.character.puppetParams")}>
                        <PuppetParamRows
                            character={selectedCharacter}
                            params={payload.params ?? {}}
                            onChange={params => onChange({ ...payload, params })}
                        />
                    </Section>
                ) : selectedCharacter ? (
                    <div className="text-xs text-fg-subtle">{t("storyInspector.character.notPuppetHint")}</div>
                ) : (
                    <div className="text-xs text-fg-subtle">{t("storyInspector.character.chooseHint")}</div>
                )}
            </div>
        );
    }

    // A puppet state row addresses the inside of the box: no stage name, no transform, no transition.
    // What it does get is the model - the names it reported and a picture of it in the state this row
    // asks for. Blank is not "unfilled": it is the engine's `null`, the request to clear.
    if (payload.operation === "setMotion" || payload.operation === "setSkin") {
        const channel = payload.operation === "setMotion" ? "motion" : "skin";
        return (
            <div className="grid grid-cols-1 gap-3">
                <FieldGrid cols={2}>
                    <SelectField
                        label={t("storyInspector.field.character")}
                        options={characterOptions}
                        value={payload.characterId ?? ""}
                        onChange={updateCharacter}
                    />
                </FieldGrid>
                {selectedCharacter && selectedCharacter.profile.appearance.getKind() === "puppet" ? (
                    <Section title={t("storyInspector.section.appearance")}>
                        <PuppetChannelControl
                            character={selectedCharacter}
                            channel={channel}
                            value={payload.puppetName ?? ""}
                            onChange={puppetName => onChange({ ...payload, puppetName })}
                        />
                    </Section>
                ) : selectedCharacter ? (
                    // A character Studio draws itself has no runtime state to ask for. The command line
                    // refuses the line outright (`notPuppetCharacter`); a row that got here through the
                    // inspector says the same thing rather than offering a field the compile ignores.
                    <div className="text-xs text-fg-subtle">{t("storyInspector.character.notPuppetHint")}</div>
                ) : (
                    <div className="text-xs text-fg-subtle">{t("storyInspector.character.chooseHint")}</div>
                )}
            </div>
        );
    }

    // A rename touches the speaker label and nothing else - no portrait, so no stage name, appearance,
    // transform or transition. Offering those would be offering to edit fields the compile never reads.
    if (payload.operation === "setName") {
        return (
            <FieldGrid cols={2}>
                <SelectField
                    label={t("storyInspector.field.character")}
                    options={characterOptions}
                    value={payload.characterId ?? ""}
                    onChange={updateCharacter}
                />
                <TextField
                    label={t("storyInspector.character.displayName")}
                    value={payload.displayName ?? ""}
                    onChange={displayName => onChange({ ...payload, displayName })}
                />
            </FieldGrid>
        );
    }

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
                    label={t("storyInspector.character.objectName")}
                    value={objectNameIsDerived ? "" : payload.objectName ?? ""}
                    placeholder={derivedObjectName}
                    onChange={objectName => onChange({ ...payload, objectName })}
                />
            </FieldGrid>
            {selectedCharacter && isPuppetAppearanceKind(selectedCharacter.profile.appearance.getKind()) ? (
                // The three runtime-drawn kinds answer "which look" with a name only the model knows - so
                // the project-side picker has nothing to show, and the model is asked instead.
                <Section title={t("storyInspector.section.appearance")}>
                    <PuppetChannelControl
                        character={selectedCharacter}
                        channel="expression"
                        value={payload.puppetName ?? ""}
                        onChange={puppetName => onChange({ ...payload, puppetName })}
                    />
                </Section>
            ) : selectedCharacter ? (
                <Section title={t("storyInspector.section.appearance")}>
                    <CharacterAppearancePicker
                        character={selectedCharacter}
                        pose={payload.pose}
                        tags={payload.tags}
                        onChange={next => onChange({ ...payload, pose: next.pose, tags: next.tags })}
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
                {op === "backdrop" ? (
                    // Sibling of the CSS-filter field: a raw backdrop-filter string (`blur(8px)` for
                    // frosted glass), edited exactly as `filter` is - the hint below carries the example.
                    <TextField
                        label={t("storyInspector.displayableEffect.backdropFilter")}
                        value={payload.backdropFilter ?? ""}
                        onChange={backdropFilter => props.onChange({ ...payload, backdropFilter: backdropFilter || undefined })}
                    />
                ) : null}
                {op === "blend" ? (
                    // The same six curated modes the ambience overlay offers, not the CSS catalogue.
                    <SelectField
                        label={t("storyInspector.displayableEffect.blendMode")}
                        options={vfxBlendOptions(t)}
                        value={payload.mixBlendMode ?? "normal"}
                        onChange={mixBlendMode => props.onChange({ ...payload, mixBlendMode: mixBlendMode as StoryVfxBlendMode })}
                    />
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
                    // 0.16.0: a hard iris (Mask.iris feather 0). The old partial from/to radii have no
                    // engine equivalent and are no longer offered - only the centre is adjustable.
                    <TextField label={t("storyInspector.field.center")} value={paramString(value.props, "center", "50% 50%")} onChange={center => setParam({ center: center || undefined })} />
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
                        <SelectField
                            label={t("storyInspector.field.shape")}
                            options={irisShapeOptions(t)}
                            value={paramString(value.props, "shape", "circle")}
                            onChange={shape => setParam({ shape: String(shape) })}
                        />
                    </>
                ) : null}
                {kind === "barnDoor" ? (
                    <>
                        <SelectField
                            label={t("storyInspector.field.axis")}
                            options={blindsOrientationOptions(t)}
                            value={paramString(value.props, "axis", "horizontal")}
                            onChange={axis => setParam({ axis: String(axis) })}
                        />
                        <NumberField label={t("storyInspector.field.feather")} value={paramNumber(value.props, "feather")} onChange={feather => setParam({ feather })} />
                    </>
                ) : null}
                {kind === "clock" ? (
                    <>
                        <TextField label={t("storyInspector.field.center")} value={paramString(value.props, "center", "50% 50%")} onChange={center => setParam({ center: center || undefined })} />
                        <NumberField label={t("storyInspector.field.fromAngle")} value={paramNumber(value.props, "from")} onChange={from => setParam({ from })} />
                        <NumberField label={t("storyInspector.field.feather")} value={paramNumber(value.props, "feather")} onChange={feather => setParam({ feather })} />
                        <SelectField
                            label={t("storyInspector.field.direction")}
                            options={clockDirectionOptions(t)}
                            value={paramString(value.props, "direction", "clockwise")}
                            onChange={direction => setParam({ direction: String(direction) })}
                        />
                    </>
                ) : null}
                {kind === "fan" ? (
                    <>
                        <NumberField label={t("storyInspector.field.blades")} value={paramNumber(value.props, "blades")} onChange={blades => setParam({ blades })} />
                        <TextField label={t("storyInspector.field.center")} value={paramString(value.props, "center", "50% 50%")} onChange={center => setParam({ center: center || undefined })} />
                        <NumberField label={t("storyInspector.field.fromAngle")} value={paramNumber(value.props, "from")} onChange={from => setParam({ from })} />
                        <NumberField label={t("storyInspector.field.feather")} value={paramNumber(value.props, "feather")} onChange={feather => setParam({ feather })} />
                    </>
                ) : null}
                {kind === "dots" ? (
                    <>
                        <NumberField label={t("storyInspector.field.rows")} value={paramNumber(value.props, "rows")} onChange={rows => setParam({ rows })} />
                        <NumberField label={t("storyInspector.field.cols")} value={paramNumber(value.props, "cols")} onChange={cols => setParam({ cols })} />
                        <NumberField label={t("storyInspector.field.feather")} value={paramNumber(value.props, "feather")} onChange={feather => setParam({ feather })} />
                        <NumberField label={t("storyInspector.field.stagger")} value={paramNumber(value.props, "stagger")} onChange={stagger => setParam({ stagger })} />
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
                {kind === "darkness" ? (
                    // Left empty, the compiler applies the 1 → 0 pair: the new frame emerges out of
                    // black. Values outside 0-1 are clamped by the compiler, not by this field.
                    <>
                        <NumberField label={t("storyInspector.transition.darknessFrom")} value={paramNumber(value.props, "from")} onChange={from => setParam({ from })} />
                        <NumberField label={t("storyInspector.transition.darknessTo")} value={paramNumber(value.props, "to")} onChange={to => setParam({ to })} />
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
    if (props.payload.control === "label") {
        const labelPayload = props.payload;
        return (
            <div className="max-w-sm">
                <TextField
                    label={t("storyInspector.control.labelName")}
                    value={labelPayload.name}
                    onChange={name => props.onChange({ ...labelPayload, name })}
                />
            </div>
        );
    }
    if (props.payload.control === "goto") {
        const gotoPayload = props.payload;
        // A picker, not a free field: the target must be a label declared in THIS scene or the build
        // fails, so offering the scene's own labels is the difference between a choice and a guess.
        // Any dangling value already stored stays selectable, or switching rows would silently rewrite it.
        const names = sceneLabelNames(props.document.scenes[props.sceneId]);
        const options: SelectOption[] = names.map(name => ({ value: name, label: name }));
        if (gotoPayload.targetLabel && !names.includes(gotoPayload.targetLabel)) {
            options.unshift({ value: gotoPayload.targetLabel, label: gotoPayload.targetLabel });
        }
        return (
            <div className="max-w-sm">
                <SelectField
                    label={t("storyInspector.control.gotoTarget")}
                    options={options.length > 0 ? options : [{ value: "", label: t("storyInspector.control.noLabels") }]}
                    value={gotoPayload.targetLabel}
                    onChange={targetLabel => props.onChange({ ...gotoPayload, targetLabel: String(targetLabel) })}
                />
            </div>
        );
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

/**
 * The line's localization key: the id translation and voice-over file this line under. It is a uuid,
 * which is nothing an author reads — so it stays folded away and copies in one click, the same shape
 * the asset overview's storage row uses for hashes and shard paths (U3a).
 */
function TextIdReadout(props: { text: StoryTextSegment }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    return (
        <div>
            <button
                type="button"
                onClick={() => setOpen(value => !value)}
                aria-expanded={open}
                className="flex items-center gap-1 rounded-md text-2xs text-fg-subtle transition-colors hover:text-fg-muted"
            >
                <ChevronDown className={`h-3 w-3 transition-transform ${open ? "" : "-rotate-90"}`} />
                {t("storyInspector.textId")}
            </button>
            {open && (
                <div className="mt-1 flex items-center gap-2 rounded-md border border-edge bg-surface-raised px-2.5 py-1.5">
                    <span className="min-w-0 flex-1 truncate font-mono text-2xs text-fg-muted" title={props.text.textId}>
                        {props.text.textId}
                    </span>
                    <button
                        type="button"
                        title={t("common.copy")}
                        aria-label={t("common.copy")}
                        onClick={() => void navigator.clipboard?.writeText(props.text.textId)}
                        className="shrink-0 rounded-md p-0.5 text-fg-subtle transition-colors hover:bg-fill hover:text-fg-muted"
                    >
                        <Copy className="h-3 w-3" />
                    </button>
                </div>
            )}
        </div>
    );
}

function TextField(props: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options?: SelectOption[];
    /** Shown when `value` is empty — used for a derived default, which is not authored content. */
    placeholder?: string;
}) {
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
                placeholder={props.placeholder}
                onChange={props.onChange}
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
                    className="grid h-6 w-6 place-items-center rounded-md text-fg-muted transition-colors hover:bg-fill hover:text-fg"
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
