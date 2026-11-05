import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Folder, Users } from "lucide-react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { Character } from "@/lib/workspace/services/character/Character";
import { useTranslation } from "@/lib/i18n";
import { StoryCandidateMarkView } from "./storyCandidateMark";
import { cn } from "@/lib/utils/cn";
import type { StoryCandidateMark } from "./storyCommandCandidates";
import type { StoryCommandFolder } from "./storyCommandValues";
import { usePointerHighlight } from "./storyMenuPointer";

/**
 * The candidate list for a command-line *argument* — an asset, a scene, a transition, a param name.
 *
 * The command name keeps its own menu (`ActionCommandMenu`, with its category tabs) and the speaker
 * keeps `CharacterPicker`; this is only for the positions those two never covered. It deliberately
 * mirrors `CharacterPicker`'s shape — same surface, same row metrics, same active treatment — so the
 * slot looks like one menu that changes its contents as the caret moves, not three menus.
 */

/**
 * Structurally identical to the rows file's own frame type; declared here to avoid an import cycle.
 *
 * `style` is a VIEWPORT-anchored box and the menu portals into it, because the row it belongs to
 * cannot hold it: every virtualised row wrapper carries a `translateY`, and that transform makes a
 * stacking context an overhanging `absolute` panel cannot escape — the following rows painted over it.
 */
type AnchoredMenuFrame = { placement: "above" | "below"; style: CSSProperties };

export type StoryCandidateItem = {
    /** Stable within one list. Values are not unique on their own (two assets may share a name). */
    key: string;
    /** The text a completion inserts. */
    value: string;
    label: string;
    /** Trailing note: a variable's type, the canonical value behind an alias. */
    detail?: string;
    /**
     * What this candidate is — drawn as a picture where the thing has one (an image's own thumbnail,
     * a character's face, an appearance's sprite) and as a glyph otherwise. Carried as the structural
     * mark rather than as a chosen icon so the picking stays in one place; see `storyCandidateMark`.
     */
    mark?: StoryCandidateMark;
    /** Right-aligned tag, e.g. a temp speaker's "name only". */
    tag?: string;
    /**
     * This entry is the author's own text offered back, matching nothing (a temp speaker, an object
     * created in another scene). Carried through from the candidate rather than collapsed into `tag`
     * because it also decides the highlight: taking a free echo and submitting the line produce the
     * same block, so Enter should submit. See `defaultHighlights`.
     */
    free?: true;
    /** Where the author filed it, outermost first; with submenus on, the menu files it the same way. */
    folders?: readonly StoryCommandFolder[];
};

/**
 * One line of a candidate menu column: a candidate, or a folder whose contents open in the next
 * column. A flat list is a single column of items, so one model covers both.
 */
export type StoryCandidateNode =
    | { kind: "item"; key: string; item: StoryCandidateItem }
    | {
        kind: "folder";
        key: string;
        folder: StoryCommandFolder;
        children: StoryCandidateNode[];
        /** Candidates anywhere inside, folders within it included. */
        count: number;
    };

/**
 * File `items` under their folders, or leave them flat.
 *
 * Folders come first at every level, in the order their first candidate arrives (the context lists
 * names in the asset browser's order, so this is the browser's), then the candidates filed directly
 * there. With `submenus` off every candidate is a line of the one column, in the order given.
 */
export function buildCandidateTree(items: readonly StoryCandidateItem[], submenus: boolean): StoryCandidateNode[] {
    if (!submenus) {
        return items.map(item => ({ kind: "item", key: item.key, item }));
    }
    type Level = { folders: Map<string, { folder: StoryCommandFolder; level: Level }>; items: StoryCandidateNode[] };
    const newLevel = (): Level => ({ folders: new Map(), items: [] });
    const root = newLevel();
    for (const item of items) {
        let level = root;
        for (const folder of item.folders ?? []) {
            let entry = level.folders.get(folder.id);
            if (!entry) {
                entry = { folder, level: newLevel() };
                level.folders.set(folder.id, entry);
            }
            level = entry.level;
        }
        level.items.push({ kind: "item", key: item.key, item });
    }
    const toNodes = (level: Level): StoryCandidateNode[] => [
        ...[...level.folders.values()].map(({ folder, level: inner }): StoryCandidateNode => {
            const children = toNodes(inner);
            const count = children.reduce((sum, child) => sum + (child.kind === "folder" ? child.count : 1), 0);
            return { kind: "folder", key: `folder:${folder.id}`, folder, children, count };
        }),
        ...level.items,
    ];
    return toNodes(root);
}

/** The columns a trail opens: the root, then the contents of each folder along it. */
function trailColumns(tree: StoryCandidateNode[], trail: readonly string[]): StoryCandidateNode[][] {
    const columns = [tree];
    let nodes = tree;
    for (const key of trail) {
        const node = nodes.find(entry => entry.key === key);
        if (node?.kind !== "folder") {
            break;
        }
        columns.push(node.children);
        nodes = node.children;
    }
    return columns;
}

/** The longest start of `trail` that still names nodes, each inside the one before. */
function validTrail(tree: StoryCandidateNode[], trail: readonly string[]): string[] {
    const valid: string[] = [];
    let nodes: StoryCandidateNode[] | null = tree;
    for (const key of trail) {
        const node: StoryCandidateNode | undefined = nodes?.find(entry => entry.key === key);
        if (!node) {
            break;
        }
        valid.push(key);
        nodes = node.kind === "folder" ? node.children : null;
    }
    return valid;
}

/**
 * Which candidate Enter would take, and where the highlight is in the columns.
 *
 * The highlight is a trail: the highlighted line of each column, from the root to the one with the
 * keyboard. A folder on the trail shows its contents in the next column whether or not the keyboard
 * has gone in, which is what lets the arrows walk the root and see inside each folder on the way.
 *
 * `autoHighlight` carries the interaction model's rule down to the list: must-pick positions start on
 * their first candidate, optional-next-step positions start on nothing so Enter submits the line
 * instead of grabbing a candidate. The first candidate is the root's first, not a folder's, even when
 * folders are listed above it - a folder there would turn Enter into opening a column. An arrow key
 * creates a highlight where there was none.
 */
export function useStoryCandidateMenuState(items: StoryCandidateItem[], autoHighlight: boolean, submenus = false) {
    const tree = useMemo(() => buildCandidateTree(items, submenus), [items, submenus]);
    const [trail, setTrail] = useState<string[]>([]);

    useEffect(() => {
        setTrail(current => {
            const valid = validTrail(tree, current);
            if (valid.length > 0) {
                return valid.length === current.length ? current : valid;
            }
            const first = autoHighlight ? tree.find(node => node.kind === "item") ?? tree[0] : undefined;
            return first ? [first.key] : current.length === 0 ? current : [];
        });
    }, [autoHighlight, tree]);

    const columns = useMemo(() => trailColumns(tree, trail), [tree, trail]);
    const depth = trail.length - 1;
    const activeNode = depth >= 0 ? columns[depth]?.find(node => node.key === trail[depth]) ?? null : null;
    const activeItem = activeNode?.kind === "item" ? activeNode.item : null;

    const move = (direction: -1 | 1) => {
        if (depth < 0) {
            const first = tree[direction === 1 ? 0 : tree.length - 1];
            if (first) {
                setTrail([first.key]);
            }
            return;
        }
        const siblings = columns[depth];
        if (!siblings || siblings.length === 0) {
            return;
        }
        const index = siblings.findIndex(node => node.key === trail[depth]);
        const next = siblings[(index + direction + siblings.length) % siblings.length];
        setTrail([...trail.slice(0, depth), next.key]);
    };

    /** Into the highlighted folder, on its first line. False when the highlight is not on a folder. */
    const enter = (): boolean => {
        if (activeNode?.kind !== "folder" || activeNode.children.length === 0) {
            return false;
        }
        setTrail([...trail, activeNode.children[0].key]);
        return true;
    };

    /** Back out to the folder this column belongs to. False at the root. */
    const leave = (): boolean => {
        if (trail.length <= 1) {
            return false;
        }
        setTrail(trail.slice(0, -1));
        return true;
    };

    /** Put the highlight on `key` in column `at`, closing whatever was open past it. */
    const select = (at: number, key: string) => {
        setTrail(current => [...current.slice(0, at), key]);
    };

    /** A folder clicked: highlight it and go in. */
    const enterFolder = (at: number, key: string) => {
        const node = columns[at]?.find(entry => entry.key === key);
        if (node?.kind !== "folder" || node.children.length === 0) {
            return;
        }
        setTrail([...trail.slice(0, at), key, node.children[0].key]);
    };

    /** The first candidate the root shows, for Tab with nothing highlighted. */
    const firstItem = (tree.find(node => node.kind === "item") as Extract<StoryCandidateNode, { kind: "item" }> | undefined)?.item ?? null;

    return { columns, trail, activeItem, firstItem, onFolder: activeNode?.kind === "folder", move, enter, leave, select, enterFolder };
}

/**
 * The line in `column` with this key. Compared as an attribute rather than built into a selector: a
 * key carries the candidate's own text, which may hold anything a selector would have to escape.
 */
function lineIn(column: HTMLElement | null | undefined, key: string): Element | null {
    return [...(column?.querySelectorAll("[data-candidate-key]") ?? [])]
        .find(node => node.getAttribute("data-candidate-key") === key) ?? null;
}

/** A column past the root: its width, and the gap to the column it opened from. */
const SUB_COLUMN_WIDTH_PX = 240;
const COLUMN_GAP_PX = 4;
const VIEWPORT_MARGIN_PX = 8;

export function StoryCommandCandidateMenu(props: {
    /** The root column, then each open folder's contents (see `useStoryCandidateMenuState`). */
    columns: StoryCandidateNode[][];
    /** The highlighted line of each column, root first. */
    trail: readonly string[];
    onHighlight: (column: number, key: string) => void;
    onEnterFolder: (column: number, key: string) => void;
    onChoose: (item: StoryCandidateItem) => void;
    onCancel: () => void;
    frame: AnchoredMenuFrame;
    /** The project's characters — what a character or appearance mark resolves its picture against. */
    characters: readonly Character[];
}) {
    const { t } = useTranslation();
    const rootRef = useRef<HTMLDivElement | null>(null);
    const columnRefs = useRef<(HTMLDivElement | null)[]>([]);
    /** Which column the pointer last moved in, so the shared pointer reports a line by column. */
    const pointerColumn = useRef(0);
    const pointer = usePointerHighlight(key => props.onHighlight(pointerColumn.current, key));
    const [offsets, setOffsets] = useState<{ top: number; left: number }[]>([]);
    const [scrollTick, setScrollTick] = useState(0);

    useEffect(() => {
        const column = props.trail.length - 1;
        if (column < 0) {
            return;
        }
        const key = props.trail[column];
        window.requestAnimationFrame(() => lineIn(columnRefs.current[column], key)?.scrollIntoView({ block: "nearest" }));
    }, [props.trail]);

    // Each column past the root sits level with the line that opened it, on the side of its parent
    // column that has room. Worked out column by column from the root's real box: a column's own box
    // is not where this pass is about to put it, but a line's place inside its column is.
    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!root || props.columns.length < 2) {
            return;
        }
        const rootRect = root.getBoundingClientRect();
        const first = columnRefs.current[0]?.getBoundingClientRect();
        if (!first) {
            return;
        }
        const boxes = [{ top: first.top - rootRect.top, left: first.left - rootRect.left, width: first.width }];
        const next: { top: number; left: number }[] = [];
        for (let index = 1; index < props.columns.length; index++) {
            const parent = columnRefs.current[index - 1];
            const panel = columnRefs.current[index];
            const line = lineIn(parent, props.trail[index - 1]);
            const prev = boxes[index - 1];
            if (!parent || !panel || !line) {
                next.push({ top: prev.top, left: prev.left + prev.width + COLUMN_GAP_PX });
                boxes.push({ ...next[next.length - 1], width: SUB_COLUMN_WIDTH_PX });
                continue;
            }
            const lineTop = line.getBoundingClientRect().top - parent.getBoundingClientRect().top;
            const height = panel.getBoundingClientRect().height;
            // Back by the column's own border and padding, so its first line is level with the parent's.
            let top = prev.top + lineTop - 5;
            top = Math.min(top, window.innerHeight - VIEWPORT_MARGIN_PX - height - rootRect.top);
            top = Math.max(top, VIEWPORT_MARGIN_PX - rootRect.top);
            const right = prev.left + prev.width + COLUMN_GAP_PX;
            const left = rootRect.left + right + SUB_COLUMN_WIDTH_PX <= window.innerWidth - VIEWPORT_MARGIN_PX
                ? right
                : prev.left - COLUMN_GAP_PX - SUB_COLUMN_WIDTH_PX;
            next.push({ top, left });
            boxes.push({ top, left, width: SUB_COLUMN_WIDTH_PX });
        }
        setOffsets(current => current.length === next.length && current.every((box, index) => box.top === next[index].top && box.left === next[index].left)
            ? current
            : next);
    }, [props.columns, props.trail, scrollTick, props.frame]);

    const renderNode = (node: StoryCandidateNode, column: number) => {
        const onTrail = props.trail[column] === node.key;
        const active = onTrail && column === props.trail.length - 1;
        const tint = active ? "bg-primary/15 text-fg" : onTrail ? "bg-fill" : pointer.live ? "hover:bg-fill" : "";
        const moved = (event: { clientX: number; clientY: number }) => {
            pointerColumn.current = column;
            pointer.move(node.key, event);
        };
        if (node.kind === "folder") {
            const Glyph = node.folder.kind === "cast" ? Users : Folder;
            // A folder as one line, the size of a candidate's. Highlighting it shows its contents in
            // the next column; → or Enter goes in. While the keyboard is further in, it keeps a quieter
            // tint, so the path from the root to the open column stays visible.
            return (
                <button
                    key={node.key}
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={onTrail}
                    data-candidate-key={node.key}
                    className={cn("flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors", tint)}
                    onMouseMove={moved}
                    onMouseDown={() => props.onEnterFolder(column, node.key)}
                >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                        <Glyph className="h-4 w-4 text-fg-subtle" />
                    </span>
                    <span className="truncate text-sm text-fg">{node.folder.name}</span>
                    <span className="shrink-0 text-2xs tabular-nums text-fg-subtle">{node.count}</span>
                    <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                </button>
            );
        }
        const { item } = node;
        return (
            <button
                key={item.key}
                type="button"
                role="option"
                aria-selected={active}
                data-candidate-key={item.key}
                className={cn("flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors", tint)}
                onMouseMove={moved}
                onMouseDown={() => props.onChoose(item)}
            >
                {item.mark ? <StoryCandidateMarkView mark={item.mark} characters={props.characters} /> : null}
                <span className="truncate text-sm text-fg">{item.label}</span>
                {item.detail ? <span className="min-w-0 shrink truncate text-2xs text-fg-subtle">{item.detail}</span> : null}
                {item.tag ? <span className="ml-auto shrink-0 text-2xs text-fg-subtle">{item.tag}</span> : null}
            </button>
        );
    };

    const root = props.columns[0] ?? [];
    return createPortal(
        <div
            ref={rootRef}
            className="z-[70]"
            style={props.frame.style}
            onMouseDown={event => {
                // Keep the caret in the slot: the menu is an extension of the line being typed.
                event.preventDefault();
                event.stopPropagation();
            }}
        >
            {props.columns.map((nodes, column) => (
                <div
                    key={column}
                    ref={node => {
                        columnRefs.current[column] = node;
                    }}
                    role="listbox"
                    className={cn(
                        "nl-no-scrollbar max-h-72 overflow-auto rounded-xl border border-edge bg-surface-raised p-1 shadow-xl",
                        column === 0 ? "w-[320px] max-w-full" : "absolute",
                    )}
                    style={column === 0 ? undefined : { width: SUB_COLUMN_WIDTH_PX, top: offsets[column - 1]?.top ?? 0, left: offsets[column - 1]?.left ?? 0 }}
                    {...pointer.listProps}
                    onScroll={() => {
                        pointer.listProps.onScroll();
                        setScrollTick(tick => tick + 1);
                    }}
                >
                    {column === 0 && root.length === 0 ? (
                        <button
                            type="button"
                            className={["w-full rounded-md px-2 py-2 text-left text-sm text-fg-muted", pointer.live ? "hover:bg-fill" : ""].join(" ")}
                            onMouseMove={event => pointer.move(null, event)}
                            onMouseDown={props.onCancel}
                        >
                            {t("story.rows.noCandidates")}
                        </button>
                    ) : (
                        nodes.map(node => renderNode(node, column))
                    )}
                </div>
            ))}
        </div>,
        globalThis.document.body,
    );
}
