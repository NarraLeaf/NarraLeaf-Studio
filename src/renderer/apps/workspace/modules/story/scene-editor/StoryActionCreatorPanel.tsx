import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, CornerDownLeft, LayoutGrid, Plus, Star, X } from "lucide-react";
import type { PanelComponentProps } from "../../types";
import { Badge, Button, Input, PanelHeader, SectionCard } from "@/lib/components/elements";
// Not on the barrel (it lists the rest of the Phase 2 set); the other call sites reach in too.
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import { cn } from "@/lib/utils/cn";
import { useCommandTranslation, useTranslation } from "@/lib/i18n";
import { useHostDocument } from "@/lib/components/layout";
import { SearchBox } from "@/apps/workspace/modules/assets/components/SearchBox";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { PaletteActionCommand } from "./storyActionCommands";
import {
    commandCategoryLabelKey,
    getCommandGroup,
    STORY_COMMAND_CATEGORIES,
    type StoryCommandCategoryId,
    type StoryCommandGroup,
    type StoryCommandGroupId,
} from "./storyCommandCategories";
import { localizeSpecCommand } from "./commands/specPalette";
import { getCommandDef, getCommandSpec, listCommandSpecs, localizedCommandToken } from "./commands/registry";
import { specGroupIds } from "./commands/specSidebar";
import { availableSidebarGroups, buildSpecSidebarGroups, dedupeToPrimarySubject, filterSidebarGroups, pickStarredCommands, type StoryCommandSidebarGroup } from "./commands/specSidebar";
import { EMPTY_STORY_COMMAND_CONTEXT, type StoryCommandContext } from "./storyCommandValues";
import { useProjectAppTags } from "@/lib/story/useProjectAppTags";
import { searchActionCommands } from "./storyCommandSearch";
import { useStoryPluginActionCommands } from "./useStoryPluginActionCommands";
import { STARRED_ICON_COLOR } from "./storyActionCreatorFavorites";
import { useStarredStoryCommands } from "./useStarredStoryCommands";
import { useStoryCommandAbbreviations } from "./useStoryCommandAbbreviations";
import { abbreviationsOf, checkAbbreviation, type AbbreviationCheck, type StoryCommandAbbreviations } from "./storyCommandAbbreviations";
import {
    buildStoryCommandManual,
    type StoryCommandManualEntry,
    type StoryCommandManualParam,
} from "./storyCommandManualModel";
import {
    dispatchStoryActionCreateRequest,
    type StoryActionCreatorPanelPayload,
} from "./storyActionCreatorEvents";

/**
 * The command manual: the spec registry, browsed by subject and readable in place.
 *
 * This panel used to be an insert-only list — label, one line of detail, click to insert — while the
 * grammar itself (what a command takes, which words an enum accepts, what is required) lived in a
 * modal "command reference" you had to close before you could use anything you read there. Two
 * surfaces, each missing the other's half.
 *
 * Now it is one surface. The list browses; picking a command opens its documentation beside the
 * scene, generated from the same spec the parser reads, with the insert action on the page you are
 * reading. Nothing here is hand-written per command, so nothing here can go stale.
 *
 * The filing rule: a spec with a target param belongs to every subject its `accepts` names. Which of
 * those subjects a list *shows* depends on what the list is:
 *
 *  - Pick a subject and the full filing applies — "everything I can do to an Image" has to list
 *    `/show`, and there it is the answer, not a repeat.
 *  - Show everything at once — this panel's unfiltered tab, and the `/` browse, which has no filter at
 *    all — and it collapses to one row per command. Six `/show` rows with the same sentence under each
 *    read as six commands that share a name. Which subjects it reaches is on its detail page.
 *
 * Both surfaces take that collapse from the same function, so they cannot disagree about it.
 */

const STARRED_CATEGORY_ID = "starred";
const ALL_CATEGORY_ID = "all";

type SidebarTab = typeof STARRED_CATEGORY_ID | typeof ALL_CATEGORY_ID | StoryCommandCategoryId;

export function StoryActionCreatorPanel({ payload }: PanelComponentProps<StoryActionCreatorPanelPayload>) {
    const { t } = useTranslation();
    // The command reference is documentation of the command language, so its content follows
    // `editor.localizedCommands`; the panel's chrome around it follows the interface language.
    const { t: ct } = useCommandTranslation();
    const [query, setQuery] = useState("");
    const [activeTab, setActiveTab] = useState<SidebarTab>(ALL_CATEGORY_ID);
    const [openCommandId, setOpenCommandIdState] = useState<string | null>(null);
    const doc = useHostDocument();
    /**
     * The control that opened the page - the row the author pressed - so that backing out puts the
     * focus back on it. Without this the page's own controls unmounted under the focus and it fell to
     * the body, and the next Tab or arrow started from the top of the window instead of from the row.
     */
    const openerRef = useRef<HTMLElement | null>(null);
    const refocusOpenerRef = useRef(false);
    const setOpenCommandId = useCallback((commandId: string | null) => {
        if (commandId) {
            const active = doc.activeElement;
            openerRef.current = active instanceof HTMLElement && active !== doc.body ? active : null;
        } else {
            refocusOpenerRef.current = true;
        }
        setOpenCommandIdState(commandId);
    }, [doc]);
    useEffect(() => {
        if (openCommandId || !refocusOpenerRef.current) {
            return;
        }
        refocusOpenerRef.current = false;
        const opener = openerRef.current;
        openerRef.current = null;
        // Only while the focus is still the page's: an author who has since clicked into the scene
        // beside the panel keeps the focus where they put it.
        const active = doc.activeElement;
        const lost = !active || active === doc.body || !active.isConnected || active.closest("[data-command-page]") !== null;
        if (opener?.isConnected && lost) {
            opener.focus({ preventScroll: true });
        }
    }, [doc, openCommandId]);
    // The same set the `/` menu leads with, so a star set here heads that menu on the next line typed.
    const { starredIds, toggleStarred } = useStarredStoryCommands();
    // Edited here, on a command's page, and nowhere else; the list search reads the live ones so it
    // finds what the `/` menu finds.
    const { abbreviations, live: liveAbbreviations, addAbbreviation, removeAbbreviation } = useStoryCommandAbbreviations();
    const pluginCommands = useStoryPluginActionCommands();

    const localize = useCallback((command: PaletteActionCommand) => localizeSpecCommand(command, ct), [ct]);

    /**
     * What the availability gate reads. The panel is a catalogue, not an editor of one scene - it has
     * no story document and no caret - so it builds the one table the gate asks about (the project's
     * build variants) onto the empty context rather than projecting a whole project it cannot see.
     */
    const appTags = useProjectAppTags();
    const commandContext = useMemo<StoryCommandContext>(
        () => ({ ...EMPTY_STORY_COMMAND_CONTEXT, appTags: appTags.map(tag => ({ id: tag.id, name: tag.name })) }),
        [appTags],
    );

    /**
     * The browse content, gated to what this project can act on.
     *
     * Gated here rather than in each tab below, because both of them read this one list: the starred
     * tab picks its entries out of these groups and the subject tabs are these groups filtered. A
     * command hidden by {@link StoryCommandSpec.available} is therefore not listable, not starrable
     * from the list, and not shown as a stale favourite.
     */
    const sidebarGroups = useMemo(
        () => availableSidebarGroups(buildSpecSidebarGroups(pluginCommands, localize), commandContext),
        [commandContext, localize, pluginCommands],
    );

    /**
     * The documentation, by command id. Plugin actions have no spec and therefore no entry.
     *
     * Built in the command language, body and all — it is the reference FOR that language, and a page
     * whose signatures are English while the words describing them are Chinese reads as neither. The
     * panel's own chrome around it (search box, buttons, section headings) stays in the interface
     * language.
     */
    const manualById = useMemo(() => {
        const map = new Map<string, StoryCommandManualEntry>();
        for (const entry of buildStoryCommandManual(ct)) {
            map.set(entry.id, entry);
        }
        return map;
    }, [ct]);

    /** Every subject a spec reaches, so the detail can name the ones its own section does not. */
    const filedUnderById = useMemo(() => {
        const map = new Map<string, readonly StoryCommandGroupId[]>();
        for (const spec of listCommandSpecs()) {
            map.set(spec.id, specGroupIds(spec));
        }
        return map;
    }, []);

    /**
     * The starred tab is a flat set - a command filed under three subjects is still ONE favourite, so
     * it must not appear three times here.
     */
    const allStarredCommands = useMemo(
        () => activeTab === STARRED_CATEGORY_ID ? pickStarredCommands(sidebarGroups, starredIds) : [],
        [activeTab, sidebarGroups, starredIds],
    );
    const starredCommands = useMemo<PaletteActionCommand[]>(
        () => searchActionCommands(allStarredCommands, query, liveAbbreviations),
        [allStarredCommands, liveAbbreviations, query],
    );

    /**
     * Every other tab keeps the subject sections, each ranked by the matcher the `/` creator uses.
     *
     * With no subject chosen this is the whole vocabulary at once, so it collapses to one row per
     * command — the same rule, from the same function, the `/` browse uses. Choosing a subject brings
     * the full filing back: "everything I can do to an Image" has to list `/show`, and there it is not
     * a repeat, it is the answer.
     */
    const visibleGroups = useMemo<StoryCommandSidebarGroup[]>(() => {
        if (activeTab === STARRED_CATEGORY_ID) {
            return [];
        }
        const unfiltered = activeTab === ALL_CATEGORY_ID;
        const scoped = unfiltered
            ? dedupeToPrimarySubject(sidebarGroups)
            : filterSidebarGroups(sidebarGroups, activeTab);
        return scoped
            .map(entry => ({ ...entry, commands: searchActionCommands(entry.commands, query, liveAbbreviations) }))
            .filter(entry => entry.commands.length > 0);
    }, [activeTab, liveAbbreviations, query, sidebarGroups]);

    /**
     * Insert into the scene the author was in last, bringing it forward first. The manual stays open
     * while that scene is behind another editor, and a line put into a scene nobody can see reads as
     * a button that did nothing.
     */
    const { context } = useWorkspace();
    const createAction = useCallback((commandId: string) => {
        if (!payload?.tabId) {
            return;
        }
        context?.services.get<UIService>(Services.UI).editor.setActive(payload.tabId);
        dispatchStoryActionCreateRequest({ tabId: payload.tabId, commandId });
    }, [context, payload?.tabId]);

    const openCommand = manualById.get(openCommandId ?? "") ?? null;
    // A plugin action can be opened too; it just has nothing beyond its own label and detail.
    const openPlugin = openCommandId && !openCommand
        ? pluginCommands.find(command => command.id === openCommandId) ?? null
        : null;

    /**
     * What the sub-page's header says, read here rather than inside each detail body.
     *
     * A spec page and a plugin page carried their own title block before, which put a second header
     * under the back bar - two stacked bands saying one thing. One header, the shape every other
     * Studio sub-page uses, needs the subject at this level.
     */
    const openLabel = openCommand?.label ?? openPlugin?.label ?? "";
    const openGroup = getCommandGroup((openCommand?.group ?? openPlugin?.group ?? "utils") as StoryCommandGroupId);
    // The command's own glyph, like the row that opened this page; the group only tints it.
    const OpenIcon = (openCommand ? getCommandSpec(openCommand.id)?.icon : openPlugin?.icon) ?? openGroup.icon;

    /**
     * The sub-page takes focus when it opens, which is what makes Escape work and what keeps it from
     * firing for anyone else.
     *
     * Not `useEscapeToClose`: that listens on the document, and a writer pressing Escape to leave
     * text-edit in the scene beside this would lose the command they were reading. A `keydown` on the
     * layer only reaches a layer that holds focus. `tabIndex={-1}` is the half that makes that hold -
     * clicking a signature or an example inside the page is a click on nothing focusable, and focus
     * would otherwise fall to the body and take Escape with it.
     */
    const focusSubPage = useCallback((node: HTMLDivElement | null) => {
        node?.focus({ preventScroll: true });
    }, []);

    // While a command's page covers the list, the list is out of reach: the page is drawn over it, so
    // Tab walking on into rows nobody can see would be walking blind.
    const listCovered = Boolean(openCommandId && (openCommand || openPlugin));

    return (
        <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-surface">
            <div className="border-b border-edge bg-surface px-3 py-3" inert={listCovered}>
                <SearchBox
                    value={query}
                    onChange={setQuery}
                    placeholder={t("story.manual.searchPlaceholder")}
                    className="w-full"
                />
                {/* Wrapped, not a scroller: the strip used to overflow sideways and cut its last chip in
                    half, which reads as a rendering fault rather than as "there is more". */}
                <div className="mt-3 flex flex-wrap gap-1">
                    <CategoryChip
                        icon={Star}
                        iconColor={STARRED_ICON_COLOR}
                        label={t("story.actionCreator.starred")}
                        active={activeTab === STARRED_CATEGORY_ID}
                        onClick={() => setActiveTab(STARRED_CATEGORY_ID)}
                    />
                    <CategoryChip
                        icon={LayoutGrid}
                        iconColor="#a8adb5"
                        label={ct("story.actionCategory.all")}
                        active={activeTab === ALL_CATEGORY_ID}
                        onClick={() => setActiveTab(ALL_CATEGORY_ID)}
                    />
                    {STORY_COMMAND_CATEGORIES.map(category => (
                        <CategoryChip
                            key={category.id}
                            icon={category.icon}
                            iconColor={category.iconColor}
                            label={ct(commandCategoryLabelKey(category.id))}
                            active={activeTab === category.id}
                            onClick={() => setActiveTab(category.id)}
                        />
                    ))}
                </div>
            </div>

            <div className="nl-no-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2" inert={listCovered}>
                {starredCommands.length === 0 && visibleGroups.length === 0 ? (
                    <div className="rounded-md border border-edge bg-fill-subtle px-3 py-3 text-sm text-fg-subtle">
                        {/* An empty starred tab is not a search that missed: it says what the tab is for. */}
                        {activeTab === STARRED_CATEGORY_ID && allStarredCommands.length === 0
                            ? t("story.actionCreator.starredEmpty")
                            : t("story.manual.empty")}
                    </div>
                ) : null}
                {/* Starred: one flat bucket, so no subject header over it. */}
                <div className="grid grid-cols-1 gap-1">
                    {starredCommands.map(command => (
                        <ActionCreatorRow
                            key={command.id}
                            command={command}
                            group={getCommandGroup(command.group)}
                            signature={manualById.get(command.id)?.signature}
                            starred
                            onOpen={setOpenCommandId}
                            onCreate={createAction}
                            onToggleStarred={toggleStarred}
                        />
                    ))}
                </div>
                {visibleGroups.map(entry => {
                    const Icon = entry.group.icon;
                    return (
                        <div key={entry.group.id}>
                            <div className="flex items-center gap-1.5 px-1.5 pb-1 pt-2 text-2xs font-medium tracking-wide text-fg-subtle">
                                <Icon className="h-3 w-3 shrink-0" style={{ color: entry.group.iconColor }} />
                                <span>{ct(commandCategoryLabelKey(entry.group.id))}</span>
                            </div>
                            <div className="grid grid-cols-1 gap-1">
                                {entry.commands.map(command => (
                                    <ActionCreatorRow
                                        key={`${entry.group.id}:${command.id}`}
                                        command={command}
                                        group={entry.group}
                                        signature={manualById.get(command.id)?.signature}
                                        starred={starredIds.has(command.id)}
                                        onOpen={setOpenCommandId}
                                        onCreate={createAction}
                                        onToggleStarred={toggleStarred}
                                    />
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Reading a command is a sub-page over the list, the way the project panel opens one
                of its sections: the list stays mounted underneath, so backing out lands on the row
                you left rather than at the top of the catalogue. */}
            <AnimatePresence>
                {openCommandId && (openCommand || openPlugin) ? (
                    <motion.div
                        key={openCommandId}
                        ref={focusSubPage}
                        tabIndex={-1}
                        data-command-page=""
                        onKeyDown={event => {
                            if (event.key === "Escape") {
                                event.stopPropagation();
                                setOpenCommandId(null);
                            }
                        }}
                        // `.nl-opaque-surface`, not `bg-surface`: this slides over the list, which
                        // stays mounted underneath, so its fill has to survive the wallpaper rule
                        // that clears every base surface (see styles.css).
                        className="absolute inset-0 z-10 flex flex-col outline-none nl-opaque-surface shadow-[-8px_0_24px_rgba(0,0,0,0.35)]"
                        initial={{ x: "100%" }}
                        animate={{ x: 0 }}
                        exit={{ x: "100%" }}
                        transition={{ type: "tween", duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    >
                        {/* The back header every Studio sub-page wears: one row, arrow then subject. */}
                        <PanelHeader size="md" className="px-2">
                            <ToolbarButton
                                size="sm"
                                onClick={() => setOpenCommandId(null)}
                                data-tip={t("story.manual.back")}
                                aria-label={t("story.manual.back")}
                            >
                                <ArrowLeft className="h-4 w-4" />
                            </ToolbarButton>
                            <OpenIcon className="h-4 w-4 shrink-0" style={{ color: openGroup.iconColor }} />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium text-fg">{openLabel}</div>
                                <div className="truncate text-2xs text-fg-subtle">
                                    {ct(commandCategoryLabelKey(openGroup.id))}
                                </div>
                            </div>
                            <ToolbarButton
                                size="sm"
                                active={starredIds.has(openCommandId)}
                                className={starredIds.has(openCommandId) ? "text-warning" : undefined}
                                data-tip={starredIds.has(openCommandId) ? t("story.actionCreator.removeStarred") : t("story.actionCreator.addStarred")}
                                aria-label={starredIds.has(openCommandId) ? t("story.actionCreator.removeStarred") : t("story.actionCreator.addStarred")}
                                onClick={() => toggleStarred(openCommandId)}
                            >
                                <Star className="h-3.5 w-3.5" fill={starredIds.has(openCommandId) ? "currentColor" : "none"} />
                            </ToolbarButton>
                        </PanelHeader>
                        <div className="nl-no-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                            {openCommand ? (
                                <CommandDetail
                                    entry={openCommand}
                                    filedUnder={filedUnderById.get(openCommand.id) ?? []}
                                    abbreviations={abbreviations}
                                    onAddAbbreviation={word => addAbbreviation(word, openCommand.id)}
                                    onRemoveAbbreviation={removeAbbreviation}
                                    onInsert={() => createAction(openCommand.id)}
                                />
                            ) : openPlugin ? (
                                <PluginDetail command={openPlugin} onInsert={() => createAction(openPlugin.id)} />
                            ) : null}
                        </div>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}

function CategoryChip(props: {
    icon: typeof Star;
    iconColor: string;
    label: string;
    active: boolean;
    onClick: () => void;
}) {
    const Icon = props.icon;
    return (
        <button
            type="button"
            className={[
                "flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors",
                props.active
                    ? "border-primary/45 bg-primary/15 text-fg"
                    : "border-edge bg-fill-subtle text-fg-muted hover:bg-fill hover:text-fg",
            ].join(" ")}
            onClick={props.onClick}
        >
            <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: props.iconColor }} />
            <span>{props.label}</span>
        </button>
    );
}

/**
 * A browsing row. Clicking it *reads* the command; the hover `+` inserts it.
 *
 * The click used to insert, which made the list unbrowsable — you could not look at a command without
 * putting one in your scene. Insert stays one click away, on the row and again in the detail.
 *
 * The star beside it is the same control the detail header carries. It stays drawn on a starred row,
 * where it is also the mark that says so, and comes up on hover everywhere else.
 */
function ActionCreatorRow(props: {
    command: PaletteActionCommand;
    group: StoryCommandGroup;
    signature?: string;
    starred: boolean;
    onOpen: (commandId: string) => void;
    onCreate: (commandId: string) => void;
    onToggleStarred: (commandId: string) => void;
}) {
    const { t } = useTranslation();
    // The glyph is the COMMAND's, the colour is the SECTION's. `/show` listed under 图片 wears an eye
    // in the sage of that section - it says what the line does, tinted by what it does it to. (It used
    // to wear the section's own icon, which made every row of a section identical: eleven Music notes
    // down 声音, nine people down 角色.)
    const Icon = props.command.icon;
    return (
        <div className="group flex items-center rounded-md transition-colors hover:bg-fill">
            <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
                onClick={() => props.onOpen(props.command.id)}
            >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-edge bg-fill-subtle">
                    <Icon className="h-4 w-4" style={{ color: props.group.iconColor }} />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-baseline gap-1.5">
                        <span className="truncate text-sm text-fg">{props.command.label}</span>
                        {props.signature ? (
                            <span className="shrink-0 truncate font-mono text-2xs text-fg-subtle">{props.signature.split(" ")[0]}</span>
                        ) : null}
                    </span>
                    <span className="block truncate text-2xs text-fg-subtle">{props.command.detail}</span>
                </span>
            </button>
            <button
                type="button"
                className={cn(
                    "grid h-7 w-7 shrink-0 place-items-center rounded-md transition hover:bg-fill-strong focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50",
                    props.starred ? "text-warning" : "text-fg-subtle opacity-0 hover:text-warning group-hover:opacity-100",
                )}
                data-tip={props.starred ? t("story.actionCreator.removeStarred") : t("story.actionCreator.addStarred")}
                aria-label={props.starred ? t("story.actionCreator.removeStarred") : t("story.actionCreator.addStarred")}
                aria-pressed={props.starred}
                onClick={() => props.onToggleStarred(props.command.id)}
            >
                <Star className="h-3.5 w-3.5" fill={props.starred ? "currentColor" : "none"} />
            </button>
            <button
                type="button"
                className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-fg-subtle opacity-0 transition hover:bg-fill-strong hover:text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50 group-hover:opacity-100"
                data-tip={t("story.manual.insert")}
                aria-label={t("story.manual.insert")}
                onClick={() => props.onCreate(props.command.id)}
            >
                <Plus className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}

/**
 * A command's page: what it is, what it takes, and lines that work.
 *
 * Its subject line lives in the sub-page header, not here - this is the body under it. The blocks
 * are `SectionCard`s rather than a bordered box per parameter and per example: eight of those down
 * a 318px panel is eight frames drawn around one list, which is the shape the panel was called out
 * for. One frame, hairlines inside.
 */
function CommandDetail(props: {
    entry: StoryCommandManualEntry;
    filedUnder: readonly StoryCommandGroupId[];
    abbreviations: StoryCommandAbbreviations;
    onAddAbbreviation: (word: string) => void;
    onRemoveAbbreviation: (word: string) => void;
    onInsert: () => void;
}) {
    const { t } = useTranslation();
    const { t: ct } = useCommandTranslation();
    const { entry } = props;
    // Only the subjects this command's own section does not already say.
    const alsoFiledUnder = props.filedUnder.filter(id => id !== entry.group);

    return (
        <div className="flex flex-col gap-3 px-3 py-3">
            <code className="block break-words rounded-md border border-edge bg-surface-sunken px-2.5 py-2 font-mono text-sm text-fg">
                {entry.signature}
            </code>
            <p className="text-xs leading-relaxed text-fg-muted">{entry.detail}</p>
            {entry.aliases.length > 0 ? (
                <p className="text-2xs text-fg-subtle">
                    {t("story.manual.aliases")}
                    {": "}
                    <span className="font-mono">{entry.aliases.join("  ")}</span>
                </p>
            ) : null}
            <CommandAbbreviations
                commandId={entry.id}
                abbreviations={props.abbreviations}
                onAdd={props.onAddAbbreviation}
                onRemove={props.onRemoveAbbreviation}
            />
            {alsoFiledUnder.length > 0 ? (
                <p className="text-2xs text-fg-subtle">
                    {t("story.manual.appliesTo")}
                    {": "}
                    {alsoFiledUnder.map(id => ct(commandCategoryLabelKey(id))).join(" · ")}
                </p>
            ) : null}

            <Button variant="secondary" size="sm" fullWidth className="text-xs" onClick={props.onInsert}>
                <CornerDownLeft className="h-3.5 w-3.5" />
                <span>{t("story.manual.insert")}</span>
            </Button>

            <SectionCard title={t("story.manual.parameters")} bodyClassName="p-0">
                {entry.params.length === 0 ? (
                    <p className="px-2.5 py-2 text-xs text-fg-subtle">{t("story.manual.noParameters")}</p>
                ) : (
                    <ul className="divide-y divide-edge-subtle">
                        {entry.params.map(param => <ParamRow key={param.name} param={param} />)}
                    </ul>
                )}
            </SectionCard>

            {entry.examples.length > 0 ? (
                <SectionCard title={t("story.manual.examples")} bodyClassName="p-0">
                    <ul className="divide-y divide-edge-subtle">
                        {entry.examples.map(example => (
                            <li key={example} className="break-words px-2.5 py-1.5 font-mono text-2xs text-fg-muted">
                                {example}
                            </li>
                        ))}
                    </ul>
                </SectionCard>
            ) : null}
        </div>
    );
}

/**
 * The author's own abbreviations for this command, edited in place under the spellings the command
 * already has.
 *
 * This is the only place they are set. It sits under "Also written" on purpose: both lines answer
 * "what else can I type for this command", one with the words Studio gives it and one with the words
 * the author gave it, and keeping them apart is what lets an author tell the two kinds apart.
 *
 * A word a built-in command has since taken (a later version can add spellings) is kept and drawn as
 * such, with what took it, rather than silently dropped: it no longer expands, and this is where the
 * author would look to find out why.
 */
function CommandAbbreviations(props: {
    commandId: string;
    abbreviations: StoryCommandAbbreviations;
    onAdd: (word: string) => void;
    onRemove: (word: string) => void;
}) {
    const { t } = useTranslation();
    const words = abbreviationsOf(props.commandId, props.abbreviations);
    /** The word being typed, or `null` while the field is closed. */
    const [draft, setDraft] = useState<string | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const addRef = useRef<HTMLButtonElement>(null);

    const close = (refocus: boolean) => {
        setDraft(null);
        setProblem(null);
        // Back to the `+` rather than to nothing: focus on the body would take the page's Escape with it.
        if (refocus) {
            window.requestAnimationFrame(() => addRef.current?.focus());
        }
    };
    const submit = (refocus: boolean) => {
        const word = draft ?? "";
        if (!word.trim()) {
            close(refocus);
            return;
        }
        const check = checkAbbreviation(word, props.commandId, props.abbreviations);
        if (!check.ok) {
            setProblem(abbreviationProblem(check, t));
            return;
        }
        props.onAdd(check.word);
        close(refocus);
    };

    return (
        <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-1 text-2xs text-fg-subtle">
                <span>
                    {t("story.manual.abbreviations")}
                    {": "}
                </span>
                {words.map(word => {
                    const owner = getCommandDef(word);
                    const shadowed = owner !== null && owner.commandId !== props.commandId;
                    return (
                        <Badge
                            key={word}
                            tone={shadowed ? "warning" : "neutral"}
                            className="font-mono"
                            data-tip={shadowed ? t("story.manual.abbreviationShadowed", { command: localizedCommandToken(owner) }) : undefined}
                        >
                            <span className={shadowed ? "line-through" : undefined}>{word}</span>
                            <button
                                type="button"
                                className="grid place-items-center rounded-sm text-fg-subtle transition-colors hover:text-fg"
                                data-tip={t("story.manual.removeAbbreviation", { word })}
                                aria-label={t("story.manual.removeAbbreviation", { word })}
                                onClick={() => props.onRemove(word)}
                            >
                                <X className="h-3 w-3" />
                            </button>
                        </Badge>
                    );
                })}
                {draft === null ? (
                    <ToolbarButton
                        ref={addRef}
                        size="xs"
                        data-tip={t("story.manual.addAbbreviation")}
                        aria-label={t("story.manual.addAbbreviation")}
                        onClick={() => setDraft("")}
                    >
                        <Plus className="h-3 w-3" />
                    </ToolbarButton>
                ) : (
                    <Input
                        size="sm"
                        autoFocus
                        value={draft}
                        variant={problem ? "error" : "default"}
                        className="w-28 font-mono text-xs"
                        placeholder={t("story.manual.abbreviationPlaceholder")}
                        aria-label={t("story.manual.addAbbreviation")}
                        onChange={event => {
                            setDraft(event.target.value);
                            setProblem(null);
                        }}
                        onKeyDown={event => {
                            if (event.key === "Enter") {
                                event.preventDefault();
                                submit(true);
                            } else if (event.key === "Escape") {
                                // The page closes on Escape; this one only closes the field.
                                event.preventDefault();
                                event.stopPropagation();
                                close(true);
                            }
                        }}
                        onBlur={() => submit(false)}
                    />
                )}
            </div>
            {problem ? <p className="text-2xs text-danger">{problem}</p> : null}
        </div>
    );
}

/** What is wrong with a word that cannot become an abbreviation, said in the interface language. */
function abbreviationProblem(check: Extract<AbbreviationCheck, { ok: false }>, t: ReturnType<typeof useTranslation>["t"]): string | null {
    switch (check.reason) {
        case "empty":
            return null;
        case "space":
            return t("story.manual.abbreviationSpace");
        case "character":
            return t("story.manual.abbreviationCharacter");
        case "builtIn":
            return t("story.manual.abbreviationBuiltIn", { command: localizedCommandToken(check.def) });
        case "taken":
            return t("story.manual.abbreviationTaken", { command: localizedCommandToken(check.def) });
    }
}

function ParamRow({ param }: { param: StoryCommandManualParam }) {
    const { t } = useTranslation();
    return (
        <li className="px-2.5 py-2">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <code className="font-mono text-xs text-fg">{param.slot}</code>
                <span className="text-2xs text-fg-muted">{param.hint}</span>
                <span className={cn("ml-auto shrink-0 text-2xs", param.required ? "text-warning" : "text-fg-subtle")}>
                    {param.required ? t("story.manual.required") : t("story.manual.optional")}
                </span>
            </div>
            <div className="mt-0.5 text-2xs text-fg-subtle">{param.accepts}</div>
            {param.aliases.length > 0 ? (
                <div className="mt-0.5 text-2xs text-fg-subtle">
                    {t("story.manual.aliases")}
                    {": "}
                    <span className="font-mono">{param.aliases.join(", ")}</span>
                </div>
            ) : null}
            {param.greedy ? <div className="mt-0.5 text-2xs text-fg-subtle">{t("story.manual.greedy")}</div> : null}
        </li>
    );
}

/** A plugin action has no spec, so its page is what its registration provided, plus the insert. */
function PluginDetail({ command, onInsert }: { command: PaletteActionCommand; onInsert: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="flex flex-col gap-3 px-3 py-3">
            <p className="text-xs leading-relaxed text-fg-muted">{command.detail}</p>
            <Button variant="secondary" size="sm" fullWidth className="text-xs" onClick={onInsert}>
                <CornerDownLeft className="h-3.5 w-3.5" />
                <span>{t("story.manual.insert")}</span>
            </Button>
        </div>
    );
}
