/**
 * Editor selections on the operating system's clipboard.
 *
 * Studio opens one project per window and every window is its own renderer process, so a clipboard
 * held in a module variable can only ever be pasted back into the window that filled it. The
 * selections an author copies between projects therefore travel on the *system* clipboard, under a
 * private format name that nothing but Studio reads.
 *
 * ## Why the main process owns the write
 *
 * The browser's own route to a private clipboard format is `DataTransfer.setData` inside a `copy`
 * event, which the story editor uses because its copy gesture *is* a `copy` event. The interface
 * editor's is not: copy, cut and paste are keybindings and context-menu rows, and the keybinding
 * dispatcher cancels the keystroke before Chromium would raise a clipboard event at all. A menu row
 * has no such event to begin with. So the payload goes through the main process, which is the only
 * part of Studio holding the platform clipboard.
 *
 * The trade that comes with it: a buffer write replaces the clipboard, so a copy in the interface
 * editor leaves no `text/plain` behind. Nothing is lost that used to be there - before this the
 * editor's copy did not reach the system clipboard at all.
 *
 * ## What may be written
 *
 * Only the formats named here, and only up to {@link STUDIO_CLIPBOARD_MAX_BYTES}. Both limits are
 * enforced in main rather than trusted from the renderer: the channel writes to a surface shared
 * with every other application on the machine, and "whatever a renderer asks for" is not a policy.
 */

/** The editor selections that can travel between windows. One kind, one format name. */
export type StudioClipboardKind = "ui-elements" | "ui-surfaces" | "blueprint-nodes";

/**
 * The private format each kind occupies on the platform clipboard.
 *
 * Registered by name with the OS, so two Studio processes agree on it without arranging anything;
 * an application that does not know the name never sees the data. Changing a name orphans whatever
 * an already-running Studio put on the clipboard, which reads as an empty clipboard - so a rename
 * is a compatibility break rather than a cosmetic one.
 */
export const STUDIO_CLIPBOARD_FORMATS: Record<StudioClipboardKind, string> = {
    "ui-elements": "application/x-narraleaf-ui-elements",
    "ui-surfaces": "application/x-narraleaf-ui-surfaces",
    "blueprint-nodes": "application/x-narraleaf-blueprint-nodes",
};

/**
 * The ceiling on one clipboard payload.
 *
 * A copied selection carries its elements and their blueprints as JSON, never any file's bytes -
 * those travel as a manifest plus a token (`@shared/types/assetTransfer`). Sixteen megabytes is far
 * beyond any selection an author can make and still small enough that a runaway payload cannot make
 * the clipboard unusable for the rest of the desktop.
 */
export const STUDIO_CLIPBOARD_MAX_BYTES = 16 * 1024 * 1024;

/** Whether a value names a clipboard kind this Studio writes. */
export function isStudioClipboardKind(value: unknown): value is StudioClipboardKind {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(STUDIO_CLIPBOARD_FORMATS, value);
}
