/**
 * Turning a pile of sprite files into poses: which files belong to a character, and what each pose
 * is called.
 *
 * Pure on purpose. The dialog that uses this reads a folder, hashes files and imports them; none of
 * that is needed to decide that `Miki_Seifuku_Frown.png` is Miki's "Seifuku Frown", and the rule is
 * the part an author tunes, so it is the part that has to be easy to test.
 *
 * ## The rule
 *
 * A file name (without its extension) is cut into segments at every separator character and at any
 * run of whitespace. When the name starts with one of the character's prefixes, followed by a
 * separator or nothing at all, the prefix is taken off first. The remaining segments are joined with
 * the joiner. `Miki_Seifuku_Frown` with the prefix `Miki` and the separators `_-` is
 * `Seifuku Frown`.
 *
 * Prefixes are compared without regard to case - `miki_smile.png` is Miki's as well - and must end at
 * a separator, so the prefix `Miki` does not claim `Mikiko_smile.png`. The longest matching prefix
 * wins, so `Miki` and `Miki_Casual` can both be listed and the second keeps its word.
 */

export type PoseNamingJoiner = " " | "_" | "-" | "";

export interface PoseNamingRule {
    /** Name prefixes that mark a file as this character's. Never empty in a rule the dialog builds. */
    prefixes: string[];
    /** Characters a name is cut at, besides whitespace, which always cuts. */
    separators: string;
    /** What the segments are put back together with. */
    joiner: PoseNamingJoiner;
}

export const DEFAULT_POSE_SEPARATORS = "_-";
export const POSE_NAMING_JOINERS: readonly PoseNamingJoiner[] = [" ", "_", "-", ""];

export function defaultPoseNamingRule(characterName: string): PoseNamingRule {
    const name = characterName.trim();
    return { prefixes: name ? [name] : [], separators: DEFAULT_POSE_SEPARATORS, joiner: " " };
}

/** A stored rule made safe to use: unknown joiners and blank prefixes dropped, duplicates folded. */
export function normalizePoseNamingRule(rule: Partial<PoseNamingRule> | null | undefined, characterName: string): PoseNamingRule {
    const fallback = defaultPoseNamingRule(characterName);
    if (!rule || typeof rule !== "object") {
        return fallback;
    }
    const prefixes = Array.isArray(rule.prefixes)
        ? uniquePrefixes(rule.prefixes.filter((value): value is string => typeof value === "string"))
        : fallback.prefixes;
    return {
        prefixes: prefixes.length > 0 ? prefixes : fallback.prefixes,
        separators: typeof rule.separators === "string" ? rule.separators : fallback.separators,
        joiner: POSE_NAMING_JOINERS.includes(rule.joiner as PoseNamingJoiner) ? rule.joiner as PoseNamingJoiner : fallback.joiner,
    };
}

/** Trimmed, blank ones dropped, and one entry per spelling regardless of case. */
export function uniquePrefixes(prefixes: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of prefixes) {
        const prefix = raw.trim();
        const key = prefix.toLowerCase();
        if (!prefix || seen.has(key)) continue;
        seen.add(key);
        out.push(prefix);
    }
    return out;
}

/** The file name without its folder and its last extension. */
export function fileStem(path: string): string {
    const base = path.split(/[\\/]/).pop() ?? "";
    const dot = base.lastIndexOf(".");
    return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * An image's library name as the rule should read it. A file imported from disk keeps its extension
 * in its library name (`Miki_Smile.png`); `extensions` are the ones taken off, compared without
 * regard to case. A name whose last dot is followed by anything else is left whole, so
 * `Miki.Smile` stays `Miki.Smile`.
 */
export function imageNameStem(name: string, extensions: readonly string[]): string {
    const dot = name.lastIndexOf(".");
    if (dot <= 0) return name;
    const ext = name.slice(dot + 1).toLowerCase();
    return extensions.some(entry => entry.toLowerCase() === ext) ? name.slice(0, dot) : name;
}

function isCut(char: string, separators: string): boolean {
    return /\s/.test(char) || separators.includes(char);
}

/**
 * The prefix `stem` starts with, or null. Case-insensitive, longest first, and only where the prefix
 * ends the name or is followed by a separator.
 */
export function matchPosePrefix(stem: string, rule: Pick<PoseNamingRule, "prefixes" | "separators">): string | null {
    const lower = stem.toLowerCase();
    const candidates = uniquePrefixes(rule.prefixes).sort((a, b) => b.length - a.length);
    for (const prefix of candidates) {
        if (!lower.startsWith(prefix.toLowerCase())) continue;
        const next = stem.charAt(prefix.length);
        if (next === "" || isCut(next, rule.separators)) {
            return prefix;
        }
    }
    return null;
}

/** The segments of `text`, cut at the rule's separators and at whitespace. Empty segments dropped. */
export function splitPoseSegments(text: string, separators: string): string[] {
    const segments: string[] = [];
    let current = "";
    for (const char of text) {
        if (isCut(char, separators)) {
            if (current) segments.push(current);
            current = "";
        } else {
            current += char;
        }
    }
    if (current) segments.push(current);
    return segments;
}

/**
 * The pose name a file gets. A name that is nothing but the prefix (`Miki.png`) keeps the prefix as
 * its name rather than becoming blank.
 */
export function derivePoseName(stem: string, rule: PoseNamingRule): string {
    const prefix = matchPosePrefix(stem, rule);
    const rest = prefix ? stem.slice(prefix.length) : stem;
    const segments = splitPoseSegments(rest, rule.separators);
    if (segments.length > 0) {
        return segments.join(rule.joiner);
    }
    return prefix ?? stem.trim();
}

export interface PoseSource {
    /** Identifies the source within one plan: a file path, or an asset id. */
    key: string;
    /** The name the rule reads: a file name without its extension, or an image's library name. */
    stem: string;
}

export type PoseCandidate<T extends PoseSource = PoseSource> = T & {
    /** The prefix that matched, or null when none did (only possible when not filtering). */
    prefix: string | null;
    /** The derived name, before it is made unique against the character's other poses. */
    name: string;
};

/**
 * The sources that become poses, in a stable order (by name, numbers compared as numbers), each with
 * its derived name. With `filterByPrefix`, a source whose name carries none of the prefixes is left
 * out; without it, every source is kept and a prefix is only taken off where one matches.
 */
export function planPoseSources<T extends PoseSource>(sources: readonly T[], rule: PoseNamingRule, filterByPrefix: boolean): PoseCandidate<T>[] {
    const seen = new Set<string>();
    const out: PoseCandidate<T>[] = [];
    for (const source of sources) {
        if (seen.has(source.key)) continue;
        seen.add(source.key);
        const prefix = matchPosePrefix(source.stem, rule);
        if (filterByPrefix && !prefix) continue;
        out.push({ ...source, prefix, name: derivePoseName(source.stem, rule) });
    }
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    return out.sort((a, b) => collator.compare(a.stem, b.stem) || collator.compare(a.key, b.key));
}

/** {@link planPoseSources} for file paths, keyed by path. */
export function planPoseFiles(paths: readonly string[], rule: PoseNamingRule, filterByPrefix: boolean): PoseCandidate[] {
    return planPoseSources(paths.map(path => ({ key: path, stem: fileStem(path) })), rule, filterByPrefix);
}

/**
 * `names` made distinct from each other and from `taken`, in order: the second `Smile` is `Smile 2`.
 * Compared without regard to case, the way an author reads two pose names as the same.
 */
export function uniquePoseNames(names: readonly string[], taken: readonly string[]): string[] {
    const used = new Set(taken.map(name => name.trim().toLowerCase()));
    return names.map(raw => {
        const base = raw.trim();
        let name = base;
        for (let n = 2; used.has(name.toLowerCase()); n++) {
            name = `${base} ${n}`;
        }
        used.add(name.toLowerCase());
        return name;
    });
}
