/**
 * Put text on the clipboard, with a fallback for contexts where the async API is unavailable.
 *
 * Lives next to the diagnostics report because its first caller is the screen shown when the
 * workspace failed to start: on that screen "select it yourself" is not an answer, since the error
 * text is the one thing the user needs to hand to somebody else.
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
