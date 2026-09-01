/**
 * The Menu Bar side panel: the whole authoring surface for the shipped game's menu.
 *
 * The panel is read top to bottom as one thing: the bar as the player will read it, the menus and
 * their rows underneath in that same order, and - only when a row is selected - what that row says
 * and does. Everything the author can do is named in words.
 *
 * The first version was three competing blocks with two ways to add a row and three unlabelled icon
 * buttons floating between them, and it was not readable even to someone who knew what it was for.
 * What that cost, and what replaced it:
 *
 *  - **A row said nothing about itself.** The tree was a column of names, so knowing what "Settings"
 *    did meant selecting it and reading the editor. Every row now carries what it does beside it, in
 *    the same words the action picker uses.
 *  - **The editor floated free of its subject.** It now opens with the row it is editing, named and
 *    typed ("Row - Settings"), and the reorder and delete controls sit in that heading rather than
 *    hovering above the fields.
 *  - **Two ways to add a row, neither explained.** One now: "Add row" opens a short menu naming the
 *    four kinds. The four kinds are a fact about menus, so a menu is where they belong.
 *
 * Two things that have not changed and should not: order is buttons rather than dragging (a menu is
 * a short ordered list, and a drag inside a panel this narrow misses more often than it lands), and
 * unfinished rows stay visible and marked - that is what a row looks like halfway through being
 * built, and the player never sees one (see `toGameMenuSpec`).
 *
 * Comments in English per project convention.
 */

import { useEffect, useMemo, useState } from "react";
import {
    ChevronDown,
    ChevronUp,
    CornerDownRight,
    List,
    Minus,
    Plus,
    Trash2,
} from "lucide-react";
import { ui, type PluginApp, type PluginTranslator } from "narraleaf-studio/plugin";
import type { GameMenuAction, GameMenuDynamicSource } from "@shared/types/gameMenu";
import {
    MENU_BAR_ITEM_KINDS,
    isMenuBarItemComplete,
    type MenuBarItem,
    type MenuBarItemKind,
    type MenuBarLabel,
    type MenuBarMenu,
} from "./document";
import { useMenuBarTranslator } from "./messages";
import { samePath, type MenuBarPath, type MenuBarStore } from "./store";

type SurfaceEntry = { id: string; name: string };
type FnEntry = { fnRef: string; name: string; params: { pinId: string; name: string; valueType: string }[] };

/** Every action the author can pick, in the order the picker lists them. */
const ACTION_OPTIONS: { type: GameMenuAction["type"]; messageKey: string; skipValue?: boolean }[] = [
    { type: "openPage", messageKey: "actionOpenPage" },
    { type: "openLayer", messageKey: "actionOpenLayer" },
    { type: "quitToPage", messageKey: "actionQuitToPage" },
    { type: "quitApp", messageKey: "actionQuitApp" },
    { type: "next", messageKey: "actionNext" },
    { type: "toggleAutoForward", messageKey: "actionToggleAutoForward" },
    { type: "toggleSkipping", messageKey: "actionToggleSkipping" },
    { type: "setSkipReadText", messageKey: "actionSetSkipReadText", skipValue: true },
    { type: "setSkipReadText", messageKey: "actionSetSkipAllText", skipValue: false },
    { type: "toggleDialog", messageKey: "actionToggleDialog" },
    { type: "historyUndo", messageKey: "actionHistoryUndo" },
    { type: "historyRedo", messageKey: "actionHistoryRedo" },
    { type: "toggleFullscreen", messageKey: "actionToggleFullscreen" },
    { type: "fn", messageKey: "actionFn" },
];

const DYNAMIC_SOURCES: { source: GameMenuDynamicSource; messageKey: string }[] = [
    { source: "textLanguage", messageKey: "sourceTextLanguage" },
    { source: "voiceLanguage", messageKey: "sourceVoiceLanguage" },
    { source: "windowScale", messageKey: "sourceWindowScale" },
];

const KIND_MESSAGE_KEY: Record<MenuBarItemKind, string> = {
    action: "kindAction",
    dynamic: "kindDynamic",
    submenu: "kindSubmenu",
    separator: "kindSeparator",
};

/** One picker value per row of {@link ACTION_OPTIONS}, so the two skip rows stay distinguishable. */
function actionOptionValue(option: { type: string; skipValue?: boolean }): string {
    return option.skipValue === undefined ? option.type : `${option.type}:${String(option.skipValue)}`;
}

function currentActionValue(action: GameMenuAction): string {
    return action.type === "setSkipReadText" ? `setSkipReadText:${String(action.value)}` : action.type;
}

function actionFromValue(value: string): GameMenuAction {
    const [type, flag] = value.split(":");
    switch (type) {
        case "openPage":
            return { type: "openPage", surfaceId: "" };
        case "openLayer":
            return { type: "openLayer", surfaceId: "", modal: true, dismissible: true, group: null };
        case "quitToPage":
            return { type: "quitToPage", surfaceId: "" };
        case "setSkipReadText":
            return { type: "setSkipReadText", value: flag === "true" };
        case "fn":
            return { type: "fn", fnRef: "", args: {} };
        default:
            return { type: type as Exclude<GameMenuAction["type"], "openPage" | "openLayer" | "quitToPage" | "setSkipReadText" | "fn"> };
    }
}

function actionMessageKey(action: GameMenuAction): string {
    const value = currentActionValue(action);
    return ACTION_OPTIONS.find(option => actionOptionValue(option) === value)?.messageKey ?? "kindAction";
}

/**
 * What a row does, in one line, for the tree.
 *
 * The same words the picker uses, so reading the tree and opening the picker never disagree. A
 * target that has not been chosen yet says so rather than being left blank - blank reads as "does
 * nothing", and this row does not exist for the player at all.
 */
function describeItem(
    item: MenuBarItem,
    tr: PluginTranslator,
    surfaces: SurfaceEntry[],
    fns: FnEntry[],
): string {
    if (item.kind === "separator") {
        return tr.t("kindSeparator");
    }
    if (item.kind === "dynamic") {
        return tr.t("sourceHintShort");
    }
    if (item.kind === "submenu") {
        return tr.t("submenuCount", { count: item.items.length });
    }
    const action = item.action;
    const name = tr.t(actionMessageKey(action));
    if (action.type === "openPage" || action.type === "openLayer" || action.type === "quitToPage") {
        const surface = surfaces.find(entry => entry.id === action.surfaceId);
        return `${name} · ${surface?.name ?? tr.t("notChosen")}`;
    }
    if (action.type === "fn") {
        const fn = fns.find(entry => entry.fnRef === action.fnRef);
        return `${name} · ${fn?.name ?? tr.t("notChosen")}`;
    }
    return name;
}

/** What the row is called in the tree and in the editor's heading. */
function itemTitle(item: MenuBarItem, tr: PluginTranslator): string {
    if (item.kind === "separator") {
        return tr.t("kindSeparator");
    }
    if (item.kind === "dynamic") {
        return tr.t(DYNAMIC_SOURCES.find(entry => entry.source === item.source)?.messageKey ?? "kindDynamic");
    }
    return item.label.text || tr.t("unnamed");
}

function itemKindIcon(kind: MenuBarItemKind) {
    if (kind === "separator") {
        return <Minus size={11} />;
    }
    if (kind === "dynamic") {
        return <List size={11} />;
    }
    if (kind === "submenu") {
        return <CornerDownRight size={11} />;
    }
    return null;
}

export function MenuBarPanel({ app, store }: { app: PluginApp; store: MenuBarStore }) {
    const tr = useMenuBarTranslator(app);
    const [data, setData] = useState(() => store.getData());
    const [selected, setSelected] = useState<MenuBarPath | null>(null);
    const frozen = app.services.workspace.frozen;

    useEffect(() => store.subscribe(() => setData({ ...store.getData() })), [store]);

    const surfaces = useMemo(() => app.services.interface.listSurfaces(), [app]);
    const fns = useMemo(() => app.services.interface.listGlobalFns(), [app]);
    const keys = useMemo(() => app.services.localization.listKeys(), [app]);

    return (
        <ui.Panel.Root>
            <ui.Panel.Header title={tr.t("title")} description={tr.t("subtitle")}>
                {/*
                  * The bar as the player reads it, in one line.
                  *
                  * Part of the heading rather than a block of its own: it is not something to edit,
                  * it is what the list below adds up to - which is the one thing a column of
                  * indented names cannot show on its own.
                  */}
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-edge bg-fill-subtle px-2 py-1">
                    {data.enabled && data.menus.length > 0
                        ? data.menus.map(menu => (
                            <span key={menu.id} className="text-2xs text-fg">
                                {menu.label.text || tr.t("unnamed")}
                            </span>
                        ))
                        : <span className="text-2xs text-fg-subtle">{tr.t("previewEmpty")}</span>}
                </div>
            </ui.Panel.Header>

            <ui.Panel.Toolbar>
                <ui.Switch
                    checked={data.enabled}
                    disabled={frozen}
                    onCheckedChange={checked => void store.setEnabled(checked)}
                    aria-label={tr.t("enabled")}
                />
                <span className="text-xs text-fg-muted">{tr.t("enabled")}</span>
            </ui.Panel.Toolbar>

            <div className="min-h-0 flex-1 overflow-y-auto">
                {data.menus.length === 0
                    ? <ui.Panel.EmptyState title={tr.t("empty")} description={tr.t("emptyHint")} />
                    : (
                        <div className="space-y-2">
                            {data.menus.map(menu => (
                                <MenuCard
                                    key={menu.id}
                                    menu={menu}
                                    tr={tr}
                                    store={store}
                                    frozen={frozen}
                                    surfaces={surfaces}
                                    fns={fns}
                                    selected={selected}
                                    onSelect={setSelected}
                                />
                            ))}
                        </div>
                    )}

                <div className="pt-2">
                    <ui.Button
                        size="sm"
                        variant="ghost"
                        disabled={frozen}
                        onClick={() => setSelected(store.addMenu(tr.t("newMenu")))}
                    >
                        <Plus size={13} />
                        {tr.t("addMenu")}
                    </ui.Button>
                </div>

                {selected && (
                    <Editor
                        store={store}
                        tr={tr}
                        path={selected}
                        frozen={frozen}
                        surfaces={surfaces}
                        fns={fns}
                        keys={keys}
                        onRemoved={() => setSelected(null)}
                    />
                )}
            </div>
        </ui.Panel.Root>
    );
}

function MenuCard({
    menu,
    tr,
    store,
    frozen,
    surfaces,
    fns,
    selected,
    onSelect,
}: {
    menu: MenuBarMenu;
    tr: PluginTranslator;
    store: MenuBarStore;
    frozen: boolean;
    surfaces: SurfaceEntry[];
    fns: FnEntry[];
    selected: MenuBarPath | null;
    onSelect: (path: MenuBarPath) => void;
}) {
    return (
        <div className="rounded border border-edge">
            <TreeRow
                depth={0}
                title={menu.label.text || tr.t("unnamed")}
                detail={tr.t("menuRowDetail", { count: menu.items.length })}
                complete
                selected={samePath(selected, [menu.id])}
                onSelect={() => onSelect([menu.id])}
            />
            <div className="pb-1">
                {menu.items.map(item => (
                    <ItemRows
                        key={item.id}
                        item={item}
                        path={[menu.id, item.id]}
                        depth={1}
                        tr={tr}
                        store={store}
                        frozen={frozen}
                        surfaces={surfaces}
                        fns={fns}
                        selected={selected}
                        onSelect={onSelect}
                    />
                ))}
                <AddRowButton
                    tr={tr}
                    store={store}
                    frozen={frozen}
                    path={[menu.id]}
                    depth={1}
                    onAdded={onSelect}
                />
            </div>
        </div>
    );
}

/**
 * The one way to add a row, and the one place the four kinds are named.
 *
 * A menu rather than four buttons: the kinds are a short closed list an author reads once, and four
 * buttons repeated under every menu turned the tree into a wall of controls.
 */
function AddRowButton({
    tr,
    store,
    frozen,
    path,
    depth,
    onAdded,
}: {
    tr: PluginTranslator;
    store: MenuBarStore;
    frozen: boolean;
    path: MenuBarPath;
    depth: number;
    onAdded: (path: MenuBarPath) => void;
}) {
    const { menuState, showMenu, hideMenu } = ui.useContextMenu();
    return (
        <>
            <div style={{ paddingLeft: `${8 + depth * 14}px` }} className="pt-1">
                <ui.Button size="sm" variant="ghost" disabled={frozen} onClick={showMenu}>
                    <Plus size={12} />
                    {tr.t("addItem")}
                </ui.Button>
            </div>
            <ui.ContextMenu
                visible={menuState.visible}
                position={menuState.position}
                onClose={hideMenu}
                iconsEnabled
                items={MENU_BAR_ITEM_KINDS.map(kind => ({
                    id: kind,
                    label: tr.t(KIND_MESSAGE_KEY[kind]),
                    tooltip: tr.t(`${KIND_MESSAGE_KEY[kind]}Hint`),
                    icon: itemKindIcon(kind),
                    onClick: () => {
                        hideMenu();
                        onAdded(store.addItem(
                            path,
                            kind,
                            kind === "submenu" ? tr.t("newSubmenu") : tr.t("newItem"),
                        ));
                    },
                }))}
            />
        </>
    );
}

function TreeRow({
    depth,
    title,
    detail,
    icon,
    complete,
    selected,
    onSelect,
}: {
    depth: number;
    title: string;
    detail?: string;
    icon?: React.ReactNode;
    complete: boolean;
    selected: boolean;
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onSelect}
            className={[
                "flex w-full min-w-0 items-baseline gap-2 py-1 pr-2 text-left",
                selected ? "bg-fill text-fg" : "text-fg-muted hover:bg-fill-subtle",
                depth === 0 ? "font-semibold" : "",
            ].join(" ")}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
        >
            {/* A fixed slot either way, so titles line up whether or not the row has an icon. */}
            <span className="w-3 shrink-0 self-center text-fg-subtle">{icon}</span>
            <span className={["min-w-0 shrink truncate text-2xs", complete ? "" : "italic"].join(" ")}>
                {title}
            </span>
            {detail && (
                <span className="ml-auto shrink-0 truncate text-2xs text-fg-subtle">{detail}</span>
            )}
        </button>
    );
}

function ItemRows({
    item,
    path,
    depth,
    tr,
    store,
    frozen,
    surfaces,
    fns,
    selected,
    onSelect,
}: {
    item: MenuBarItem;
    path: MenuBarPath;
    depth: number;
    tr: PluginTranslator;
    store: MenuBarStore;
    frozen: boolean;
    surfaces: SurfaceEntry[];
    fns: FnEntry[];
    selected: MenuBarPath | null;
    onSelect: (path: MenuBarPath) => void;
}) {
    return (
        <>
            <TreeRow
                depth={depth}
                title={itemTitle(item, tr)}
                detail={describeItem(item, tr, surfaces, fns)}
                icon={itemKindIcon(item.kind)}
                complete={isMenuBarItemComplete(item)}
                selected={samePath(selected, path)}
                onSelect={() => onSelect(path)}
            />
            {item.kind === "submenu" && (
                <>
                    {item.items.map(child => (
                        <ItemRows
                            key={child.id}
                            item={child}
                            path={[...path, child.id]}
                            depth={depth + 1}
                            tr={tr}
                            store={store}
                            frozen={frozen}
                            surfaces={surfaces}
                            fns={fns}
                            selected={selected}
                            onSelect={onSelect}
                        />
                    ))}
                    <AddRowButton
                        tr={tr}
                        store={store}
                        frozen={frozen}
                        path={path}
                        depth={depth + 1}
                        onAdded={onSelect}
                    />
                </>
            )}
        </>
    );
}

/**
 * What the selected row says and does.
 *
 * Opens by naming its subject, because it sits below a tree and nothing else would say which row
 * these fields belong to. Reorder and delete live in that heading for the same reason: they act on
 * the named row, and they used to float above the fields naming nothing.
 */
function Editor({
    store,
    tr,
    path,
    frozen,
    surfaces,
    fns,
    keys,
    onRemoved,
}: {
    store: MenuBarStore;
    tr: PluginTranslator;
    path: MenuBarPath;
    frozen: boolean;
    surfaces: SurfaceEntry[];
    fns: FnEntry[];
    keys: { name: string; sourceText: string }[];
    onRemoved: () => void;
}) {
    const node = store.find(path);
    if (!node) {
        return null;
    }
    const isMenu = path.length === 1;
    const item = !isMenu && "kind" in node ? node : null;
    const label: MenuBarLabel | null = isMenu || (item && item.kind !== "separator" && item.kind !== "dynamic")
        ? (node as { label: MenuBarLabel }).label
        : null;
    const heading = isMenu
        ? tr.t("editingMenu", { name: (node as MenuBarMenu).label.text || tr.t("unnamed") })
        : tr.t("editingItem", {
            kind: tr.t(KIND_MESSAGE_KEY[item!.kind]),
            name: itemTitle(item!, tr),
        });

    return (
        <div className="mt-3 rounded border border-edge">
            <div className="flex items-center justify-between gap-2 rounded-t border-b border-edge bg-fill-subtle px-2 py-1.5">
                <span className="min-w-0 truncate text-2xs font-semibold text-fg">{heading}</span>
                <div className="flex shrink-0 items-center gap-1">
                    <ui.IconButton
                        size="sm"
                        variant="ghost"
                        aria-label={tr.t("moveUp")}
                        title={tr.t("moveUp")}
                        disabled={frozen}
                        onClick={() => store.move(path, -1)}
                    >
                        <ChevronUp size={13} />
                    </ui.IconButton>
                    <ui.IconButton
                        size="sm"
                        variant="ghost"
                        aria-label={tr.t("moveDown")}
                        title={tr.t("moveDown")}
                        disabled={frozen}
                        onClick={() => store.move(path, 1)}
                    >
                        <ChevronDown size={13} />
                    </ui.IconButton>
                    <ui.IconButton
                        size="sm"
                        variant="ghost"
                        aria-label={tr.t("remove")}
                        title={tr.t("remove")}
                        disabled={frozen}
                        onClick={() => {
                            store.remove(path);
                            onRemoved();
                        }}
                    >
                        <Trash2 size={13} />
                    </ui.IconButton>
                </div>
            </div>

            <div className="px-2 pb-2">
                {label && (
                    <>
                        <ui.Panel.Row
                            label={tr.t("labelText")}
                            control={(
                                <ui.Input
                                    size="sm"
                                    className="w-44"
                                    value={label.text}
                                    disabled={frozen}
                                    onChange={event => store.setLabel(path, { ...label, text: event.target.value })}
                                />
                            )}
                        />
                        <ui.Panel.Row
                            label={tr.t("labelKey")}
                            control={(
                                <ui.Select
                                    size="sm"
                                    value={label.key ?? ""}
                                    disabled={frozen}
                                    placeholder={keys.length === 0 ? tr.t("noKeys") : tr.t("labelKeyNone")}
                                    options={[
                                        { value: "", label: tr.t("labelKeyNone") },
                                        ...keys.map(key => ({
                                            value: key.name,
                                            label: key.name,
                                            secondaryLabel: key.sourceText,
                                        })),
                                    ]}
                                    onChange={value => store.setLabel(path, { ...label, key: String(value) || null })}
                                />
                            )}
                        />
                        {/*
                          * Under the row rather than beside its label: `Panel.Row` gives the text
                          * column whatever the control leaves, and a sentence in a third of a panel
                          * this narrow wraps into a stack of two-word lines.
                          */}
                        <div className="pb-1 text-2xs leading-relaxed text-fg-subtle">
                            {tr.t("labelKeyHint")}
                        </div>
                    </>
                )}

                {item?.kind === "action" && (
                    <ActionEditor
                        action={item.action}
                        tr={tr}
                        frozen={frozen}
                        surfaces={surfaces}
                        fns={fns}
                        onChange={action => store.setAction(path, action)}
                    />
                )}

                {item?.kind === "dynamic" && (
                    <ui.Panel.Row
                        label={tr.t("source")}
                        description={tr.t("sourceHint")}
                        control={(
                            <ui.Select
                                size="sm"
                                value={item.source}
                                disabled={frozen}
                                options={DYNAMIC_SOURCES.map(entry => ({
                                    value: entry.source,
                                    label: tr.t(entry.messageKey),
                                }))}
                                onChange={value => store.setSource(path, value as GameMenuDynamicSource)}
                            />
                        )}
                    />
                )}

                {item?.kind === "separator" && (
                    <div className="py-1 text-2xs text-fg-subtle">{tr.t("kindSeparatorHint")}</div>
                )}

                {item && !isMenuBarItemComplete(item) && (
                    <div className="pt-1 text-2xs text-warning">{tr.t("incomplete")}</div>
                )}
                {frozen && <div className="pt-1 text-2xs text-fg-subtle">{tr.t("frozen")}</div>}
            </div>
        </div>
    );
}

function ActionEditor({
    action,
    tr,
    frozen,
    surfaces,
    fns,
    onChange,
}: {
    action: GameMenuAction;
    tr: PluginTranslator;
    frozen: boolean;
    surfaces: SurfaceEntry[];
    fns: FnEntry[];
    onChange: (action: GameMenuAction) => void;
}) {
    const needsSurface = action.type === "openPage" || action.type === "openLayer" || action.type === "quitToPage";
    const fn = action.type === "fn" ? fns.find(entry => entry.fnRef === action.fnRef) : undefined;
    return (
        <>
            <ui.Panel.Row
                label={tr.t("action")}
                control={(
                    <ui.Select
                        size="sm"
                        value={currentActionValue(action)}
                        disabled={frozen}
                        options={ACTION_OPTIONS.map(option => ({
                            value: actionOptionValue(option),
                            label: tr.t(option.messageKey),
                        }))}
                        onChange={value => onChange(actionFromValue(String(value)))}
                    />
                )}
            />
            {needsSurface && (
                <ui.Panel.Row
                    label={tr.t("page")}
                    control={(
                        <ui.Select
                            size="sm"
                            value={action.surfaceId}
                            disabled={frozen}
                            placeholder={tr.t("pageNone")}
                            options={surfaces.map(surface => ({ value: surface.id, label: surface.name }))}
                            onChange={value => onChange({ ...action, surfaceId: String(value) })}
                        />
                    )}
                />
            )}
            {action.type === "openLayer" && (
                <>
                    <ui.Panel.Row
                        label={tr.t("modal")}
                        control={(
                            <ui.Switch
                                checked={action.modal === true}
                                disabled={frozen}
                                onCheckedChange={checked => onChange({ ...action, modal: checked })}
                                aria-label={tr.t("modal")}
                            />
                        )}
                    />
                    <ui.Panel.Row
                        label={tr.t("dismissible")}
                        control={(
                            <ui.Switch
                                checked={action.dismissible !== false}
                                disabled={frozen}
                                onCheckedChange={checked => onChange({ ...action, dismissible: checked })}
                                aria-label={tr.t("dismissible")}
                            />
                        )}
                    />
                </>
            )}
            {action.type === "fn" && (
                <>
                    <ui.Panel.Row
                        label={tr.t("fn")}
                        description={fns.length === 0 ? tr.t("fnEmpty") : tr.t("fnHint")}
                        control={(
                            <ui.Select
                                size="sm"
                                value={action.fnRef}
                                disabled={frozen || fns.length === 0}
                                placeholder={tr.t("fnNone")}
                                options={fns.map(entry => ({ value: entry.fnRef, label: entry.name }))}
                                // The arguments belong to the function that was chosen, so switching
                                // function drops them rather than carrying pin ids the new head has
                                // never heard of.
                                onChange={value => onChange({ type: "fn", fnRef: String(value), args: {} })}
                            />
                        )}
                    />
                    {fn && fn.params.length > 0 && (
                        <div className="pl-2">
                            <div className="pt-1 text-2xs text-fg-muted">{tr.t("fnArgs")}</div>
                            {fn.params.map(param => (
                                <ui.Panel.Row
                                    key={param.pinId}
                                    label={param.name}
                                    description={param.valueType}
                                    control={(
                                        <ui.Input
                                            size="sm"
                                            className="w-32"
                                            value={String(action.args?.[param.pinId] ?? "")}
                                            disabled={frozen}
                                            onChange={event => onChange({
                                                ...action,
                                                args: {
                                                    ...action.args,
                                                    [param.pinId]: coerceArg(event.target.value, param.valueType),
                                                },
                                            })}
                                        />
                                    )}
                                />
                            ))}
                        </div>
                    )}
                </>
            )}
        </>
    );
}

/**
 * Type the author's typing to the pin that will receive it.
 *
 * Text is what a panel can offer for every pin type, and a function that declared an integer
 * parameter has to be handed a number - a string "3" reaching an arithmetic node is the kind of
 * failure that shows up as a wrong answer rather than an error. Anything unparseable stays the
 * string it was typed as, which is what the author sees in the box.
 */
function coerceArg(raw: string, valueType: string): unknown {
    if (valueType === "boolean") {
        return raw.trim().toLowerCase() === "true";
    }
    if (valueType === "integer" || valueType === "float") {
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : raw;
    }
    return raw;
}
