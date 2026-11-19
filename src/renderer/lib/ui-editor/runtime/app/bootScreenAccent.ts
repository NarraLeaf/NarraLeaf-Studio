import { accentForeground } from "@shared/constants/accent";
import { normalizeOpaqueBackgroundColor } from "@shared/utils/gameRuntimeEntrySurface";

/** The indicator ink for an entry surface's opaque background. */
export function bootScreenAccent(background: string): string {
    let color = normalizeOpaqueBackgroundColor(background);
    const doc = typeof document === "undefined" ? undefined : document;
    const view = doc?.defaultView;
    if (color && !color.startsWith("#") && doc?.documentElement && view) {
        // The shell preserves CSS colour names; the browser resolves them without a second name table.
        const probe = doc.createElement("span");
        probe.style.setProperty("color", color, "important");
        probe.style.position = "fixed";
        probe.style.visibility = "hidden";
        doc.documentElement.appendChild(probe);
        try {
            color = normalizeOpaqueBackgroundColor(view.getComputedStyle(probe).color);
        } finally {
            probe.remove();
        }
    }
    // A named colour needs a browsing context; the fallback is the ink used on a dark background.
    return `rgb(${accentForeground(color?.startsWith("#") ? color : "#000000")})`;
}
