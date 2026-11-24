import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Download, Plus, SquareFunction, X } from "lucide-react";
import type { StoryBlock } from "@shared/types/story";
import type { StoryCustomCommand, StoryCustomCommandParam, StoryCustomCommandRow } from "@shared/types/story/customCommands";
import { ContextMenu, EmptyState, FieldLabel, IconButton, Input, useContextMenu, type ContextMenuDef } from "@/lib/components/elements";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import { useTranslation } from "@/lib/i18n";
import type { EditorTabComponentProps } from "@/lib/workspace/services/ui/types";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import { useWorkspace } from "@/apps/workspace/context";
import { useSlashAtAlias } from "@/apps/workspace/hooks/useSlashAtAlias";
import type { Character } from "@/lib/workspace/services/character/Character";
import { useBehaviourCommandContext } from "@/apps/workspace/modules/properties/fields/CharacterBehavioursField";
import { InsertRow } from "@/apps/workspace/modules/story/scene-editor/StorySceneEditorRows";
import {
    StoryCommandLineBox,
    StoryCommandLineProvider,
    StoryCommandLineText,
    useStoryCommandLine,
    useStoryCommandLineContext,
} from "@/apps/workspace/modules/story/scene-editor/StoryCommandLineView";
import { toDisplayedCommandLine } from "@/apps/workspace/modules/story/scene-editor/commandTrigger";
import { StoryCommandGlyphMark, StoryGutterCell } from "@/apps/workspace/modules/story/scene-editor/StoryRowGutterMark";
import { getBlockBadgeInfo } from "@/apps/workspace/modules/story/scene-editor/storySceneBlockUtils";
import { storyEditorRootStyle, useStoryEditorTextStyle } from "@/apps/workspace/modules/story/scene-editor/storyEditorTextStyle";
import { getCommandSpec } from "@/apps/workspace/modules/story/scene-editor/commands/registry";
import {
    CUSTOM_COMMAND_BODY_COMMAND_IDS,
    customCommandNameTakenByBuiltin,
    customCommandParamType,
    useCustomStoryCommandsVersion,
} from "@/apps/workspace/modules/story/scene-editor/commands/customCommands";
import { customCommandLayer, customCommandSpecId } from "@/apps/workspace/modules/story/scene-editor/commands/customCommandState";
import {
    buildCustomCommandRow,
    customCommandParamsOf,
    customCommandRowLine,
    findCustomCommandPlaceholders,
    type CustomCommandRowProblem,
} from "@/apps/workspace/modules/story/scene-editor/customCommandDefinition";
import type { StoryCommandContext } from "@/apps/workspace/modules/story/scene-editor/storyCommandValues";
import type { EditorMode } from "@/apps/workspace/modules/story/scene-editor/storySceneEditorTypes";
import { localizedBooleanWord } from "@/apps/workspace/modules/story/scene-editor/commands/localizedBoolean";
import { useStoryCustomCommands } from "./useStoryCustomCommands";
import { useStoryCommandSharing } from "./useStoryCommandSharing";

export type StoryCommandTabPayload = { commandId: string };

/**
 * One of the project's own story commands: its name, the parameters its rows use, and the rows.
 *
 * The rows are written on the story editor's own command line, with `<名字>` where a value should
 * come from the call. Saved as they are committed - like a character's behaviours, there is no
 * separate save step.
 */
export function StoryCommandEditorTab({ tabId, payload }: EditorTabComponentProps<StoryCommandTabPayload>) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const { service, commands } = useStoryCustomCommands();
    const command = commands.find(candidate => candidate.id === payload?.commandId) ?? null;
    const sharing = useStoryCommandSharing(service);

    // The tab is titled by the command's name, and follows a rename.
    useEffect(() => {
        if (context && command) {
            context.services.get<UIService>(Services.UI).editor.update(tabId, { title: command.name });
        }
    }, [command?.name, context, tabId]);

    if (!service || !command) {
        return <EmptyState title={t("story.customCommands.missing")} className="h-full" />;
    }

    const update = (patch: Partial<Omit<StoryCustomCommand, "id">>) => service.updateCommand(command.id, patch);

    // Laid out as the story editor is: the title bar, a card for what the command is, then its rows on
    // the story editor's own grid, so a command reads as a short scene that takes arguments.
    return (
        <div
            data-help-topic="customStoryCommands"
            className="flex h-full min-h-0 flex-col bg-surface text-fg"
            style={storyEditorRootStyle("compact", Math.max(1, command.rows.length))}
        >
            <div className="flex min-h-[44px] items-center gap-3 border-b border-edge px-3">
                <div className="flex min-w-0 items-center gap-2">
                    <SquareFunction className="h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-fg">{command.name}</div>
                        <div className="truncate text-2xs text-fg-muted">{t("story.customCommands.title")}</div>
                    </div>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-1">
                    <ToolbarButton
                        size="sm"
                        aria-label={t("story.customCommands.copyAsText")}
                        data-tip={t("story.customCommands.copyAsText")}
                        onClick={() => void sharing.copyAsText([command])}
                    >
                        <Copy className="h-4 w-4" />
                    </ToolbarButton>
                    <ToolbarButton
                        size="sm"
                        aria-label={t("story.customCommands.export")}
                        data-tip={t("story.customCommands.export")}
                        onClick={() => void sharing.exportToFile([command])}
                    >
                        <Download className="h-4 w-4" />
                    </ToolbarButton>
                </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pb-16 pt-3">
                <CommandCard
                    command={command}
                    onUpdate={update}
                    nameProblem={name => service.nameProblem(name, command.id)}
                />
                <RowSection command={command} onChange={(rows, fresh) => update({ rows, params: customCommandParamsOf(rows, command.params, fresh) })} />
            </div>
        </div>
    );
}

/**
 * The command's card, as a scene's sits above its rows: collapsed it is the name and the description,
 * open it is where both are edited, beside the parameters the rows declare.
 */
function CommandCard(props: {
    command: StoryCustomCommand;
    onUpdate: (patch: Partial<Omit<StoryCustomCommand, "id">>) => void;
    nameProblem: (name: string) => string | null;
}) {
    const { t } = useTranslation();
    const [collapsed, setCollapsed] = useState(false);
    const description = props.command.description?.trim();
    return (
        <div className="mx-3 mb-3 overflow-hidden rounded-lg border border-edge bg-fill-subtle">
            <button
                type="button"
                onClick={() => setCollapsed(value => !value)}
                aria-expanded={!collapsed}
                data-tip={collapsed ? t("common.expand") : t("common.collapse")}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left outline-none transition-colors hover:bg-fill focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/60"
            >
                {collapsed ? (
                    <ChevronRight className="h-4 w-4 shrink-0 text-fg-subtle" />
                ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-fg-subtle" />
                )}
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">{props.command.name}</span>
                    <span className="block truncate text-2xs text-fg-subtle">{description || t("story.customCommands.noDescription")}</span>
                </span>
                {collapsed && props.command.params.length > 0 ? (
                    <span className="min-w-0 shrink truncate text-2xs text-fg-subtle">
                        {props.command.params.map(param => param.name).join(" · ")}
                    </span>
                ) : null}
            </button>
            {collapsed ? null : (
                <div
                    className="grid items-start gap-3 border-t border-edge p-3"
                    style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))" }}
                >
                    <div className="grid min-w-0 gap-3">
                        <NameField command={props.command} onRename={name => props.onUpdate({ name })} nameProblem={props.nameProblem} />
                        <div className="min-w-0">
                            <FieldLabel>{t("story.customCommands.description")}</FieldLabel>
                            <DraftInput
                                value={props.command.description ?? ""}
                                placeholder={t("story.customCommands.descriptionPlaceholder")}
                                onCommit={value => props.onUpdate({ description: value })}
                            />
                        </div>
                    </div>
                    <ParamSection command={props.command} onChange={params => props.onUpdate({ params })} />
                </div>
            )}
        </div>
    );
}

function NameField(props: { command: StoryCustomCommand; onRename: (name: string) => void; nameProblem: (name: string) => string | null }) {
    const { t } = useTranslation();
    const [problem, setProblem] = useState<string | null>(null);
    return (
        <div className="min-w-0">
            <FieldLabel>{t("story.customCommands.name")}</FieldLabel>
            <DraftInput
                value={props.command.name}
                onCommit={value => {
                    const trimmed = value.trim();
                    if (trimmed === props.command.name) {
                        setProblem(null);
                        return true;
                    }
                    const reason = props.nameProblem(trimmed) ?? (customCommandNameTakenByBuiltin(trimmed) ? "builtin" : null);
                    if (reason) {
                        setProblem(t(`story.customCommands.nameProblem.${reason}` as "story.customCommands.nameProblem.taken"));
                        return false;
                    }
                    setProblem(null);
                    props.onRename(trimmed);
                    return true;
                }}
            />
            {problem && <p className="mt-1 text-2xs text-danger">{problem}</p>}
        </div>
    );
}

/** A text field committed on blur and Enter; a refused value snaps back. */
function DraftInput(props: { value: string; placeholder?: string; onCommit: (value: string) => boolean | void }) {
    const [draft, setDraft] = useState(props.value);
    useEffect(() => setDraft(props.value), [props.value]);
    const commit = () => {
        if (draft === props.value) {
            return;
        }
        if (props.onCommit(draft) === false) {
            setDraft(props.value);
        }
    };
    return (
        <Input
            size="sm"
            value={draft}
            placeholder={props.placeholder}
            onChange={event => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={event => {
                if (event.key === "Enter") {
                    commit();
                } else if (event.key === "Escape") {
                    setDraft(props.value);
                }
            }}
        />
    );
}

function ParamSection(props: { command: StoryCustomCommand; onChange: (params: StoryCustomCommandParam[]) => void }) {
    const { t } = useTranslation();
    const { commandContext } = useBehaviourCommandContext();
    return (
        <section className="min-w-0">
            <FieldLabel as="div">{t("story.customCommands.params")}</FieldLabel>
            {props.command.params.length === 0 ? (
                <p className="text-xs text-fg-subtle">{t("story.customCommands.paramsEmpty")}</p>
            ) : (
                <div className="divide-y divide-edge-subtle rounded-md border border-edge bg-surface">
                    {props.command.params.map(param => (
                        <div key={param.name} className="flex min-h-8 items-center gap-3 px-3 py-1">
                            <span className="min-w-0 truncate text-xs text-fg">{param.name}</span>
                            <span className="text-2xs text-fg-subtle">{paramKindLabel(param, t)}</span>
                            <span className="flex-1" />
                            {param.default ? (
                                <span className="flex items-center gap-1 text-2xs text-fg-muted">
                                    {t("story.customCommands.paramDefault", { value: argText(param.default, commandContext) })}
                                    <IconButton
                                        size="sm"
                                        variant="ghost"
                                        aria-label={t("story.customCommands.clearDefault")}
                                        data-tip={t("story.customCommands.clearDefault")}
                                        onClick={() => props.onChange(props.command.params.map(entry => {
                                            if (entry.name !== param.name) {
                                                return entry;
                                            }
                                            const { default: _cleared, ...rest } = entry;
                                            return rest;
                                        }))}
                                    >
                                        <X className="h-3 w-3" />
                                    </IconButton>
                                </span>
                            ) : (
                                <span className="text-2xs text-fg-subtle">{t("story.customCommands.paramRequired")}</span>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}

type Translate = ReturnType<typeof useTranslation>["t"];

function paramKindLabel(param: StoryCustomCommandParam, t: Translate): string {
    const type = customCommandParamType(param);
    const first = Array.isArray(type) ? type[0] : type;
    if (!first) {
        return t("story.customCommands.kind.unknown");
    }
    if (first.kind === "number") {
        return first.unit === "s" ? t("story.customCommands.kind.seconds") : t("story.customCommands.kind.number");
    }
    if (first.kind === "boolean") {
        return t("story.customCommands.kind.boolean");
    }
    if (first.kind === "enum") {
        return t("story.customCommands.kind.enum");
    }
    if (first.kind === "target" || first.kind === "character") {
        return t("story.customCommands.kind.character");
    }
    return t("story.customCommands.kind.text");
}

function argText(arg: StoryCustomCommandParam["default"], context: StoryCommandContext): string {
    if (!arg) {
        return "";
    }
    const value = arg.value;
    if (arg.kind === "boolean") {
        return localizedBooleanWord(value === true);
    }
    if (arg.kind === "target" || arg.kind === "character") {
        const target = (arg.kind === "target" ? arg.target : arg) as { characterId?: string; name?: string } | undefined;
        return context.characters.find(entry => entry.id === target?.characterId)?.name ?? target?.name ?? "";
    }
    return value === undefined || value === null ? "" : String(value);
}

/**
 * The rows, each printed as its command line with its parameters in place, plus the line to add one.
 * One line open at a time, as in the story editor.
 */
function RowSection(props: { command: StoryCustomCommand; onChange: (rows: StoryCustomCommandRow[], fresh: StoryCustomCommandParam[]) => void }) {
    const { t } = useTranslation();
    const slashAtAlias = useSlashAtAlias();
    const { characters, commandContext } = useBehaviourCommandContext();
    const customVersion = useCustomStoryCommandsVersion();
    // What the line may be written with: the body commands, and every other command of the project.
    // Never this one - a command that calls itself plays nothing.
    const scope = useMemo(() => {
        const ids = new Set(CUSTOM_COMMAND_BODY_COMMAND_IDS);
        for (const spec of customCommandLayer().specs) {
            if (spec.id !== customCommandSpecId(props.command.id)) {
                ids.add(spec.id);
            }
        }
        return { commandIds: ids as ReadonlySet<string> };
        // The version stands for the project's command list.
    }, [customVersion, props.command.id]);
    const [editing, setEditing] = useState<{ rowId: string | null; initial: string; token: number } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const readerRef = useRef<Map<string, string>>(new Map());
    const rowMenu = useContextMenu();
    const [menuRowId, setMenuRowId] = useState<string | null>(null);

    const trigger = slashAtAlias ? "@" : "/";
    const open = (rowId: string | null, initial: string) => {
        setError(null);
        setEditing({ rowId, initial, token: Date.now() });
    };
    const close = () => {
        setError(null);
        setEditing(null);
    };
    const commitLine = (line: string): boolean => {
        const rowId = editing?.rowId ?? undefined;
        const known = customCommandParamsOf(props.command.rows.filter(row => row.block.id !== rowId), props.command.params);
        const result = buildCustomCommandRow(line, commandContext, { rowId, known });
        if (!result.ok) {
            setError(rowProblemText(result.problem, t));
            return false;
        }
        const rows = rowId
            ? props.command.rows.map(row => (row.block.id === rowId ? result.row : row))
            : [...props.command.rows, result.row];
        props.onChange(rows, result.params);
        close();
        return true;
    };
    const move = (rowId: string, delta: number) => {
        const index = props.command.rows.findIndex(row => row.block.id === rowId);
        const target = index + delta;
        if (index < 0 || target < 0 || target >= props.command.rows.length) {
            return;
        }
        const rows = [...props.command.rows];
        [rows[index], rows[target]] = [rows[target], rows[index]];
        props.onChange(rows, []);
    };
    const menuIndex = props.command.rows.findIndex(row => row.block.id === menuRowId);
    const menuItems: ContextMenuDef = menuRowId ? [
        { id: "up", label: t("story.customCommands.moveUp"), disabled: menuIndex <= 0, onClick: () => move(menuRowId, -1) },
        { id: "down", label: t("story.customCommands.moveDown"), disabled: menuIndex >= props.command.rows.length - 1, onClick: () => move(menuRowId, 1) },
        { id: "separator", separator: true as const },
        { id: "delete", label: t("story.customCommands.deleteRow"), onClick: () => props.onChange(props.command.rows.filter(row => row.block.id !== menuRowId), []) },
    ] : [];

    const errorLine = error ? (
        <p className="pl-[var(--nl-story-gutter)] pr-3 pb-1 text-2xs text-danger">{error}</p>
    ) : null;

    return (
        <section aria-label={t("story.customCommands.rows")}>
            <StoryCommandLineProvider slashAtAlias={slashAtAlias} commandContext={commandContext}>
                {props.command.rows.map((row, index) => (
                    editing?.rowId === row.block.id ? (
                        <div key={row.block.id}>
                            <CommandLineInput
                                editing={editing}
                                characters={characters}
                                commandContext={commandContext}
                                slashAtAlias={slashAtAlias}
                                scope={scope}
                                onCommit={commitLine}
                                onClose={close}
                            />
                            {errorLine}
                        </div>
                    ) : (
                        <CommandRow
                            key={row.block.id}
                            row={row}
                            lineNumber={index + 1}
                            characters={characters}
                            trigger={trigger}
                            readerRef={readerRef}
                            menuOpen={rowMenu.menuState.visible && menuRowId === row.block.id}
                            onOpen={() => open(row.block.id, readerRef.current.get(row.block.id) ?? "")}
                            onMenu={event => {
                                setMenuRowId(row.block.id);
                                rowMenu.showMenu(event);
                            }}
                            onDelete={() => props.onChange(props.command.rows.filter(entry => entry.block.id !== row.block.id), [])}
                        />
                    )
                ))}
                {editing && editing.rowId === null ? (
                    <>
                        <CommandLineInput
                            editing={editing}
                            characters={characters}
                            commandContext={commandContext}
                            slashAtAlias={slashAtAlias}
                            scope={scope}
                            onCommit={commitLine}
                            onClose={close}
                        />
                        {errorLine}
                    </>
                ) : (
                    <button
                        type="button"
                        className="mt-1 flex min-h-[32px] w-full items-center gap-2 pl-[var(--nl-story-gutter)] pr-3 text-left text-sm text-fg-subtle hover:bg-fill-subtle hover:text-fg-muted"
                        onClick={() => open(null, trigger)}
                        onKeyDown={event => {
                            // Typing on the focused line starts the row with what was typed, as in the story editor.
                            if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
                                event.preventDefault();
                                open(null, event.key === "/" || event.key === "@" ? trigger : `${trigger}${event.key}`);
                            }
                        }}
                    >
                        <span className="flex w-[var(--nl-story-mark,26px)] shrink-0 items-center justify-center">
                            <Plus className="h-4 w-4 text-primary" />
                        </span>
                        {t("story.sceneEditor.addRow")}
                    </button>
                )}
            </StoryCommandLineProvider>
            <ContextMenu items={menuItems} position={rowMenu.menuState.position} visible={rowMenu.menuState.visible} onClose={rowMenu.hideMenu} />
        </section>
    );
}

function rowProblemText(problem: CustomCommandRowProblem, t: Translate): string {
    const name = "name" in problem ? problem.name : "";
    return t(`story.customCommands.rowProblem.${problem.code}` as "story.customCommands.rowProblem.incomplete", { name });
}

/**
 * One committed row on the story editor's grid: its number, the command's glyph, and the line that
 * wrote it with its parameters in place. Click to rewrite.
 */
function CommandRow(props: {
    row: StoryCustomCommandRow;
    lineNumber: number;
    characters: Character[];
    trigger: "/" | "@";
    readerRef: React.MutableRefObject<Map<string, string>>;
    menuOpen: boolean;
    onOpen: () => void;
    onMenu: (event: React.MouseEvent) => void;
    onDelete: () => void;
}) {
    const { t } = useTranslation();
    const { hideParamNames } = useStoryCommandLineContext();
    const textStyle = useStoryEditorTextStyle();
    const [hovered, setHovered] = useState(false);
    const block = props.row.block as StoryBlock;
    const projection = useStoryCommandLine(block, props.characters, undefined, undefined);
    const source = customCommandRowLine(projection?.source ?? "", props.row.bindings);
    const badge = getBlockBadgeInfo(block);
    useEffect(() => {
        props.readerRef.current.set(props.row.block.id, toDisplayedCommandLine(source, props.trigger));
    });
    return (
        <div
            role="button"
            tabIndex={0}
            data-story-command-row={props.row.block.id}
            className={[
                "group relative grid min-h-[calc(var(--nl-story-row-box)+0.5rem)] cursor-text grid-cols-[var(--nl-story-gutter)_1fr] items-start border-l-2 pr-3 outline-none focus-visible:border-primary",
                props.menuOpen ? "border-primary bg-fill-subtle" : "border-transparent hover:bg-fill-subtle",
            ].join(" ")}
            onClick={props.onOpen}
            onKeyDown={event => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    props.onOpen();
                }
            }}
            onContextMenu={props.onMenu}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <div className="flex h-full items-start justify-end pr-2 pt-1 text-2xs tabular-nums text-fg-subtle/60 transition-colors group-hover:text-fg-subtle">
                <span className="flex min-h-[var(--nl-story-row-box)] items-center">{props.lineNumber}</span>
            </div>
            <div className="min-w-0 py-1">
                <div className="flex min-h-[var(--nl-story-row-box)] min-w-0 items-start gap-3">
                    <StoryGutterCell active={hovered || props.menuOpen}>
                        <StoryCommandGlyphMark icon={badge.icon} label={badge.label} color={badge.iconColor} />
                    </StoryGutterCell>
                    <StoryCommandLineBox style={textStyle}>
                        <StoryCommandLineText source={source} trigger={props.trigger} hideParamNames={hideParamNames} />
                    </StoryCommandLineBox>
                    <span className="flex min-h-[var(--nl-story-row-box)] shrink-0 items-center">
                        <IconButton
                            size="sm"
                            variant="ghost"
                            className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                            aria-label={t("story.customCommands.deleteRow")}
                            data-tip={t("story.customCommands.deleteRow")}
                            onClick={event => {
                                event.stopPropagation();
                                props.onDelete();
                            }}
                        >
                            <X className="h-3.5 w-3.5" />
                        </IconButton>
                    </span>
                </div>
            </div>
        </div>
    );
}

/** A line with a `<参数>` in it is checked on commit, by `buildCustomCommandRow`, not by the story grammar. */
function holdsPlaceholders(source: string): boolean {
    return findCustomCommandPlaceholders(source).length > 0;
}

/** The story editor's command line, hosted in the command editor: Enter writes one command row. */
function CommandLineInput(props: {
    editing: { rowId: string | null; initial: string; token: number };
    characters: Character[];
    commandContext: StoryCommandContext;
    slashAtAlias: boolean;
    scope: { commandIds: ReadonlySet<string> };
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
            onCommitNarration={() => resolve()}
            onDismissChooser={() => setMode(current => ({ ...current, chooserDismissed: true }))}
            onDiscardSlot={() => props.onClose()}
            onResolveLine={resolve}
            onCommitInvalid={resolve}
            onChooseCommand={commandId => {
                const spec = getCommandSpec(commandId);
                const token = spec ? (customCommandLayer().commandBySpecId.get(commandId)?.name ?? spec.token) : null;
                if (token && !props.onCommit(`/${token}`)) {
                    reseed(`/${token} `);
                }
            }}
            onChooseCharacter={() => undefined}
            onChooseTempSpeaker={() => undefined}
            onBackspaceEmpty={() => props.onClose()}
            slashAtAlias={props.slashAtAlias}
            commandScope={props.scope}
            holdsReason={holdsPlaceholders}
        />
    );
}
