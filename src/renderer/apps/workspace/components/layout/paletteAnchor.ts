import { useEffect, useState } from "react";

/** Widest a palette card gets before the viewport margin takes over. */
export const PALETTE_CARD_MAX_WIDTH = 720;

export const PALETTE_CARD_WIDTH_CLASS = "w-[min(720px,calc(100vw-32px))]";

/**
 * Horizontal offset that pins a palette card under the title-bar search box, or `null` when the
 * box is not on screen (hidden by setting, or a window without one) — callers fall back to a
 * window-centered card. The box is centered in the title bar's *leftover* flex space rather than
 * in the window, so a window-centered card would visibly miss its anchor.
 *
 * Shared so the command palette and Quick Open drop from the same place: two pickers appearing in
 * different spots reads as two unrelated features.
 */
export function usePaletteAnchorLeft(open: boolean): number | null {
    const [anchorLeft, setAnchorLeft] = useState<number | null>(null);

    useEffect(() => {
        if (!open) {
            return;
        }
        const measure = () => {
            const box = document.querySelector("[data-titlebar-search-box]");
            if (!box) {
                setAnchorLeft(null);
                return;
            }
            const rect = box.getBoundingClientRect();
            const cardWidth = Math.min(PALETTE_CARD_MAX_WIDTH, window.innerWidth - 32);
            const ideal = rect.left + rect.width / 2 - cardWidth / 2;
            setAnchorLeft(Math.round(Math.min(Math.max(ideal, 16), window.innerWidth - cardWidth - 16)));
        };
        measure();
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
    }, [open]);

    return anchorLeft;
}
