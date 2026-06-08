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
import type { Character } from "@/lib/workspace/services/character/Character";
import { Select, type SelectOption } from "@/lib/components/elements";
import { EnhancedInput } from "@/lib/components/inputs/EnhancedInput";
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
    const { label, icon: Icon } = getBlockBadgeInfo(block);

    return (
        <div className="mt-2 max-w-3xl rounded-xl border border-white/10 bg-[#16191e] p-3 shadow-lg" onClick={event => event.stopPropagation()}>
            <div className="mb-3 flex items-center gap-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.04] text-primary">
                    <Icon className="h-4 w-4" />
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
            <div className="grid gap-2 sm:grid-cols-2">
                <TextField label="Asset id" value={payload.assetId ?? ""} onChange={assetId => props.onChange({ ...payload, assetId })} />
                <TextField label="Color" value={payload.color ?? ""} onChange={color => props.onChange({ ...payload, color })} />
            </div>
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
