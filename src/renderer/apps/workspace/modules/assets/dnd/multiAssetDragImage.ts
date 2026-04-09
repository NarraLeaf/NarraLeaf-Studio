import type { DragEvent } from "react";

const GHOST_CLASS = "nl-dnd-multi-asset-ghost";

/**
 * Custom drag image when multiple assets are dragged together (default is only the primary element).
 * Must run synchronously inside dragstart; the node is removed on the next frame.
 */
export function applyMultiAssetDragImage(event: DragEvent, count: number): void {
    if (count <= 1) {
        return;
    }
    const el = document.createElement("div");
    el.className = GHOST_CLASS;
    el.textContent = `${count} items`;
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
    void el.offsetWidth;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    event.dataTransfer.setDragImage(el, Math.round(w / 2), Math.round(h / 2));
    requestAnimationFrame(() => {
        el.remove();
    });
}
