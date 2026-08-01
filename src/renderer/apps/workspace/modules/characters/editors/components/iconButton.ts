/**
 * The two class lists every icon button in the character editor uses.
 *
 * One definition rather than one per file: they were copied into `CharacterEditor` and
 * `AvatarSection` separately and had already drifted from the design system's `disabled:opacity-50`
 * in both places at once, which is what a copied constant does.
 *
 * `ICON_BTN_ON` is written out in full rather than as `ICON_BTN + " text-primary"`: two colour
 * utilities in one class list are resolved by stylesheet order, not by the order they are written,
 * so the muted one can win.
 */
export const ICON_BTN =
    "p-1 rounded-md text-fg-muted hover:text-fg hover:bg-fill transition-colors disabled:cursor-not-allowed disabled:opacity-50";

/** The same button, lit — an override is in force, a mode is on. */
export const ICON_BTN_ON =
    "p-1 rounded-md text-primary hover:bg-fill transition-colors disabled:cursor-not-allowed disabled:opacity-50";
