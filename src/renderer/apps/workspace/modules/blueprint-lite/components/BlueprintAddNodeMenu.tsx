import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { IBlueprintNodeCatalogService } from "@/lib/workspace/services/services";
import type { BlueprintPaletteContext } from "@/lib/ui-editor/blueprint-nodes/types";
import { Search } from "lucide-react";

const MENU_W = 256;
const MENU_MAX_H = 224;

type Props = {
    nodeCatalog: IBlueprintNodeCatalogService;
    open: boolean;
    paletteContext: BlueprintPaletteContext;
    anchor: { x: number; y: number };
    flowPosition: { x: number; y: number };
    onClose: () => void;
    onPickType: (type: string, flowPosition: { x: number; y: number }) => void;
};

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
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (open) {
            setQuery("");
            requestAnimationFrame(() => inputRef.current?.focus());
        }
    }, [open]);

    useEffect(() => {
        if (!open) {
            return;
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose]);

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

    const byCategory = useMemo(() => {
        const m = new Map<string, typeof filtered>();
        for (const e of filtered) {
            const list = m.get(e.category) ?? [];
            list.push(e);
            m.set(e.category, list);
        }
        return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    }, [filtered]);

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

    return createPortal(
        <>
            <button
                type="button"
                className="fixed inset-0 z-[100] cursor-default bg-transparent"
                aria-label="Close add node menu"
                onClick={onClose}
            />
            <div
                role="menu"
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
                        />
                    </div>
                </div>
                <div className="max-h-56 overflow-y-auto py-0.5" style={{ maxHeight: MENU_MAX_H }}>
                    {byCategory.length === 0 ? (
                        <p className="px-2 py-2 text-[11px] text-gray-500">No matches.</p>
                    ) : (
                        byCategory.map(([category, list]) => (
                            <div key={category}>
                                <p className="px-2 py-0.5 text-[9px] uppercase tracking-wide text-gray-600">
                                    {category}
                                </p>
                                {list.map(e => (
                                    <button
                                        key={e.type}
                                        type="button"
                                        role="menuitem"
                                        className="flex w-full items-center justify-between gap-2 px-2 py-1 text-left text-[11px] text-gray-200 hover:bg-white/10"
                                        title={e.keywords?.join(", ") ?? e.type}
                                        onClick={() => {
                                            onPickType(e.type, flowPosition);
                                            onClose();
                                        }}
                                    >
                                        <span className="truncate">{e.displayName}</span>
                                        <span className="shrink-0 font-mono text-[9px] text-gray-600">{e.type}</span>
                                    </button>
                                ))}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </>,
        document.body,
    );
}
