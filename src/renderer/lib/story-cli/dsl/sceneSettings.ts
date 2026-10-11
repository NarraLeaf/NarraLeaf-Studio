/**
 * The scene's own settings, as header directives: `#background` and `#music`.
 *
 * A scene carries two things no row does - the background it opens on
 * (`StoryScene.defaultBackgroundAssetId`) and the music it opens with (`StoryScene.bgm`). The engine
 * puts both up as part of the scene's own init, before the first row runs. Until these directives
 * existed a `.story` file could neither show them nor change them, and that is how a reused demo
 * scene kept opening on the skeleton's classroom for a beat before the file's own `/bg` row - in a
 * train game - with nothing in `story show` to say where the picture came from.
 *
 * ## The grammar
 *
 *     #background <image>          the image by name ('quoted' when it has spaces), or by id
 *     #background none             the scene opens on no background of its own
 *     #music <audio> [track=<audio track>] [vol=0.8] [fade=1.2s] [loop=false]
 *     #music none
 *
 * `#music` says its settings the way a `/bgm` row says the same four, in the row's order: `vol=`, and
 * `fade=` in seconds with the unit (`projectStoryCommandLine` prints rows; the formatting below is the
 * one it uses). A header and a row read side by side therefore say one thing one way. Files printed
 * before that wrote `volume=` and a bare fade in milliseconds; both still read - the bare fade with a
 * warning, because the same number in a row would be seconds. A fade the file leaves as printed is the
 * stored one, even when the store holds float noise the print rounded away.
 *
 * A key left out of `#music` is left out of the record, which is what lets the track's own defaults
 * answer - the same rule the scene panel follows. A bare `none` clears; `'none'` in quotes is an asset
 * that happens to be called that.
 *
 * Both count only in the header: before the first row, at the start of the line. Further down, or
 * indented, a `#background` / `#music` line is the comment every unknown `#` line has always been,
 * and the parser warns that it changes nothing.
 *
 * ## A directive the file leaves out changes nothing
 *
 * Unlike rows, which a file lists in full. `story show` always writes both, so a file printed and
 * edited carries them; a file written from nothing that does not say them leaves the scene's
 * settings as they are - and `apply` says that it did, naming what the scene still opens on. The
 * opposite rule would let any file made before these directives existed silently strip a scene's
 * music.
 *
 * Comments in English per project convention.
 */

import type { StoryScene, StorySceneBgm } from "@shared/types/story";
import type { StoryCommandContext, StoryCommandNamedRef } from "@/apps/workspace/modules/story/scene-editor/storyCommandValues";
import { formatStorySecondsLabel, storySecondsToMs } from "@shared/utils/storyTime";
import { errorAt, warningAt, type StoryFileDiagnostic } from "./ast";
import { sameValue } from "./equal";

export const DIRECTIVE_BACKGROUND = "#background";
export const DIRECTIVE_MUSIC = "#music";
/** What a directive says to clear its setting. */
export const SETTING_NONE = "none";

/** A scene-setting directive as read: its text after the name, and where it was. */
export type SceneSettingDirective = { value: string; line: number };

export type SceneSettingsAst = {
    background?: SceneSettingDirective;
    music?: SceneSettingDirective;
};

/** The lookups a setting resolves against: a slice of the command context. */
export type SceneSettingsLookups = Pick<StoryCommandContext, "images" | "audio" | "audioTracks">;

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/**
 * A name as a directive writes it: bare, or in single quotes when it has spaces - the way
 * `story targets` and a command line write a name - and in JSON double quotes when it holds a
 * single quote itself.
 */
function quoteIfNeeded(name: string): string {
    if (/^[^\s"'=]+$/.test(name) && name.toLowerCase() !== SETTING_NONE) {
        return name;
    }
    return name.includes("'") ? JSON.stringify(name) : `'${name}'`;
}

/** Split on spaces, keeping `'…'`, `"…"` (JSON string escapes) and `key='…'` as one token each. */
function tokenize(text: string): string[] | null {
    const tokens: string[] = [];
    let index = 0;
    while (index < text.length) {
        if (/\s/.test(text[index])) {
            index += 1;
            continue;
        }
        let token = "";
        while (index < text.length && !/\s/.test(text[index])) {
            if (text[index] === "'") {
                const end = text.indexOf("'", index + 1);
                if (end < 0) {
                    return null;
                }
                token += text.slice(index + 1, end);
                index = end + 1;
                continue;
            }
            if (text[index] === "\"") {
                const end = closingQuote(text, index);
                if (end < 0) {
                    return null;
                }
                try {
                    token += JSON.parse(text.slice(index, end + 1)) as string;
                } catch {
                    return null;
                }
                index = end + 1;
                continue;
            }
            token += text[index];
            index += 1;
        }
        tokens.push(token);
    }
    return tokens;
}

function closingQuote(text: string, open: number): number {
    for (let index = open + 1; index < text.length; index += 1) {
        if (text[index] === "\\") {
            index += 1;
            continue;
        }
        if (text[index] === "\"") {
            return index;
        }
    }
    return -1;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** The name a setting is printed by: the asset's own, or its id when the name does not say which. */
function nameFor(id: string, entries: readonly StoryCommandNamedRef[]): string {
    const entry = entries.find(candidate => candidate.id === id);
    if (!entry) {
        return id;
    }
    const sameName = entries.filter(candidate => candidate.name.trim().toLowerCase() === entry.name.trim().toLowerCase());
    return sameName.length === 1 && entry.name.trim() !== "" ? entry.name : id;
}

/** By id first, then by name, case-insensitively; an ambiguous name is refused rather than guessed. */
function resolveName(raw: string, entries: readonly StoryCommandNamedRef[]): StoryCommandNamedRef | "ambiguous" | null {
    const byId = entries.find(entry => entry.id === raw);
    if (byId) {
        return byId;
    }
    const needle = raw.trim().toLowerCase();
    const matches = entries.filter(entry => entry.name.trim().toLowerCase() === needle
        || (entry.aliases ?? []).some(alias => alias.trim().toLowerCase() === needle));
    if (matches.length === 0) {
        return null;
    }
    return matches.length > 1 ? "ambiguous" : matches[0];
}

/** What the scene opens on, by name - for `apply`'s summary and `story targets`. Null when nothing. */
export function describeSceneSettings(
    scene: StoryScene,
    lookups: SceneSettingsLookups,
): { background: string | null; music: string | null } {
    return {
        background: scene.defaultBackgroundAssetId ? nameFor(scene.defaultBackgroundAssetId, lookups.images) : null,
        music: scene.bgm?.assetId ? nameFor(scene.bgm.assetId, lookups.audio) : null,
    };
}

// ---------------------------------------------------------------------------
// Print
// ---------------------------------------------------------------------------

/** The two directive lines for `scene`, always both: see the note on leaving one out. */
export function printSceneSettings(scene: StoryScene, lookups: SceneSettingsLookups): string[] {
    const background = scene.defaultBackgroundAssetId
        ? quoteIfNeeded(nameFor(scene.defaultBackgroundAssetId, lookups.images))
        : SETTING_NONE;
    return [`${DIRECTIVE_BACKGROUND} ${background}`, `${DIRECTIVE_MUSIC} ${printMusic(scene.bgm, lookups)}`];
}

function printMusic(bgm: StorySceneBgm | undefined, lookups: SceneSettingsLookups): string {
    if (!bgm?.assetId) {
        return SETTING_NONE;
    }
    // The `/bgm` row's words, values and order - see the note at the top.
    const parts = [quoteIfNeeded(nameFor(bgm.assetId, lookups.audio))];
    if (bgm.audioTrackId) {
        parts.push(`track=${quoteIfNeeded(nameFor(bgm.audioTrackId, lookups.audioTracks))}`);
    }
    if (bgm.volume !== undefined) {
        parts.push(`vol=${String(bgm.volume)}`);
    }
    if (bgm.fadeMs !== undefined && Number.isFinite(bgm.fadeMs)) {
        // Seconds to the millisecond, as a row prints them: the scene panel stores seconds times a
        // thousand, so a stored fade can carry float noise (2009.9999999999998) that no one typed and
        // the reader below folds back into the stored value.
        parts.push(`fade=${formatStorySecondsLabel(bgm.fadeMs)}`);
    }
    if (bgm.loop !== undefined) {
        parts.push(`loop=${String(bgm.loop)}`);
    }
    return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

/**
 * `scene` with the settings the file states. A directive the file leaves out leaves its setting
 * alone; a directive that does not resolve is an error and leaves it alone too.
 */
export function applySceneSettings(
    scene: StoryScene,
    settings: SceneSettingsAst,
    lookups: SceneSettingsLookups,
): { scene: StoryScene; diagnostics: StoryFileDiagnostic[] } {
    const diagnostics: StoryFileDiagnostic[] = [];
    let next = scene;
    if (settings.background) {
        const background = readBackground(settings.background, lookups, scene.defaultBackgroundAssetId, diagnostics);
        if (background !== undefined) {
            next = withBackground(next, background);
        }
    }
    if (settings.music) {
        const music = readMusic(settings.music, lookups, scene.bgm, diagnostics);
        if (music !== undefined) {
            next = withMusic(next, music);
        }
    }
    return { scene: next, diagnostics };
}

function withBackground(scene: StoryScene, assetId: string | null): StoryScene {
    if ((scene.defaultBackgroundAssetId ?? null) === assetId) {
        return scene;
    }
    const { defaultBackgroundAssetId: _cleared, ...rest } = scene;
    return assetId ? { ...rest, defaultBackgroundAssetId: assetId } : rest;
}

function withMusic(scene: StoryScene, bgm: StorySceneBgm | null): StoryScene {
    // By value: the record a file reads back has its keys in the reader's order, the stored one in
    // whatever order the scene panel spread them, and an unedited line is not a change.
    if (sameValue(scene.bgm ?? null, bgm)) {
        return scene;
    }
    const { bgm: _cleared, ...rest } = scene;
    return bgm ? { ...rest, bgm } : rest;
}

/** The image id, null for `none`, undefined when the directive was refused. */
function readBackground(
    directive: SceneSettingDirective,
    lookups: SceneSettingsLookups,
    current: string | undefined,
    diagnostics: StoryFileDiagnostic[],
): string | null | undefined {
    if (directive.value.trim().toLowerCase() === SETTING_NONE) {
        return null;
    }
    const tokens = tokenize(directive.value);
    if (!tokens || tokens.length !== 1) {
        diagnostics.push(errorAt(
            "file.bad_setting",
            `${DIRECTIVE_BACKGROUND} takes one image name (quoted when it has spaces) or "${SETTING_NONE}".`,
            directive.line,
        ));
        return undefined;
    }
    return resolveOrReport(tokens[0], lookups.images, "image", current, DIRECTIVE_BACKGROUND, directive.line, diagnostics);
}

/** The music record, null for `none`, undefined when the directive was refused. */
function readMusic(
    directive: SceneSettingDirective,
    lookups: SceneSettingsLookups,
    current: StorySceneBgm | undefined,
    diagnostics: StoryFileDiagnostic[],
): StorySceneBgm | null | undefined {
    if (directive.value.trim().toLowerCase() === SETTING_NONE) {
        return null;
    }
    const tokens = tokenize(directive.value);
    if (!tokens || tokens.length === 0) {
        diagnostics.push(errorAt(
            "file.bad_setting",
            `${DIRECTIVE_MUSIC} takes an audio name (quoted when it has spaces) and optional track=, vol=, fade=, loop=, or "${SETTING_NONE}".`,
            directive.line,
        ));
        return undefined;
    }
    const refuse = (message: string): undefined => {
        diagnostics.push(errorAt("file.bad_setting", message, directive.line));
        return undefined;
    };
    const assetId = resolveOrReport(tokens[0], lookups.audio, "audio clip", current?.assetId, DIRECTIVE_MUSIC, directive.line, diagnostics);
    if (assetId === undefined) {
        return undefined;
    }
    const bgm: StorySceneBgm = { assetId };
    for (const token of tokens.slice(1)) {
        const equals = token.indexOf("=");
        const key = equals < 0 ? token : token.slice(0, equals);
        const value = equals < 0 ? "" : token.slice(equals + 1);
        switch (key) {
            case "track": {
                const trackId = resolveOrReport(value, lookups.audioTracks, "audio track", current?.audioTrackId, DIRECTIVE_MUSIC, directive.line, diagnostics);
                if (trackId === undefined) {
                    return undefined;
                }
                bgm.audioTrackId = trackId;
                break;
            }
            // `vol=` is the row's word; `volume=` is what the first build of this directive printed,
            // and a `/bgm` row accepts it too.
            case "vol":
            case "volume": {
                const volume = Number(value);
                if (value === "" || !Number.isFinite(volume) || volume < 0 || volume > 1) {
                    return refuse(`${DIRECTIVE_MUSIC} ${key}= takes a number from 0 to 1, not "${value}".`);
                }
                bgm.volume = volume;
                break;
            }
            case "loop": {
                // A bare `loop` is `loop=true`, as on a row.
                if (equals < 0) {
                    bgm.loop = true;
                    break;
                }
                if (value !== "true" && value !== "false") {
                    return refuse(`${DIRECTIVE_MUSIC} loop= takes true or false, not "${value}".`);
                }
                bgm.loop = value === "true";
                break;
            }
            case "fade": {
                const fade = readFade(value);
                if (!fade) {
                    return refuse(`${DIRECTIVE_MUSIC} fade= takes seconds with the unit, the way a row writes them (fade=1.2s), not "${value}".`);
                }
                bgm.fadeMs = keptFade(fade.ms, current?.fadeMs);
                if (fade.bare) {
                    const label = formatStorySecondsLabel(fade.ms);
                    diagnostics.push(warningAt(
                        "file.setting_milliseconds",
                        `${DIRECTIVE_MUSIC} fade=${value} has no unit, so it is read as milliseconds: ${label}. That is the `
                            + `older spelling; rows and "story show" write seconds with the unit - fade=${label}.`,
                        directive.line,
                    ));
                }
                break;
            }
            default:
                return refuse(`"${token}" is not a ${DIRECTIVE_MUSIC} setting. It takes track=, vol=, fade= and loop=.`);
        }
    }
    return bgm;
}

/** The unit a row writes a fade in, and the one `fade=` is printed with. */
const SECONDS_UNIT = "s";

/**
 * A `fade=` value in milliseconds: `1.2s` is seconds, as a row writes it; a bare number is
 * milliseconds, as files printed before that wrote it (`bare`). Null when it is neither, or negative.
 */
function readFade(value: string): { ms: number; bare: boolean } | null {
    const bare = !value.endsWith(SECONDS_UNIT);
    const digits = bare ? value : value.slice(0, -SECONDS_UNIT.length);
    const amount = Number(digits);
    if (digits.trim() === "" || !Number.isFinite(amount) || amount < 0) {
        return null;
    }
    return { ms: bare ? amount : storySecondsToMs(amount), bare };
}

/**
 * The fade to store for one read from the file: whole milliseconds, unless it is the fade the scene
 * already holds to the millisecond the file prints - then the stored value, float noise and all, so
 * printing a scene and applying it untouched is never a change.
 */
function keptFade(read: number, current: number | undefined): number {
    if (current !== undefined && Number.isFinite(current) && Math.round(read) === Math.round(current)) {
        return current;
    }
    return Math.round(read);
}

/**
 * `current` is the id the scene holds now. It is taken back as written even when nothing answers to
 * it - an asset since deleted prints as its id - so a file that leaves the setting as it was never
 * fails over it; changing it is what has to name something real.
 */
function resolveOrReport(
    raw: string,
    entries: readonly StoryCommandNamedRef[],
    kind: string,
    current: string | undefined,
    directive: string,
    line: number,
    diagnostics: StoryFileDiagnostic[],
): string | undefined {
    if (current !== undefined && raw === current) {
        return current;
    }
    const found = resolveName(raw, entries);
    if (found === "ambiguous") {
        diagnostics.push(errorAt(
            "file.bad_setting",
            `${directive}: more than one ${kind} is named "${raw}". Rename one, or write the id "story targets" lists.`,
            line,
        ));
        return undefined;
    }
    if (!found) {
        diagnostics.push(errorAt(
            "file.bad_setting",
            `${directive}: no ${kind} is named "${raw}". "story targets" lists the names.`,
            line,
        ));
        return undefined;
    }
    return found.id;
}
