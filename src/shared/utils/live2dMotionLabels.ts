/**
 * What to call a Live2D model's motions in a list: a label made from each motion's file name.
 *
 * The Live2D runtime names a motion by Cubism's own key, `<group>_<index>` (`Idle_0`, `TapBody_0`),
 * and that key is what a story row stores and what the engine plays. It says which group a motion is
 * in and nothing about what it looks like; the file it was exported as usually says more
 * (`haru_m_03.motion3.json`). So a list shows the file's name and keeps the key beside it.
 *
 * Read under the licence `modelImportScan` sets out for reading inside a model: only the text
 * manifest, and only for file names. The key itself is never derived here - it is whatever the
 * runtime reported - so a label only attaches to a name the runtime offered.
 *
 * Comments in English per project convention.
 */

/** The suffixes a motion file is exported with, longest first. */
const MOTION_FILE_SUFFIXES = [".motion3.json", ".json"] as const;

/**
 * Words that say a file is a motion and nothing about which. A label made of these, the group's
 * name and numbers is no better than the key it would replace.
 */
const NAMELESS_WORDS = new Set(["motion", "motions", "mtn", "anim", "animation"]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The words of a name, lower case: split at separators, at case changes and between letters and digits. */
function wordsOf(text: string): string[] {
    return text
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/([A-Za-z])(\d)/g, "$1 $2")
        .replace(/(\d)([A-Za-z])/g, "$1 $2")
        .split(/[\s_\-.]+/)
        .map(word => word.toLowerCase())
        .filter(word => word.length > 0);
}

/**
 * The label for one motion file in `group`, or null when its name says nothing the key does not.
 *
 * `motions/haru_m_03.motion3.json` reads "haru m 03". `Idle_01.motion3.json` in the `Idle` group
 * reads as nothing: it is the group and a number, which `Idle_0` already says.
 */
export function live2dMotionFileLabel(file: string, group: string): string | null {
    const base = file.replace(/\\/g, "/").split("/").pop() ?? "";
    const lower = base.toLowerCase();
    const suffix = MOTION_FILE_SUFFIXES.find(candidate => lower.endsWith(candidate));
    const stem = suffix ? base.slice(0, base.length - suffix.length) : base;
    const label = stem.split(/[\s_\-.]+/).filter(part => part.length > 0).join(" ");
    if (!label) {
        return null;
    }
    const groupWords = new Set([group.toLowerCase(), ...wordsOf(group)]);
    const telling = wordsOf(stem).filter(word => !groupWords.has(word) && !NAMELESS_WORDS.has(word) && !/^\d+$/.test(word));
    return telling.length > 0 ? label : null;
}

/**
 * Labels for the motions a Cubism 3+ manifest (`*.model3.json`) lists, keyed by the runtime's key
 * `<group>_<index>`. A motion whose file name says nothing more than its key has no entry, and a
 * manifest that is not one gives an empty map - the list then shows the keys, as it always has.
 */
export function live2dMotionLabels(manifest: unknown): Record<string, string> {
    const labels: Record<string, string> = {};
    const references = isRecord(manifest) && isRecord(manifest.FileReferences) ? manifest.FileReferences : null;
    const motions = references && isRecord(references.Motions) ? references.Motions : null;
    if (!motions) {
        return labels;
    }
    for (const [group, entries] of Object.entries(motions)) {
        if (!Array.isArray(entries)) {
            continue;
        }
        entries.forEach((entry, index) => {
            const file = isRecord(entry) && typeof entry.File === "string" ? entry.File : "";
            const label = file ? live2dMotionFileLabel(file, group) : null;
            if (label) {
                labels[`${group}_${index}`] = label;
            }
        });
    }
    return labels;
}
