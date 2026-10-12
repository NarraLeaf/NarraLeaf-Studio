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
 * ## What it refuses over
 *
 * The file layer's errors are always this file's doing, so any of them stops the write. The document
 * layer's are not: the project linter reads the whole project, and it has plenty to say about scenes
 * this file has never seen. So the linter is run twice - over the project as it stands, and over the
 * project with this scene substituted in - and only the difference stops the write. See
 * {@link findingsIntroduced}.
 *
 * ## What it never touches
 *
 * The scene's own metadata - its snapshots, its launch entries - and everything outside the scene.
 * The file's rows replace the rows; nothing else about the document moves. The two settings a file
 * CAN state, the background and the music the scene opens on, change only when the file states
 * them (`#background`, `#music`; see `dsl/sceneSettings.ts`), and one the file leaves out is named
 * in the summary as kept, because it is still on screen before the first row. A scene RENAME is
 * reported rather than applied, because renaming a scene is a document-wide act (every jump that
 * names it, the scene list, the version history's idea of what moved) and this writes one field.
 *
 * Comments in English per project convention.
 */

import type { StoryBlockId, StoryDocument, StoryScene } from "@shared/types/story";
import type { StoryFileDiagnostic } from "./dsl/ast";
import { sameRowContent, sameValue } from "./dsl/equal";
import type { KeyedLintFinding } from "./check";

export type ApplySummary = {
    /** Rows the file carries that the scene did not. */
    added: number;
    /** Rows in both, whose content the file changed. */
    changed: number;
    /** Rows the scene had that the file does not mention. Applying deletes these. */
    removed: { id: StoryBlockId; description: string }[];
    /** True when the file's header names the scene something else. Reported, never applied. */
    renamedTo: string | null;
    /** Scene settings the file changed, by name (null = none). */
    settingsChanged: SceneSettingChange[];
    /** Scene settings the file did not state and the scene still has, by name. */
    settingsKept: { setting: SceneSettingName; value: string }[];
};

export type SceneSettingName = "background" | "music";
export type SceneSettingChange = { setting: SceneSettingName; from: string | null; to: string | null };

/** The scene's two settings by name, before and after, and which ones the file stated. */
export type SceneSettingsComparison = {
    before: Record<SceneSettingName, string | null>;
    after: Record<SceneSettingName, string | null>;
    stated: Record<SceneSettingName, boolean>;
};

export function summariseApply(
    existing: StoryScene,
    next: StoryScene,
    describe: (blockId: StoryBlockId) => string,
    settings?: SceneSettingsComparison,
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
    const settingsChanged: SceneSettingChange[] = [];
    const settingsKept: { setting: SceneSettingName; value: string }[] = [];
    if (settings) {
        const changedSettings: Record<SceneSettingName, boolean> = {
            background: (existing.defaultBackgroundAssetId ?? null) !== (next.defaultBackgroundAssetId ?? null),
            // By value, as `withMusic` decides it: key order is the scene panel's or the reader's.
            music: !sameValue(existing.bgm ?? null, next.bgm ?? null),
        };
        for (const setting of ["background", "music"] as const) {
            if (changedSettings[setting]) {
                settingsChanged.push({ setting, from: settings.before[setting], to: settings.after[setting] });
            } else if (!settings.stated[setting] && settings.after[setting] !== null) {
                settingsKept.push({ setting, value: settings.after[setting]! });
            }
        }
    }
    return {
        added,
        changed,
        removed,
        renamedTo: next.name !== existing.name ? next.name : null,
        settingsChanged,
        settingsKept,
    };
}

export type IntroducedFindings = {
    /** Findings the edit adds, which are the only document-layer ones a write answers for. */
    introduced: StoryFileDiagnostic[];
    /** How many of the edited project's findings were already there. Counted, never listed. */
    carried: number;
};

/**
 * Which of the edited project's lint findings this edit is responsible for.
 *
 * Two runs of the same rules over almost the same project, compared as multisets of
 * {@link KeyedLintFinding.key}: a key seen more often after the edit than before it has that many
 * new findings, and one seen as often or less has none. Counting rather than set difference is what
 * makes a second finding of one rule on one row visible, and what keeps a finding whose message
 * merely changed from being reported as new.
 *
 * The findings reported are taken from the *after* run, so what is printed is the state the write
 * would leave rather than a description of a project that no longer exists.
 */
export function findingsIntroduced(
    before: readonly KeyedLintFinding[],
    after: readonly KeyedLintFinding[],
): IntroducedFindings {
    const budget = new Map<string, number>();
    for (const finding of before) {
        budget.set(finding.key, (budget.get(finding.key) ?? 0) + 1);
    }
    const introduced: StoryFileDiagnostic[] = [];
    for (const finding of after) {
        const remaining = budget.get(finding.key) ?? 0;
        if (remaining > 0) {
            budget.set(finding.key, remaining - 1);
            continue;
        }
        introduced.push(finding.diagnostic);
    }
    return { introduced, carried: after.length - introduced.length };
}

/** The one line that says the project's own findings were seen and left where they were. */
export function formatCarriedFindings(carried: number): string {
    return carried === 1
        ? "1 finding was already in this project before this file, and is not counted against it. "
            + "`story check --project <dir>` lists it."
        : `${carried} findings were already in this project before this file, and are not counted against it. `
            + "`story check --project <dir>` lists them.";
}

/** The document with the compiled scene in place of its stored copy. Nothing else moves. */
export function applySceneToDocument(document: StoryDocument, scene: StoryScene): StoryDocument {
    return { ...document, scenes: { ...document.scenes, [scene.id]: scene } };
}

/** Put the compiled scene into the document a file holds. The caller writes the file. */
export function applyScene<T extends { document: StoryDocument }>(file: T, scene: StoryScene): T {
    return { ...file, document: applySceneToDocument(file.document, scene) };
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
        lines.push("", written
            ? "These rows were in the scene and not in the file, so they were deleted:"
            : "These rows are in the scene and not in the file, so applying deletes them:");
        for (const row of summary.removed.slice(0, 20)) {
            lines.push(`  ${row.description}`);
        }
        if (summary.removed.length > 20) {
            lines.push(`  ... and ${summary.removed.length - 20} more`);
        }
    }
    const label = (setting: SceneSettingName) => (setting === "background" ? "opening background" : "opening music");
    const shown = (value: string | null) => (value === null ? "none" : `"${value}"`);
    for (const change of summary.settingsChanged) {
        lines.push(
            "",
            `Scene setting: ${label(change.setting)} ${shown(change.from)} -> ${shown(change.to)}`
                + `${written ? "." : " when applied."}`,
        );
    }
    if (summary.settingsKept.length > 0) {
        const kept = summary.settingsKept.map(entry => `${label(entry.setting)} ${shown(entry.value)}`).join(" and ");
        const clears = summary.settingsKept.map(entry => `"#${entry.setting} none"`).join(" / ");
        lines.push(
            "",
            `This scene still opens with ${kept}, before its first row: scene settings, not rows. The file does not `
                + `state them, so they ${written ? "were" : "are"} kept. Write ${clears} in the header to clear them.`,
        );
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
