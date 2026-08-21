import { readFileSync, readdirSync } from "fs";
import { join, relative } from "path";
import { describe, expect, it } from "vitest";

/**
 * Every place that draws a game surface inside Studio has decided what `ui.reduceMotion` does to it.
 *
 * The setting promises to calm Studio and leave the author's own animations alone, and it lands in
 * two halves that cannot see each other: the CSS blanket in styles.css (escaped with
 * `nl-motion-keep`) and the MotionConfig in `lib/renderApp` (escaped with `reducedMotion="never"`).
 * Both halves are opt-out, and neither of them fails loudly — a surface that forgets them keeps
 * rendering, keeps looking right while still, and only misleads once something moves. The UI
 * editor's canvas sat like that for a long time: the fade survived and the movement did not, which
 * reads as "this preset does nothing" rather than as a bug in Studio.
 *
 * So the classification is written down here rather than left to whoever adds the next call site. A
 * new caller of the runtime bridge fails this test until it appears in one of the two lists below,
 * and a caller that drops half of its escape fails too.
 *
 * What this can see is source text, not behaviour: it proves a file makes the claim, not that the
 * claim reaches the right node. The behaviour it stands in for was measured in the real app — a
 * probe element inside the canvas keeps its 500ms `transition-duration` with the setting on, while
 * the same probe in a thumbnail and in Studio's chrome collapses to 0.01ms.
 */

const RENDERER = join(process.cwd(), "src", "renderer");

/** The bridge methods that mount a game surface into a Studio window. */
const BRIDGE_CALLS = [".renderSurface(", ".renderDocumentSurface(", ".renderComponent("];

/** Where the methods are defined; it calls itself, which is not a decision about motion. */
const BRIDGE_SERVICE = "lib/workspace/services/ui-editor/UIRuntimeBridgeService.tsx";

/**
 * Surfaces an author is working ON. These animate under the setting, because a transition somebody
 * is prevented from seeing is one they cannot tune.
 */
const EXEMPT: Record<string, string> = {
    "apps/workspace/modules/ui-editor/editors/UISurfaceEditorTab.tsx":
        "the editing canvas — the page being drawn, and the component editor's root",
    "apps/workspace/modules/blueprint-lite/editors/BlueprintEntryTab.tsx":
        "a blueprint node's element preview — the widget itself, shown where it is wired up",
};

/**
 * Surfaces an author is *picking from*. These stay calm: a panel of thirty cards all moving at once
 * is one of the reasons somebody turns the setting on.
 */
const CALM: Record<string, string> = {
    "apps/workspace/modules/ui-editor/UISurfacesPanel.tsx": "page thumbnails in the UI panel",
    "apps/workspace/modules/ui-editor/panel/ComponentLibraryPanel.tsx": "component library cards",
    "apps/workspace/modules/ui-editor/panel/templates/UITemplateCard.tsx": "template gallery cards",
    "lib/ui-editor/docker/UIEditorDockerBar.tsx": "the docker bar's component strip",
};

/** The playback box in the properties panel, which is not a bridge caller but answers the same question. */
const ANIMATION_PREVIEW = "lib/ui-editor/widget-modules/shared/page-animation/PageAnimationEditor.tsx";

const CSS_ESCAPE = "nl-motion-keep";
const MOTION_ESCAPE = 'reducedMotion="never"';

function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") {
            continue;
        }
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...sourceFiles(path));
        } else if ((entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) && !entry.name.includes(".test.")) {
            out.push(path);
        }
    }
    return out;
}

/**
 * Source with comments removed.
 *
 * The checks below are substring matches, and every file involved explains itself in a comment that
 * names the very class the match looks for. Without this the test is vacuous, and it was: the first
 * version passed with the class deleted from the canvas, because the paragraph explaining the class
 * was still there. Anything that reads a file for a decision has to read the code, not the prose.
 */
function withoutComments(source: string): string {
    let out = "";
    let i = 0;
    let quote: string | null = null;
    while (i < source.length) {
        const ch = source[i];
        if (quote) {
            if (ch === "\\") {
                out += source.slice(i, i + 2);
                i += 2;
                continue;
            }
            if (ch === quote) {
                quote = null;
            }
            out += ch;
            i += 1;
            continue;
        }
        if (ch === "/" && source[i + 1] === "/") {
            const nl = source.indexOf("\n", i);
            i = nl < 0 ? source.length : nl;
            continue;
        }
        if (ch === "/" && source[i + 1] === "*") {
            const close = source.indexOf("*/", i);
            i = close < 0 ? source.length : close + 2;
            continue;
        }
        if (ch === "\"" || ch === "'" || ch === "`") {
            quote = ch;
        }
        out += ch;
        i += 1;
    }
    return out;
}

let cachedCallers: Map<string, string> | null = null;

/** Bridge callers, as renderer-relative POSIX paths, with the source of each. */
function bridgeCallers(): Map<string, string> {
    if (cachedCallers) {
        return cachedCallers;
    }
    const found = new Map<string, string>();
    for (const file of sourceFiles(RENDERER)) {
        const source = readFileSync(file, "utf8");
        if (!BRIDGE_CALLS.some(call => source.includes(call))) {
            continue;
        }
        const key = relative(RENDERER, file).split("\\").join("/");
        if (key === BRIDGE_SERVICE) {
            continue;
        }
        found.set(key, withoutComments(source));
    }
    cachedCallers = found;
    return found;
}

describe("reduce-motion exemptions", () => {
    // Walks the renderer tree, which is slow enough on a loaded machine to overrun vitest's 5s
    // default; a guard that times out is not a guard.
    it("every surface drawn from the runtime bridge has decided about ui.reduceMotion", () => {
        const callers = bridgeCallers();
        const classified = new Set([...Object.keys(EXEMPT), ...Object.keys(CALM)]);

        const unclassified = [...callers.keys()].filter(file => !classified.has(file));
        expect(
            unclassified,
            "New callers of the UI runtime bridge. Decide whether what they draw is being authored "
                + "(add to EXEMPT, and give it both escapes) or being picked from (add to CALM).",
        ).toEqual([]);

        const missing = [...classified].filter(file => !callers.has(file));
        expect(missing, "Listed here but no longer a bridge caller — drop the entry.").toEqual([]);
    }, 60_000);

    it("surfaces being authored escape both halves of the setting", () => {
        const callers = bridgeCallers();
        for (const [file, why] of Object.entries(EXEMPT)) {
            const source = callers.get(file) ?? "";
            // Non-vacuity: if the comment stripper ever desyncs on a quote it would swallow the rest
            // of the file, and every "must contain" below would fail for the wrong reason.
            expect(BRIDGE_CALLS.some(call => source.includes(call)), `${file}: stripped source lost its code`)
                .toBe(true);
            expect(source.includes(CSS_ESCAPE), `${file} (${why}) must pass ${CSS_ESCAPE}`).toBe(true);
            expect(source.includes(MOTION_ESCAPE), `${file} (${why}) must wrap it in ${MOTION_ESCAPE}`).toBe(true);
        }
    }, 60_000);

    it("surfaces being picked from stay calm", () => {
        const callers = bridgeCallers();
        for (const [file, why] of Object.entries(CALM)) {
            const source = callers.get(file) ?? "";
            expect(BRIDGE_CALLS.some(call => source.includes(call)), `${file}: stripped source lost its code`)
                .toBe(true);
            expect(source.includes(CSS_ESCAPE), `${file} (${why}) should stay under the blanket`).toBe(false);
            expect(source.includes(MOTION_ESCAPE), `${file} (${why}) should stay under the blanket`).toBe(false);
        }
    }, 60_000);

    it("the animation playback box escapes both halves", () => {
        const source = withoutComments(readFileSync(join(RENDERER, ANIMATION_PREVIEW), "utf8"));
        expect(source.includes("PageAnimationPreview"), "stripped source lost its code").toBe(true);
        // Both ends of a slide are an empty grid, so a box that only fades has nothing left to show.
        expect(source.includes(CSS_ESCAPE)).toBe(true);
        expect(source.includes(MOTION_ESCAPE)).toBe(true);
    });

    it("the blanket still carves out the escape it is escaped with", () => {
        const css = readFileSync(join(RENDERER, "styles", "styles.css"), "utf8");
        // The blanket is written twice — once for the setting's class, once for the OS media query —
        // because a CSS rule cannot be gated on a custom property's value. Both are selector lists
        // (element, ::before, ::after), and every line of both has to keep the carve-out: one line
        // that lost it would freeze pseudo-element motion inside an exempt surface and nothing else,
        // which is the kind of half-failure nobody traces back to here.
        const settingRules = css.match(/^:root\.nl-studio\.nl-reduce-motion [^\n]*$/gm) ?? [];
        const osRules = css.match(/^\s+:root\.nl-studio :not[^\n]*$/gm) ?? [];

        expect(settingRules.length, "the ui.reduceMotion blanket went missing").toBeGreaterThanOrEqual(3);
        expect(osRules.length, "the prefers-reduced-motion blanket went missing").toBeGreaterThanOrEqual(3);

        for (const rule of [...settingRules, ...osRules]) {
            expect(rule.includes(`.${CSS_ESCAPE}`), `blanket line stopped excluding ${CSS_ESCAPE}: ${rule.trim()}`)
                .toBe(true);
        }
    });
});
