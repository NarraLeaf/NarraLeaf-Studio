/**
 * `apply` - the compiled scene back into `storydoc.json`.
 *
 * Written the way `StoryService` writes it, two-space JSON, so a file this tool leaves and a file
 * Studio leaves are the same shape and version control sees one change rather than a reformat.
 *
 * ## What a scene loses
 *
 * A file describes the WHOLE scene, so applying it deletes every row the file does not mention -
 * the same bargain `.bp` and `.ui` strike, and the reason `show` writes an opaque line for a row it
 * cannot spell rather than leaving it out. {@link summariseApply} counts what is going before it
 * happens, so a file that lost a hundred rows to a bad edit says so rather than being written.
 *
 * ## What it never touches
 *
 * The scene's own metadata - its snapshot, its BGM, its launch entries - and everything outside the
 * scene. The file's rows replace the rows; nothing else about the document moves. A scene RENAME is
 * reported rather than applied, because renaming a scene is a document-wide act (every jump that
 * names it, the scene list, the version history's idea of what moved) and this writes one field.
 *
 * Comments in English per project convention.
 */

import type { StoryBlockId, StoryScene } from "@shared/types/story";
import { sameRowContent } from "./dsl/equal";
import type { StoryDocumentFile } from "./project";

export type ApplySummary = {
    /** Rows the file carries that the scene did not. */
    added: number;
    /** Rows in both, whose content the file changed. */
    changed: number;
    /** Rows the scene had that the file does not mention. Applying deletes these. */
    removed: { id: StoryBlockId; description: string }[];
    /** True when the file's header names the scene something else. Reported, never applied. */
    renamedTo: string | null;
};

export function summariseApply(
    existing: StoryScene,
    next: StoryScene,
    describe: (blockId: StoryBlockId) => string,
): ApplySummary {
    const before = existing.blocks ?? {};
    const after = next.blocks ?? {};
    let added = 0;
    let changed = 0;
    for (const [id, block] of Object.entries(after)) {
        const previous = before[id];
        if (!previous) {
            added += 1;
            continue;
        }
        // Content, not placement: moving a row or re-hanging it under another parent changes the
        // tree and not the row, and counting those as changes would make every re-order look like a
        // rewrite of the scene.
        if (!sameRowContent(previous, block)) {
            changed += 1;
        }
    }
    const removed = Object.keys(before)
        .filter(id => !after[id])
        .map(id => ({ id, description: describe(id) }));
    return {
        added,
        changed,
        removed,
        renamedTo: next.name !== existing.name ? next.name : null,
    };
}

/** Put the compiled scene into the document. The caller writes the file. */
export function applyScene(file: StoryDocumentFile, scene: StoryScene): StoryDocumentFile {
    return {
        ...file,
        document: {
            ...file.document,
            scenes: { ...file.document.scenes, [scene.id]: scene },
        },
    };
}

export function formatApplySummary(summary: ApplySummary, written: boolean): string {
    const lines: string[] = [];
    const counts = [
        summary.added > 0 ? `${summary.added} added` : null,
        summary.changed > 0 ? `${summary.changed} changed` : null,
        summary.removed.length > 0 ? `${summary.removed.length} deleted` : null,
    ].filter(Boolean);
    lines.push(counts.length > 0 ? `Rows: ${counts.join(", ")}.` : "No row changed.");
    if (summary.removed.length > 0) {
        lines.push("", "These rows are in the scene and not in the file, so applying deletes them:");
        for (const row of summary.removed.slice(0, 20)) {
            lines.push(`  ${row.description}`);
        }
        if (summary.removed.length > 20) {
            lines.push(`  ... and ${summary.removed.length - 20} more`);
        }
    }
    if (summary.renamedTo) {
        lines.push(
            "",
            `The file names this scene "${summary.renamedTo}". That is not applied: renaming a scene moves `
                + "every jump that names it, so it is done in Studio.",
        );
    }
    lines.push("", written ? "Written." : "Nothing written. Pass --write.");
    return lines.join("\n");
}
