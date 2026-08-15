/**
 * Put text on the clipboard, with a fallback for contexts where the async API is unavailable.
 *
 * Shared rather than Studio-only because both crash screens need it, and they are the callers it
 * was written for: on a screen that only exists because something failed, "select it yourself" is
 * not an answer, since the error text is the one thing the reader has to hand to somebody else.
 * The fallback is what makes it work in the game runtime, whose documents are not served over
 * https and therefore may not get the async clipboard at all.
 */
export async function copyTextToClipboard(text: string): Promise<void> {
    const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : null;
    if (clipboard?.writeText) {
        await clipboard.writeText(text);
        return;
    }

    if (typeof document === "undefined") {
        throw new Error("Clipboard API is not available.");
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    try {
        textarea.select();
        if (!document.execCommand("copy")) {
            throw new Error("Copy command was rejected.");
        }
    } finally {
        document.body.removeChild(textarea);
    }
}
