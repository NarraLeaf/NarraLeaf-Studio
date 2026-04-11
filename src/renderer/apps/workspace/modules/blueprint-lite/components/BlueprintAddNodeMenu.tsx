import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { IBlueprintNodeCatalogService } from "@/lib/workspace/services/services";
import type { BlueprintPaletteContext } from "@/lib/ui-editor/blueprint-nodes/types";
import { Search } from "lucide-react";

const MENU_W = 256;
const MENU_MAX_H = 224;

type PaletteEntry = ReturnType<IBlueprintNodeCatalogService["listPaletteEntries"]>[number];

type SectionRow =
    | { kind: "heading"; category: string; key: string }
    | { kind: "item"; entry: PaletteEntry; flatIndex: number; key: string };

type Props = {
    nodeCatalog: IBlueprintNodeCatalogService;
    open: boolean;
    paletteContext: BlueprintPaletteContext;
    anchor: { x: number; y: number };
    flowPosition: { x: number; y: number };
    onClose: () => void;
    onPickType: (type: string, flowPosition: { x: number; y: number }) => void;
};

function buildSectionsWithFlatIndices(entries: readonly PaletteEntry[]): SectionRow[] {
    const m = new Map<string, PaletteEntry[]>();
    for (const e of entries) {
        const list = m.get(e.category) ?? [];
        list.push(e);
        m.set(e.category, list);
    }
    const sorted = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    let flatIndex = 0;
    const rows: SectionRow[] = [];
    for (const [category, list] of sorted) {
        rows.push({ kind: "heading", category, key: `h:${category}` });
        for (const entry of list) {
            rows.push({
                kind: "item",
                entry,
                flatIndex: flatIndex++,
                key: `i:${category}:${entry.type}`,
            });
        }
    }
    return rows;
}

export function BlueprintAddNodeMenu({
    nodeCatalog,
    open,
    paletteContext,
    anchor,
    flowPosition,
    onClose,
    onPickType,
}: Props) {
    const [query, setQuery] = useState("");
    const [activeFlatIndex, setActiveFlatIndex] = useState(-1);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const navStateRef = useRef({ activeFlatIndex: -1, itemCount: 0 });

    useEffect(() => {
        if (open) {
            setQuery("");
            setActiveFlatIndex(-1);
            requestAnimationFrame(() => inputRef.current?.focus());
        }
    }, [open]);

    useEffect(() => {
        setActiveFlatIndex(-1);
    }, [query]);

    const entries = useMemo(
        () => nodeCatalog.listPaletteEntries(paletteContext),
        [nodeCatalog, paletteContext],
    );

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) {
            return entries;
        }
        return entries.filter(
            e =>
                e.displayName.toLowerCase().includes(q) ||
                e.type.toLowerCase().includes(q) ||
                e.category.toLowerCase().includes(q) ||
                e.keywords?.some(k => k.toLowerCase().includes(q)),
        );
    }, [entries, query]);

    const displayRows = useMemo(() => buildSectionsWithFlatIndices(filtered), [filtered]);
    const itemCount = filtered.length;

    useEffect(() => {
        navStateRef.current = { activeFlatIndex, itemCount };
    }, [activeFlatIndex, itemCount]);

    useEffect(() => {
        setActiveFlatIndex(prev => {
            if (itemCount <= 0) {
                return -1;
            }
            if (prev >= itemCount) {
                return itemCount - 1;
            }
            return prev;
        });
    }, [itemCount]);

    const displayRowsRef = useRef(displayRows);
    displayRowsRef.current = displayRows;
    const actionsRef = useRef({ onPickType, flowPosition, onClose });
    actionsRef.current = { onPickType, flowPosition, onClose };

    useEffect(() => {
        if (!open || activeFlatIndex < 0) {
            return;
        }
        const root = listRef.current;
        if (!root) {
            return;
        }
        const el = root.querySelector(`[data-bp-add-node-idx="${activeFlatIndex}"]`);
        el?.scrollIntoView({ block: "nearest" });
    }, [activeFlatIndex, open]);

    useEffect(() => {
        if (!open) {
            return;
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                actionsRef.current.onClose();
                return;
            }

            const { activeFlatIndex: cur, itemCount: n } = navStateRef.current;
            if (n === 0) {
                return;
            }

            if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveFlatIndex(prev => {
                    if (prev < 0) {
                        return 0;
                    }
                    return Math.min(prev + 1, n - 1);
                });
                return;
            }

            if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveFlatIndex(prev => {
                    if (prev <= 0) {
                        requestAnimationFrame(() => inputRef.current?.focus());
                        return -1;
                    }
                    return prev - 1;
                });
                return;
            }

            if (e.key === "Home") {
                e.preventDefault();
                setActiveFlatIndex(0);
                return;
            }

            if (e.key === "End") {
                e.preventDefault();
                setActiveFlatIndex(n - 1);
                return;
            }

            if (e.key === "Enter") {
                if (cur >= 0 && cur < n) {
                    const row = displayRowsRef.current.find(r => r.kind === "item" && r.flatIndex === cur);
                    if (row?.kind === "item") {
                        e.preventDefault();
                        const { onPickType: pick, flowPosition: pos, onClose: close } = actionsRef.current;
                        pick(row.entry.type, pos);
                        close();
                    }
                }
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open]);

    const layout = useMemo(() => {
        if (typeof window === "undefined") {
            return { left: anchor.x, top: anchor.y };
        }
        const pad = 8;
        const left = Math.max(pad, Math.min(anchor.x, window.innerWidth - MENU_W - pad));
        const top = Math.max(pad, Math.min(anchor.y, window.innerHeight - MENU_MAX_H - 80));
        return { left, top };
    }, [anchor.x, anchor.y]);

    if (!open) {
        return null;
    }

    const itemRowClass = (isActive: boolean) =>
        `flex w-full items-center justify-between gap-2 px-2 py-1 text-left text-[11px] text-gray-200 ${
            isActive ? "bg-white/15" : "hover:bg-white/10"
        }`;

    return createPortal(
        <>
            <button
                type="button"
                className="fixed inset-0 z-[100] cursor-default bg-transparent"
                aria-label="Close add node menu"
                onClick={onClose}
            />
            <div
                role="presentation"
                className="fixed z-[101] w-64 overflow-hidden rounded-md border border-white/15 bg-[#14181c] shadow-xl"
                style={{ left: layout.left, top: layout.top, maxHeight: MENU_MAX_H + 48 }}
                onContextMenu={e => e.preventDefault()}
            >
                <div className="border-b border-white/10 px-2 py-1.5">
                    <div className="flex items-center gap-1.5 rounded border border-white/10 bg-[#0f1115] px-2 py-1">
                        <Search className="h-3.5 w-3.5 shrink-0 text-gray-500" aria-hidden />
                        <input
                            ref={inputRef}
                            type="search"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Search nodes…"
                            className="min-w-0 flex-1 bg-transparent text-[11px] text-gray-200 outline-none placeholder:text-gray-600"
                            autoComplete="off"
                            aria-controls="bp-add-node-list"
                            aria-activedescendant={
                                activeFlatIndex >= 0 ? `bp-add-node-option-${activeFlatIndex}` : undefined
                            }
                        />
                    </div>
                </div>
                <div
                    id="bp-add-node-list"
                    ref={listRef}
                    role="listbox"
                    aria-label="Node types"
                    className="max-h-56 overflow-y-auto py-0.5"
                    style={{ maxHeight: MENU_MAX_H }}
                >
                    {displayRows.length === 0 || itemCount === 0 ? (
                        <p className="px-2 py-2 text-[11px] text-gray-500">No matches.</p>
                    ) : (
                        displayRows.map(row => {
                            if (row.kind === "heading") {
                                return (
                                    <p
                                        key={row.key}
                                        role="presentation"
                                        className="px-2 py-0.5 text-[9px] uppercase tracking-wide text-gray-600"
                                    >
                                        {row.category}
                                    </p>
                                );
                            }
                            const isActive = activeFlatIndex === row.flatIndex;
                            return (
                                <button
                                    key={row.key}
                                    id={`bp-add-node-option-${row.flatIndex}`}
                                    type="button"
                                    role="option"
                                    aria-selected={isActive}
                                    data-bp-add-node-idx={row.flatIndex}
                                    className={itemRowClass(isActive)}
                                    title={row.entry.keywords?.join(", ") ?? row.entry.type}
                                    onClick={() => {
                                        onPickType(row.entry.type, flowPosition);
                                        onClose();
                                    }}
                                    onMouseEnter={() => setActiveFlatIndex(row.flatIndex)}
                                >
                                    <span className="truncate">{row.entry.displayName}</span>
                                    <span className="shrink-0 font-mono text-[9px] text-gray-600">
                                        {row.entry.type}
                                    </span>
                                </button>
                            );
                        })
                    )}
                </div>
            </div>
        </>,
        document.body,
    );
}
