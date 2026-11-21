import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, MoreHorizontal, Plus, X } from "lucide-react";
import type { StoryBlock } from "@shared/types/story";
import {
    CHARACTER_BEHAVIOUR_EVENTS,
    isCharacterBehaviourBlock,
    type CharacterBehaviourEvent,
    type CharacterBehaviours,
} from "@shared/story/characterBehaviours";
import { Button, ContextMenu, IconButton, useContextMenu, type ContextMenuDef } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { AssetSetService } from "@/lib/workspace/services/assets/AssetSetService";
import type { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import { Character } from "@/lib/workspace/services/character/Character";
import type { StoredCharacter } from "@/lib/workspace/services/character/types";
import { useProjectAudioTracks } from "@/lib/story/useProjectAudioTracks";
import {
    applyCharacterBehaviourPreset,
    characterBehaviourPresetRows,
    CHARACTER_BEHAVIOUR_PRESET_IDS,
} from "@/lib/story/characterBehaviourPresets";
import { useSlashAtAlias } from "@/apps/workspace/hooks/useSlashAtAlias";
import { InsertRow } from "@/apps/workspace/modules/story/scene-editor/StorySceneEditorRows";
import {
    StoryCommandLineBox,
    StoryCommandLineProvider,
    StoryCommandLineText,
    useStoryCommandLine,
    useStoryCommandLineContext,
} from "@/apps/workspace/modules/story/scene-editor/StoryCommandLineView";
import { toDisplayedCommandLine } from "@/apps/workspace/modules/story/scene-editor/commandTrigger";
import { buildStoryCommandContext, type StoryCommandAssetFolderInput } from "@/apps/workspace/modules/story/scene-editor/storyCommandContext";
import { getCommandSpec } from "@/apps/workspace/modules/story/scene-editor/commands/registry";
import { buildBehaviourBlockFromLine, CHARACTER_BEHAVIOUR_COMMAND_IDS } from "@/apps/workspace/modules/story/scene-editor/storyBehaviourLine";
import type { StoryCommandContext } from "@/apps/workspace/modules/story/scene-editor/storyCommandValues";
import type { EditorMode } from "@/apps/workspace/modules/story/scene-editor/storySceneEditorTypes";
import { AssetCategory } from "@/lib/workspace/services/assets/assetTypes";
import type { CustomFieldProps } from "../framework/types";
import type { CharacterEditorContext } from "../schemas/characterSchema";

/**
 * What this character does on its own when it starts and stops speaking.
 *
 * Each event is a short list of command rows, written on the same command line the story editor uses
 * - same words, same completion, same colours - because these are story rows: the compiler places
 * them in front of the lines where the floor changes hands, exactly as if the author had written them
 * there. See `@shared/story/characterBehaviours` for when each one runs.
 *
 * Laid out like the input-action list on a page: the events this character reacts to, each under its
 * own heading, and an "add" button offering the ones it does not react to yet.
 */
export function CharacterBehavioursField({ data }: CustomFieldProps<CharacterEditorContext>) {
    const { t } = useTranslation();
    const profile = data.character.profile;
    // Local, but tagged with whose value it is: the panel reuses one mounted field across characters.
    // Same shape as `CharacterEntranceField`.
    const characterId = profile.getId();
    const [draft, setDraft] = useState(() => ({ characterId, value: profile.getBehaviours() }));
    const behaviours = draft.characterId === characterId ? draft.value : profile.getBehaviours();

    const commit = (next: CharacterBehaviours | undefined): void => {
        profile.setBehaviours(next);
        // What the setter kept, which is not always what it was handed (a row it refuses is dropped).
        setDraft({ characterId, value: profile.getBehaviours() });
    };

    const { characters, commandContext, characterService } = useBehaviourCommandContext();
    const slashAtAlias = useSlashAtAlias();
    const present = CHARACTER_BEHAVIOUR_EVENTS.filter(event => behaviours?.[event] !== undefined);
    const missing = CHARACTER_BEHAVIOUR_EVENTS.filter(event => behaviours?.[event] === undefined);
    const addMenu = useContextMenu();
    const presetMenu = useContextMenu();
    const presetCharacter = (character: Character) => ({
        id: character.profile.getId(),
        name: character.profile.getName(),
        entrance: character.profile.getEntranceTransform(),
    });
    const newRowId = () => globalThis.crypto.randomUUID();
    const presetItems: ContextMenuDef = [
        ...CHARACTER_BEHAVIOUR_PRESET_IDS.map(presetId => ({
            id: presetId,
            label: t(`characters.properties.behaviourPreset.${presetId}`),
            onClick: () => commit(applyCharacterBehaviourPreset(behaviours, characterBehaviourPresetRows(presetId, presetCharacter(data.character), newRowId))),
        })),
        { id: "separator", separator: true as const },
        {
            id: "all",
            label: t("characters.properties.behaviourPresetAll"),
            disabled: !characterService,
            submenu: CHARACTER_BEHAVIOUR_PRESET_IDS.map(presetId => ({
                id: `all:${presetId}`,
                label: t(`characters.properties.behaviourPreset.${presetId}`),
                onClick: () => {
                    if (!characterService) {
                        return;
                    }
                    // Each character from its own entrance defaults, landed as one step of undo.
                    const records = characterService.listCharacter().map(character => {
                        const draft = Character.fromJSON(character.toJSON());
                        draft.profile.setBehaviours(applyCharacterBehaviourPreset(
                            draft.profile.getBehaviours(),
                            characterBehaviourPresetRows(presetId, presetCharacter(draft), newRowId),
                        ));
                        return draft.toJSON() as StoredCharacter;
                    });
                    characterService.commitCharacterRecords(records, {
                        key: "characters.history.applyBehaviourPresetAll",
                        params: { preset: t(`characters.properties.behaviourPreset.${presetId}`) },
                    });
                    setDraft({ characterId, value: profile.getBehaviours() });
                },
            })),
        },
    ];
    const addItems: ContextMenuDef = missing.map(event => ({
        id: event,
        label: t(`characters.properties.behaviourEvent.${event}`),
        onClick: () => commit({ ...(behaviours ?? {}), [event]: [] }),
    }));

    return (
        <StoryCommandLineProvider slashAtAlias={slashAtAlias} commandContext={commandContext}>
            {/* The story editor's row metrics, narrowed to a panel: no gutter mark, a slim margin. */}
            <div className="min-w-0 space-y-2 [--nl-story-gutter:20px] [--nl-story-mark:0px]">
                {present.map(event => (
                    <BehaviourEventSection
                        key={`${characterId}:${event}`}
                        event={event}
                        otherEvents={missing}
                        onRetarget={next => {
                            // The rows move with the trigger: changing when a behaviour runs is not a
                            // reason to retype what it does.
                            const moved: CharacterBehaviours = { ...(behaviours ?? {}), [next]: behaviours?.[event] ?? [] };
                            delete moved[event];
                            commit(moved);
                        }}
                        rows={behaviours?.[event] ?? []}
                        characters={characters}
                        commandContext={commandContext}
                        slashAtAlias={slashAtAlias}
                        onChange={rows => commit({ ...(behaviours ?? {}), [event]: rows })}
                        onRemove={() => {
                            const next = { ...(behaviours ?? {}) };
                            delete next[event];
                            commit(next);
                        }}
                    />
                ))}
                {/* Adding is a dashed ghost row, apart from the boxes above it: the box's own add row adds a
                    command to that behaviour, this one adds a behaviour. Gone once both events exist. */}
                <div className="flex items-center gap-2">
                    {missing.length > 0 && (
                        <button
                            type="button"
                            onClick={addMenu.showMenu}
                            className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-dashed border-edge px-2 text-left text-xs text-fg-muted transition-colors hover:border-edge-strong hover:bg-fill-subtle hover:text-fg focus-visible:!outline focus-visible:!outline-1 focus-visible:!outline-primary/60"
                        >
                            <Plus className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{t("characters.properties.behaviourAdd")}</span>
                        </button>
                    )}
                    <Button size="sm" variant="ghost" className={missing.length > 0 ? "shrink-0" : undefined} onClick={presetMenu.showMenu}>
                        {t("characters.properties.behaviourPresets")}
                    </Button>
                </div>
                <ContextMenu
                    items={addItems}
                    position={addMenu.menuState.position}
                    visible={addMenu.menuState.visible}
                    onClose={addMenu.hideMenu}
                />
                <ContextMenu
                    items={presetItems}
                    position={presetMenu.menuState.position}
                    visible={presetMenu.menuState.visible}
                    onClose={presetMenu.hideMenu}
                />
            </div>
        </StoryCommandLineProvider>
    );
}

function BehaviourEventSection(props: {
    event: CharacterBehaviourEvent;
    /** The events this character does not react to yet: where the trigger can be moved to. */
    otherEvents: readonly CharacterBehaviourEvent[];
    onRetarget: (event: CharacterBehaviourEvent) => void;
    rows: StoryBlock[];
    characters: Character[];
    commandContext: StoryCommandContext;
    slashAtAlias: boolean;
    onChange: (rows: StoryBlock[]) => void;
    onRemove: () => void;
}) {
    const { t } = useTranslation();
    const { trigger } = useStoryCommandLineContext();
    /**
     * Which line is open for typing: a row being rewritten (its id), the trailing "add" line, or none.
     * One at a time, as in the story editor - two open fields would be two places Enter could mean.
     */
    const [editing, setEditing] = useState<{ rowId: string | null; initial: string; token: number } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const readerRef = useRef<Map<string, string>>(new Map());

    const open = (rowId: string | null, initial: string) => {
        setError(null);
        setEditing({ rowId, initial, token: Date.now() });
    };
    const close = () => {
        setError(null);
        setEditing(null);
    };

    const commitLine = (line: string): boolean => {
        const result = buildBehaviourBlockFromLine(line, props.commandContext);
        if (!result.ok) {
            setError(t(result.reason === "notAllowed"
                ? "characters.properties.behaviourRowNotAllowed"
                : "characters.properties.behaviourRowIncomplete"));
            return false;
        }
        const block = result.block;
        if (!isCharacterBehaviourBlock(block)) {
            setError(t("characters.properties.behaviourRowNotAllowed"));
            return false;
        }
        const rowId = editing?.rowId;
        const next = rowId
            ? props.rows.map(row => (row.id === rowId ? { ...block, id: row.id } : row))
            : [...props.rows, block];
        props.onChange(next);
        close();
        return true;
    };

    const eventLabel = t(`characters.properties.behaviourEvent.${props.event}`);
    const rowMenu = useContextMenu();
    const triggerMenu = useContextMenu();
    // One "…" for the behaviour as a whole. Its only action is removal, kept off the face of the box so
    // a delete never sits beside the trigger a click is meant to change.
    const rowMenuItems: ContextMenuDef = [
        { id: "remove", label: t("characters.properties.behaviourRemove"), onClick: props.onRemove },
    ];
    const triggerItems: ContextMenuDef = props.otherEvents.map(event => ({
        id: event,
        label: t(`characters.properties.behaviourEvent.${event}`),
        onClick: () => props.onRetarget(event),
    }));

    return (
        <div className="min-w-0 overflow-hidden rounded-md border border-edge">
            {/* The trigger heads its own box: it names when the commands under it run. */}
            <div className="group/behaviour flex min-h-8 items-center gap-1 border-b border-edge-subtle bg-fill-subtle py-0.5 pl-2 pr-1">
                {props.otherEvents.length > 0 ? (
                    <button
                        type="button"
                        onClick={triggerMenu.showMenu}
                        aria-haspopup="menu"
                        className="flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-xs text-fg hover:bg-fill focus-visible:!outline focus-visible:!outline-1 focus-visible:!outline-primary/60"
                    >
                        <span className="truncate">{eventLabel}</span>
                        <ChevronDown aria-hidden="true" className="h-3 w-3 shrink-0 text-fg-subtle" />
                    </button>
                ) : (
                    <span className="min-w-0 truncate px-1 text-xs text-fg">{eventLabel}</span>
                )}
                <span className="flex-1" />
                <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label={t("characters.properties.behaviourMore")}
                    data-tip={t("characters.properties.behaviourMore")}
                    className="opacity-0 focus-visible:opacity-100 group-hover/behaviour:opacity-100"
                    onClick={rowMenu.showMenu}
                >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                </IconButton>
                <ContextMenu items={rowMenuItems} position={rowMenu.menuState.position} visible={rowMenu.menuState.visible} onClose={rowMenu.hideMenu} />
                <ContextMenu items={triggerItems} position={triggerMenu.menuState.position} visible={triggerMenu.menuState.visible} onClose={triggerMenu.hideMenu} />
            </div>
            <div>
                {props.rows.map(row => (
                    editing?.rowId === row.id ? (
                        <BehaviourLineInput
                            key={row.id}
                            editing={editing}
                            characters={props.characters}
                            commandContext={props.commandContext}
                            slashAtAlias={props.slashAtAlias}
                            onCommit={commitLine}
                            onClose={close}
                        />
                    ) : (
                        <BehaviourRow
                            key={row.id}
                            block={row}
                            characters={props.characters}
                            trigger={trigger}
                            readerRef={readerRef}
                            onOpen={() => open(row.id, readerRef.current.get(row.id) ?? "")}
                            onDelete={() => props.onChange(props.rows.filter(entry => entry.id !== row.id))}
                        />
                    )
                ))}
                {editing && editing.rowId === null ? (
                    <BehaviourLineInput
                        editing={editing}
                        characters={props.characters}
                        commandContext={props.commandContext}
                        slashAtAlias={props.slashAtAlias}
                        onCommit={commitLine}
                        onClose={close}
                    />
                ) : (
                    <button
                        type="button"
                        className="flex min-h-[var(--nl-story-row-box)] w-full items-center gap-2 px-2 py-1 text-left text-sm text-fg-subtle hover:bg-fill focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
                        // Opened on the trigger, so the command menu is up at once: a behaviour line is
                        // a command and nothing else.
                        onClick={() => open(null, trigger)}
                    >
                        <Plus className="h-3.5 w-3.5 shrink-0" />
                        {t("characters.properties.behaviourAddRow")}
                    </button>
                )}
            </div>
            {error && <p className="border-t border-edge-subtle px-2 py-1 text-2xs text-danger">{error}</p>}
        </div>
    );
}

/** One committed row, printed as the command line that wrote it. Click to rewrite it in place. */
function BehaviourRow(props: {
    block: StoryBlock;
    characters: Character[];
    trigger: "/" | "@";
    readerRef: React.MutableRefObject<Map<string, string>>;
    onOpen: () => void;
    onDelete: () => void;
}) {
    const { t } = useTranslation();
    const { hideParamNames } = useStoryCommandLineContext();
    const projection = useStoryCommandLine(props.block, props.characters, undefined, undefined);
    const source = projection?.source ?? "";
    // The text the row would hand back to the command line - the same line it prints, trigger included.
    useEffect(() => {
        props.readerRef.current.set(props.block.id, toDisplayedCommandLine(source, props.trigger));
    });
    return (
        <div className="group flex min-w-0 items-center gap-1 border-b border-edge px-2 py-1 hover:bg-fill">
            <button
                type="button"
                className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
                onClick={props.onOpen}
            >
                <StoryCommandLineBox>
                    <StoryCommandLineText source={source} trigger={props.trigger} hideParamNames={hideParamNames} />
                </StoryCommandLineBox>
            </button>
            <IconButton
                size="sm"
                variant="ghost"
                className={cn("opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
                aria-label={t("characters.properties.behaviourRowDelete")}
                title={t("characters.properties.behaviourRowDelete")}
                onClick={props.onDelete}
            >
                <X className="h-3.5 w-3.5" />
            </IconButton>
        </div>
    );
}

/** Module-level so the slot's memoized menus key on one object for the life of the app. */
const BEHAVIOUR_COMMAND_SCOPE = { commandIds: CHARACTER_BEHAVIOUR_COMMAND_IDS };

/**
 * The story editor's own command-line slot, hosted outside a scene.
 *
 * Everything that makes the line pleasant to type - the candidate menus, the colours, the ghost
 * hint, the argument completion - lives inside `InsertRow`; what changes here is only what Enter
 * does with the finished line: it becomes one behaviour row instead of one scene row.
 */
function BehaviourLineInput(props: {
    editing: { rowId: string | null; initial: string; token: number };
    characters: Character[];
    commandContext: StoryCommandContext;
    slashAtAlias: boolean;
    onCommit: (line: string) => boolean;
    onClose: () => void;
}) {
    const inputRef = useRef<HTMLTextAreaElement | null>(null);
    const draftRef = useRef<string>(props.editing.initial);
    const [mode, setMode] = useState<Extract<EditorMode, { kind: "insert" }>>(() => ({
        kind: "insert",
        slot: { afterBlockId: null, focusToken: props.editing.token },
        initialValue: props.editing.initial,
    }));
    useEffect(() => {
        window.requestAnimationFrame(() => {
            const input = inputRef.current;
            if (input) {
                input.focus();
                input.setSelectionRange(input.value.length, input.value.length);
            }
        });
    }, [mode.slot]);

    const reseed = (value: string) => {
        draftRef.current = value;
        setMode({ kind: "insert", slot: { afterBlockId: null, focusToken: Date.now() }, initialValue: value });
    };
    const resolve = () => {
        const line = draftRef.current.trim();
        // A bare trigger is the line the slot opened with: nothing was written.
        if (!line || line === "/" || line === "@") {
            props.onClose();
            return;
        }
        props.onCommit(line);
    };

    return (
        <InsertRow
            mode={mode}
            characters={props.characters}
            tempSpeakers={[]}
            commandContext={props.commandContext}
            inputRef={inputRef}
            draftRef={draftRef}
            onValueChange={value => {
                draftRef.current = value;
                if (mode.chooserDismissed) {
                    setMode(current => ({ ...current, chooserDismissed: false }));
                }
            }}
            // Blur and a plain-text Enter: a behaviour holds commands only, so prose is never a row.
            // An empty line simply closes; anything else is tried as a command and stays open if it
            // is not one, with the reason under it.
            onCommitNarration={() => resolve()}
            onDismissChooser={() => setMode(current => ({ ...current, chooserDismissed: true }))}
            onDiscardSlot={() => props.onClose()}
            onResolveLine={resolve}
            onCommitInvalid={resolve}
            onChooseCommand={commandId => {
                // Reached only for a command with nothing more to fill in (`InsertRow` completes the
                // rest), so the line is the command word alone.
                const token = getCommandSpec(commandId)?.token;
                if (token && !props.onCommit(`/${token}`)) {
                    reseed(`/${token} `);
                }
            }}
            // Never reached: the scope turns the `#` speaker picker off.
            onChooseCharacter={() => undefined}
            onChooseTempSpeaker={() => undefined}
            onBackspaceEmpty={() => props.onClose()}
            slashAtAlias={props.slashAtAlias}
            commandScope={BEHAVIOUR_COMMAND_SCOPE}
        />
    );
}

/**
 * The view of the project a behaviour's command line resolves names against: the cast, the files and
 * the audio buses. No scene: a behaviour runs in every scene, so a name only one scene declares is
 * not one it can count on, and a command that needs one reports it as unknown.
 */
function useBehaviourCommandContext(): { characters: Character[]; commandContext: StoryCommandContext; characterService: CharacterService | null } {
    const { context, isInitialized } = useWorkspace();
    const services = context && isInitialized ? context.services : null;
    const characterService = useMemo(() => services?.get<CharacterService>(Services.Character) ?? null, [services]);
    const assetsService = useMemo(() => services?.get<AssetsService>(Services.Assets) ?? null, [services]);
    const assetSetService = useMemo(() => services?.get<AssetSetService>(Services.AssetSets) ?? null, [services]);
    const audioTracks = useProjectAudioTracks();
    const [revision, setRevision] = useState(0);
    useEffect(() => characterService?.subscribe(() => setRevision(value => value + 1)), [characterService]);
    const characters = useMemo(() => characterService?.listCharacter() ?? [], [characterService, revision]);
    const commandContext = useMemo(() => buildStoryCommandContext({
        assets: assetsService?.getAssets(),
        assetFolders: assetFolders(assetsService),
        assetSets: assetSetService?.listSets() ?? [],
        characters,
        document: null,
        sceneId: null,
        scene: null,
        audioTracks,
    }), [assetSetService, assetsService, audioTracks, characters]);
    return { characters, commandContext, characterService };
}

function assetFolders(assetsService: AssetsService | null): StoryCommandAssetFolderInput[] {
    if (!assetsService) {
        return [];
    }
    try {
        const groups = assetsService.getGroupAssetsManager();
        return [AssetCategory.Image, AssetCategory.Media].flatMap(category => groups.getGroups(category))
            .map(group => ({ id: group.id, name: group.name, parentGroupId: group.parentGroupId }));
    } catch {
        return [];
    }
}
