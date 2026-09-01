/**
 * The Menu Bar side panel.
 *
 * One list, read top to bottom: the bar as the player will see it, then the menus, then the rows
 * inside the menu that is open, then the fields of the row that is open. Opening a menu and opening
 * a row are the same gesture, order is a drag, and nothing is edited anywhere except inside the row
 * it belongs to - so there is one place to look at any moment.
 *
 * Four things this shape answers, each of which an earlier layout got wrong:
 *
 *  - **Levels have to be visible.** A column of indented names cannot show what the levels add up
 *    to, so the bar is drawn at the top as the player sees it - light chrome, the open menu's rows
 *    dropped underneath - and the accordion below mirrors it exactly.
 *  - **A row has to say what it does.** Each carries its action beside it, in the same words the
 *    action picker uses.
 *  - **One way to do each thing.** One "add row" naming the four kinds, drag for order, delete
 *    inside the row. No second path and no floating icon buttons.
 *  - **One thing open at a time.** Both accordions are single-open, which is what keeps the panel
 *    short enough to read at this width.
 *
 * Drag follows the model the rest of the app uses: a list of n rows has n+1 gaps, a drop is one gap
 * index, one line is drawn at a time, and a row dropped back where it started writes nothing. The
 * dragged path is held in a ref because a native drag runs a nested message loop - state set in
 * `dragstart` is not visible to the `dragover` that has to accept the drop - and every row carries
 * `nl-drag-source`, without which `draggable` is inert in this app.
 *
 * Comments in English per project convention.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownRight, List, Minus, Plus, Trash2 } from "lucide-react";
import { ui, type PluginApp, type PluginTranslator } from "narraleaf-studio/plugin";
import type { GameMenuAction, GameMenuDynamicSource } from "@shared/types/gameMenu";
import {
    MENU_BAR_ITEM_KINDS,
    isMenuBarItemComplete,
    type MenuBarDocument,
    type MenuBarItem,
    type MenuBarItemKind,
    type MenuBarLabel,
    type MenuBarMenu,
} from "./document";
import { useMenuBarTranslator } from "./messages";
import type { MenuBarPath, MenuBarStore } from "./store";

type SurfaceEntry = { id: string; name: string };
type FnEntry = { fnRef: string; name: string; params: { pinId: string; name: string; valueType: string }[] };
type KeyEntry = { name: string; sourceText: string };

/** Where a dragged row would land: which list, and which of that list's n+1 gaps. */
type DropTarget = { listKey: string; gapIndex: number };

type DragHandlers = {
    dropTarget: DropTarget | null;
    begin: (path: MenuBarPath, listKey: string) => void;
    end: () => void;
    hover: (listKey: string, gapIndex: number) => boolean;
    drop: (listKey: string, gapIndex: number) => void;
};

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

/** What a row does, in one line, in the same words the action picker uses. */
function describeItem(
    item: MenuBarItem,
    tr: PluginTranslator,
    surfaces: SurfaceEntry[],
    fns: FnEntry[],
): string {
    if (item.kind === "separator") {
        return "";
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

/** What the row is called in the accordion header and in the preview. */
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
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [openRowKey, setOpenRowKey] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
    const frozen = app.services.workspace.frozen;

    /*
     * The row being dragged, held outside React state.
     *
     * A native drag runs a nested message loop, so the state set in `dragstart` has not landed by
     * the time the first `dragover` has to decide whether to accept the drop. The handlers read the
     * ref; the state above only draws the line.
     */
    const draggedRef = useRef<{ path: MenuBarPath; listKey: string } | null>(null);

    useEffect(() => store.subscribe(() => setData({ ...store.getData() })), [store]);

    const surfaces = useMemo(() => app.services.interface.listSurfaces(), [app]);
    const fns = useMemo(() => app.services.interface.listGlobalFns(), [app]);
    const keys = useMemo(() => app.services.localization.listKeys(), [app]);

    const openMenu = data.menus.find(menu => menu.id === openMenuId) ?? null;

    const drag: DragHandlers = {
        dropTarget,
        begin: (path, listKey) => {
            draggedRef.current = { path, listKey };
        },
        end: () => {
            draggedRef.current = null;
            setDropTarget(null);
        },
        hover: (listKey, gapIndex) => {
            const dragged = draggedRef.current;
            if (!dragged || dragged.listKey !== listKey) {
                return false;
            }
            setDropTarget(current => (
                current && current.listKey === listKey && current.gapIndex === gapIndex
                    ? current
                    : { listKey, gapIndex }
            ));
            return true;
        },
        drop: (listKey, gapIndex) => {
            const dragged = draggedRef.current;
            draggedRef.current = null;
            setDropTarget(null);
            if (dragged && dragged.listKey === listKey) {
                store.moveToGap(dragged.path, gapIndex);
            }
        },
    };

    return (
        <ui.Panel.Root>
            <ui.Panel.Header title={tr.t("title")} />

            <BarPreview data={data} openMenu={openMenu} tr={tr} />

            <ui.Panel.Toolbar>
                <ui.Switch
                    checked={data.enabled}
                    disabled={frozen}
                    onCheckedChange={checked => void store.setEnabled(checked)}
                    aria-label={tr.t("enabled")}
                />
                <span className="text-xs text-fg-muted">{tr.t("enabled")}</span>
            </ui.Panel.Toolbar>

            {/*
              * The container clears the line: a row that accepts a drop stops the event, so anything
              * reaching here is a position nothing would take.
              */}
            <div
                className="min-h-0 flex-1 overflow-y-auto"
                onDragOver={() => setDropTarget(null)}
                onDrop={drag.end}
            >
                {data.menus.length === 0
                    ? <ui.Panel.EmptyState title={tr.t("empty")} />
                    : (
                        <ui.Accordion
                            multiple={false}
                            /*
                             * No expand animation, at both levels.
                             *
                             * An animated section settles on a measured pixel height, and a row
                             * opened inside one leaves that measurement stale - the fields below the
                             * first were simply cut off (measured 280px against 406px of content).
                             * Without the animation every level is auto-height and nesting cannot
                             * clip. A panel this dense is better for opening instantly anyway.
                             */
                            disableAnimation
                            openItems={openMenuId ? [openMenuId] : []}
                            onOpenChange={items => {
                                setOpenMenuId(items[items.length - 1] ?? null);
                                setOpenRowKey(null);
                            }}
                        >
                            {data.menus.map((menu, index) => (
                                <MenuSection
                                    key={menu.id}
                                    menu={menu}
                                    index={index}
                                    lastIndex={data.menus.length - 1}
                                    tr={tr}
                                    store={store}
                                    frozen={frozen}
                                    surfaces={surfaces}
                                    fns={fns}
                                    keys={keys}
                                    openRowKey={openRowKey}
                                    onOpenRow={setOpenRowKey}
                                    drag={drag}
                                />
                            ))}
                        </ui.Accordion>
                    )}

                <div className="pt-2">
                    <ui.Button
                        size="sm"
                        variant="ghost"
                        disabled={frozen}
                        onClick={() => {
                            const path = store.addMenu(tr.t("newMenu"));
                            setOpenMenuId(path[0] ?? null);
                            setOpenRowKey(null);
                        }}
                    >
                        <Plus size={13} />
                        {tr.t("addMenu")}
                    </ui.Button>
                </div>
            </div>
        </ui.Panel.Root>
    );
}

/**
 * The bar as the player will see it.
 *
 * Light chrome rather than Studio's, deliberately: this is a picture of the window's own menu bar,
 * not a control of Studio's, and the operating systems that draw one draw it light. It follows the
 * menu opened below, so the picture and the list never describe different things.
 */
function BarPreview({
    data,
    openMenu,
    tr,
}: {
    data: MenuBarDocument;
    openMenu: MenuBarMenu | null;
    tr: PluginTranslator;
}) {
    const menus = data.enabled ? data.menus : [];
    return (
        <div className="mb-3 overflow-hidden rounded border border-edge">
            <div className="flex flex-wrap items-center gap-2 bg-neutral-100 px-2 py-1">
                {menus.length === 0
                    ? <span className="text-2xs text-neutral-500">{tr.t("previewEmpty")}</span>
                    : menus.map(menu => (
                        <span
                            key={menu.id}
                            className={[
                                "rounded px-1 text-2xs",
                                menu.id === openMenu?.id ? "bg-neutral-300 text-neutral-900" : "text-neutral-700",
                            ].join(" ")}
                        >
                            {menu.label.text || tr.t("unnamed")}
                        </span>
                    ))}
            </div>
            {openMenu && openMenu.items.length > 0 && (
                <div className="border-t border-neutral-300 bg-white px-1 py-1">
                    {openMenu.items.map(item => (
                        item.kind === "separator"
                            ? <div key={item.id} className="my-1 border-t border-neutral-200" />
                            : (
                                <div
                                    key={item.id}
                                    className="flex items-center gap-2 px-2 py-0.5 text-2xs text-neutral-900"
                                >
                                    <span className="truncate">{itemTitle(item, tr)}</span>
                                    {item.kind === "submenu" && <span className="ml-auto text-neutral-400">▸</span>}
                                </div>
                            )
                    ))}
                </div>
            )}
        </div>
    );
}

/** The drag props every reorderable row shares. */
function dragProps(
    path: MenuBarPath,
    listKey: string,
    index: number,
    frozen: boolean,
    drag: DragHandlers,
) {
    const gapAt = (event: React.DragEvent<HTMLDivElement>): number => {
        const rect = event.currentTarget.getBoundingClientRect();
        return event.clientY < rect.top + rect.height / 2 ? index : index + 1;
    };
    return {
        className: "relative nl-drag-source",
        draggable: !frozen,
        onDragStart: (event: React.DragEvent<HTMLDivElement>) => {
            event.stopPropagation();
            drag.begin(path, listKey);
        },
        onDragEnd: drag.end,
        onDragOver: (event: React.DragEvent<HTMLDivElement>) => {
            // Unconditional: the accept decision cannot read state set during this same drag.
            event.preventDefault();
            if (drag.hover(listKey, gapAt(event))) {
                event.stopPropagation();
            }
        },
        onDrop: (event: React.DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            event.stopPropagation();
            drag.drop(listKey, gapAt(event));
        },
    };
}

/** The one line, drawn once: on the top edge of the row below the gap, or the last row's bottom. */
function GapLines({
    listKey,
    index,
    lastIndex,
    drop,
}: {
    listKey: string;
    index: number;
    lastIndex: number;
    drop: DropTarget | null;
}) {
    if (!drop || drop.listKey !== listKey) {
        return null;
    }
    if (drop.gapIndex === index) {
        return <ui.DropIndicator edge="before" />;
    }
    if (index === lastIndex && drop.gapIndex === lastIndex + 1) {
        return <ui.DropIndicator edge="after" />;
    }
    return null;
}

function MenuSection({
    menu,
    index,
    lastIndex,
    tr,
    store,
    frozen,
    surfaces,
    fns,
    keys,
    openRowKey,
    onOpenRow,
    drag,
}: {
    menu: MenuBarMenu;
    index: number;
    lastIndex: number;
    tr: PluginTranslator;
    store: MenuBarStore;
    frozen: boolean;
    surfaces: SurfaceEntry[];
    fns: FnEntry[];
    keys: KeyEntry[];
    openRowKey: string | null;
    onOpenRow: (key: string | null) => void;
    drag: DragHandlers;
}) {
    const listKey = "menus";
    return (
        <div {...dragProps([menu.id], listKey, index, frozen, drag)}>
            <GapLines listKey={listKey} index={index} lastIndex={lastIndex} drop={drag.dropTarget} />
            <ui.AccordionItem
                id={menu.id}
                title={(
                    <span className="flex min-w-0 flex-1 items-baseline gap-2">
                        <span className="truncate text-2xs font-semibold">
                            {menu.label.text || tr.t("unnamed")}
                        </span>
                        <span className="ml-auto shrink-0 text-2xs text-fg-subtle">
                            {tr.t("menuRowDetail", { count: menu.items.length })}
                        </span>
                    </span>
                )}
            >
                <Rail depth={1}>
                {/*
                  * The rows first, the menu's own fields after them.
                  *
                  * Opening a menu is how the author reaches its rows; the header already shows the
                  * menu's name, so putting the name field above the rows only pushed the rows down
                  * the panel behind two fields and a note.
                  */}
                <RowList
                    items={menu.items}
                    parentPath={[menu.id]}
                    listKey={`menu:${menu.id}`}
                    tr={tr}
                    store={store}
                    frozen={frozen}
                    surfaces={surfaces}
                    fns={fns}
                    keys={keys}
                    openRowKey={openRowKey}
                    onOpenRow={onOpenRow}
                    drag={drag}
                />

                <div className="mt-1 border-t border-edge pt-1">
                    <LabelFields
                        label={menu.label}
                        tr={tr}
                        frozen={frozen}
                        keys={keys}
                        onChange={label => store.setLabel([menu.id], label)}
                    />
                    <RemoveButton
                        tr={tr}
                        frozen={frozen}
                        label={tr.t("removeMenu")}
                        onClick={() => store.remove([menu.id])}
                    />
                </div>
                </Rail>
            </ui.AccordionItem>
        </div>
    );
}

function RowList({
    items,
    parentPath,
    listKey,
    tr,
    store,
    frozen,
    surfaces,
    fns,
    keys,
    openRowKey,
    onOpenRow,
    drag,
}: {
    items: MenuBarItem[];
    parentPath: MenuBarPath;
    listKey: string;
    tr: PluginTranslator;
    store: MenuBarStore;
    frozen: boolean;
    surfaces: SurfaceEntry[];
    fns: FnEntry[];
    keys: KeyEntry[];
    openRowKey: string | null;
    onOpenRow: (key: string | null) => void;
    drag: DragHandlers;
}) {
    const openHere = items.some(item => openRowKey === [...parentPath, item.id].join("/"))
        ? [openRowKey as string]
        : [];
    return (
        <>
            <ui.Accordion
                multiple={false}
                disableAnimation
                openItems={openHere}
                onOpenChange={changed => onOpenRow(changed[changed.length - 1] ?? null)}
            >
                {items.map((item, index) => (
                    <RowSection
                        key={item.id}
                        item={item}
                        path={[...parentPath, item.id]}
                        index={index}
                        lastIndex={items.length - 1}
                        listKey={listKey}
                        tr={tr}
                        store={store}
                        frozen={frozen}
                        surfaces={surfaces}
                        fns={fns}
                        keys={keys}
                        openRowKey={openRowKey}
                        onOpenRow={onOpenRow}
                        drag={drag}
                    />
                ))}
            </ui.Accordion>
            <AddRowButton tr={tr} store={store} frozen={frozen} path={parentPath} onAdded={onOpenRow} />
        </>
    );
}

function RowSection({
    item,
    path,
    index,
    lastIndex,
    listKey,
    tr,
    store,
    frozen,
    surfaces,
    fns,
    keys,
    openRowKey,
    onOpenRow,
    drag,
}: {
    item: MenuBarItem;
    path: MenuBarPath;
    index: number;
    lastIndex: number;
    listKey: string;
    tr: PluginTranslator;
    store: MenuBarStore;
    frozen: boolean;
    surfaces: SurfaceEntry[];
    fns: FnEntry[];
    keys: KeyEntry[];
    openRowKey: string | null;
    onOpenRow: (key: string | null) => void;
    drag: DragHandlers;
}) {
    const detail = describeItem(item, tr, surfaces, fns);
    return (
        <div {...dragProps(path, listKey, index, frozen, drag)}>
            <GapLines listKey={listKey} index={index} lastIndex={lastIndex} drop={drag.dropTarget} />
            <ui.AccordionItem
                id={path.join("/")}
                level={1}
                title={(
                    <span className="flex min-w-0 flex-1 items-baseline gap-2">
                        <span className="shrink-0 self-center text-fg-subtle">{itemKindIcon(item.kind)}</span>
                        <span
                            className={[
                                "truncate text-2xs",
                                isMenuBarItemComplete(item) ? "" : "italic text-fg-subtle",
                            ].join(" ")}
                        >
                            {itemTitle(item, tr)}
                        </span>
                        {detail && (
                            <span className="ml-auto shrink-0 truncate text-2xs text-fg-subtle">{detail}</span>
                        )}
                    </span>
                )}
            >
                <Rail depth={2}>
                {(item.kind === "action" || item.kind === "submenu") && (
                    <LabelFields
                        label={item.label}
                        tr={tr}
                        frozen={frozen}
                        keys={keys}
                        onChange={label => store.setLabel(path, label)}
                    />
                )}

                {item.kind === "action" && (
                    <ActionFields
                        action={item.action}
                        tr={tr}
                        frozen={frozen}
                        surfaces={surfaces}
                        fns={fns}
                        onChange={action => store.setAction(path, action)}
                    />
                )}

                {item.kind === "dynamic" && (
                    <ui.Panel.Row
                        label={tr.t("source")}
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

                {!isMenuBarItemComplete(item) && (
                    <div className="pt-1 text-2xs text-warning">{tr.t("incomplete")}</div>
                )}
                {frozen && <div className="pt-1 text-2xs text-fg-subtle">{tr.t("frozen")}</div>}

                <RemoveButton tr={tr} frozen={frozen} label={tr.t("remove")} onClick={() => store.remove(path)} />

                {item.kind === "submenu" && (
                    <div className="mt-1 border-t border-edge pt-1">
                        <RowList
                            items={item.items}
                            parentPath={path}
                            listKey={`${listKey}/${item.id}`}
                            tr={tr}
                            store={store}
                            frozen={frozen}
                            surfaces={surfaces}
                            fns={fns}
                            keys={keys}
                            openRowKey={openRowKey}
                            onOpenRow={onOpenRow}
                            drag={drag}
                        />
                    </div>
                )}
                </Rail>
            </ui.AccordionItem>
        </div>
    );
}

/**
 * The line that carries one level of nesting.
 *
 * Indented past where its own header's text begins, so a field always sits to the right of the row
 * it belongs to - the accordion indents a header by its level and the chevron, and content that
 * started at the left edge read as belonging to the level above.
 *
 * On a wrapper of our own rather than on the accordion's `contentClassName`: that element is the one
 * the accordion measures, and a margin there sits outside the measured box.
 */
function Rail({ depth, children }: { depth: 1 | 2; children: React.ReactNode }) {
    return (
        <div className={depth === 1 ? "ml-3 border-l border-edge pl-3" : "ml-6 border-l border-edge pl-3"}>
            {children}
        </div>
    );
}

function RemoveButton({
    tr,
    frozen,
    label,
    onClick,
}: {
    tr: PluginTranslator;
    frozen: boolean;
    label: string;
    onClick: () => void;
}) {
    return (
        <div className="pt-1">
            <ui.Button size="sm" variant="ghost" disabled={frozen} onClick={onClick} title={tr.t("remove")}>
                <Trash2 size={12} />
                {label}
            </ui.Button>
        </div>
    );
}

function LabelFields({
    label,
    tr,
    frozen,
    keys,
    onChange,
}: {
    label: MenuBarLabel;
    tr: PluginTranslator;
    frozen: boolean;
    keys: KeyEntry[];
    onChange: (label: MenuBarLabel) => void;
}) {
    return (
        <>
            <ui.Panel.Row
                label={tr.t("labelText")}
                control={(
                    <ui.Input
                        size="sm"
                        className="w-40"
                        value={label.text}
                        disabled={frozen}
                        onChange={event => onChange({ ...label, text: event.target.value })}
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
                        onChange={value => onChange({ ...label, key: String(value) || null })}
                    />
                )}
            />
        </>
    );
}

/**
 * The one way to add a row, and the one place the four kinds are named.
 *
 * A menu rather than four buttons: the kinds are a short closed list read once, and four buttons
 * repeated under every menu turned the panel into a wall of controls.
 */
function AddRowButton({
    tr,
    store,
    frozen,
    path,
    onAdded,
}: {
    tr: PluginTranslator;
    store: MenuBarStore;
    frozen: boolean;
    path: MenuBarPath;
    onAdded: (key: string) => void;
}) {
    const { menuState, showMenu, hideMenu } = ui.useContextMenu();
    return (
        <>
            <ui.Button size="sm" variant="ghost" disabled={frozen} onClick={showMenu}>
                <Plus size={12} />
                {tr.t("addItem")}
            </ui.Button>
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
                        ).join("/"));
                    },
                }))}
            />
        </>
    );
}

function ActionFields({
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
                        <>
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
                        </>
                    )}
                </>
            )}
        </>
    );
}

/**
 * Type the author's typing to the pin that will receive it.
 *
 * A function that declared an integer parameter has to be handed a number - a string "3" reaching an
 * arithmetic node shows up as a wrong answer rather than an error. Anything unparseable stays the
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
