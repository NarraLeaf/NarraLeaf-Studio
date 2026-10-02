import type { ConsoleEntry } from "@/lib/workspace/services/core/ConsoleService";

/**
 * The plain-text form of a Console channel, shared by the panel's own export and by
 * Help > Export Logs, so a channel reads the same whichever of the two wrote it.
 */

/** An entry's text with its styling dropped. */
export function consoleEntryText(entry: ConsoleEntry): string {
    return entry.segments.map(segment => segment.text).join("");
}

/** `YYYY-MM-DD HH:MM:SS`, used inside the exported log body. */
export function formatConsoleExportTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Serialize a channel's buffered entries to plain text for export. Every entry is included
 * regardless of the panel's level filter; cleared entries are already gone from the buffer.
 */
export function buildConsoleExportContent(entries: readonly ConsoleEntry[], label: string): string {
    const header = [
        `NarraLeaf Studio ${label} console log`,
        `Exported: ${formatConsoleExportTimestamp(Date.now())}`,
        `Entries: ${entries.length}`,
        "",
    ];
    const lines = entries.map(entry => {
        const time = formatConsoleExportTimestamp(entry.timestamp);
        const level = entry.level.toUpperCase().padEnd(7);
        const source = entry.source ? `[${entry.source}] ` : "";
        return `[${time}] ${level} ${source}${consoleEntryText(entry)}`;
    });
    return [...header, ...lines].join("\n") + "\n";
}
