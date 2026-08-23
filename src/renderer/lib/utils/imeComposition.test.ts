import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { isImeKeyEvent, guardImeKeys } from "./imeComposition";

function keyEvent(init: { key: string; isComposing?: boolean; keyCode?: number }) {
    return { nativeEvent: { isComposing: false, keyCode: 0, ...init } } as unknown as React.KeyboardEvent;
}

describe("isImeKeyEvent", () => {
    it("passes ordinary typing through", () => {
        expect(isImeKeyEvent(keyEvent({ key: "Enter" }))).toBe(false);
    });

    it("claims keys the composition is using", () => {
        expect(isImeKeyEvent(keyEvent({ key: "Enter", isComposing: true }))).toBe(true);
        expect(isImeKeyEvent(keyEvent({ key: "Escape", isComposing: true }))).toBe(true);
    });

    it("claims the legacy 229 some layouts still send", () => {
        expect(isImeKeyEvent(keyEvent({ key: "Process", keyCode: 229 }))).toBe(true);
    });

    it("reads a native event as well as a synthetic one", () => {
        expect(isImeKeyEvent({ isComposing: true, keyCode: 229 } as unknown as KeyboardEvent)).toBe(true);
    });
});

describe("guardImeKeys", () => {
    it("keeps undefined undefined so the DOM prop stays absent", () => {
        expect(guardImeKeys(undefined)).toBeUndefined();
    });

    it("withholds composing keys from the wrapped handler", () => {
        const seen: string[] = [];
        const guarded = guardImeKeys<HTMLInputElement>(event => seen.push(event.nativeEvent.key));
        guarded!(keyEvent({ key: "Enter", isComposing: true }) as React.KeyboardEvent<HTMLInputElement>);
        guarded!(keyEvent({ key: "Enter" }) as React.KeyboardEvent<HTMLInputElement>);
        expect(seen).toEqual(["Enter"]);
    });
});

const RENDERER = join(process.cwd(), "src", "renderer");

function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === "dist" || entry === "node_modules") {
                continue;
            }
            out.push(...sourceFiles(full));
            continue;
        }
        if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) {
            out.push(full);
        }
    }
    return out;
}

/** The whole of a JSX opening tag starting at `from`, braces balanced. */
function openingTag(src: string, from: number): string | null {
    let depth = 0;
    for (let i = from; i < src.length; i++) {
        const c = src[i];
        if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === ">" && depth === 0) return src.slice(from, i);
        else if (c === "<" && i > from && depth === 0) return null;
    }
    return null;
}

/**
 * True when a handler acts on a key the candidate window needs and never asks whose it is.
 * A handler that only stops propagation, or only reads a modifier chord, has nothing to guard.
 */
function claimsImeKeys(body: string): boolean {
    if (/isImeKeyEvent/.test(body)) return false;
    return /"(Enter|Escape|Tab|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)"/.test(body);
}

/** The text of the `onKeyDown={...}` expression in `tag`, braces balanced. */
function keyDownExpression(tag: string): string | null {
    const at = tag.search(/onKeyDown=\{/);
    if (at < 0) return null;
    const start = tag.indexOf("{", at);
    let depth = 0;
    for (let i = start; i < tag.length; i++) {
        if (tag[i] === "{") depth++;
        else if (tag[i] === "}" && --depth === 0) return tag.slice(start + 1, i);
    }
    return tag.slice(start + 1);
}

/**
 * Every `<input>`, `<textarea>` and contentEditable in the renderer that handles keys has to let a
 * composing input method have Enter, Escape and the arrows first. This walks the source rather than
 * the DOM because the bug is invisible without a Japanese IME on the machine running the tests: the
 * field looks fine in Latin, and only a conversion being confirmed reveals that the handler took
 * the keystroke. Handlers reached through `Input`, `TextArea` or `EnhancedInput` are guarded by
 * those components and are not flagged here.
 */
describe("text fields guard IME composition", () => {
    it("has no key handler on a raw text field that ignores composition", () => {
        const unguarded: string[] = [];
        for (const file of sourceFiles(RENDERER)) {
            const src = readFileSync(file, "utf8");
            const rel = relative(process.cwd(), file).split(sep).join("/");
            const tags = /<(input|textarea|div|span|p)\b/g;
            let m: RegExpExecArray | null;
            while ((m = tags.exec(src))) {
                const tag = openingTag(src, m.index);
                if (!tag) continue;
                const editable = m[1] === "input" || m[1] === "textarea" || /contentEditable/.test(tag);
                if (!editable) continue;
                const expression = keyDownExpression(tag);
                if (expression === null) continue;
                const line = src.slice(0, m.index).split("\n").length;
                if (/=>/.test(expression)) {
                    if (claimsImeKeys(expression)) unguarded.push(`${rel}:${line} <${m[1]}> inline handler`);
                    continue;
                }
                // A named handler: the definition has to open with the guard.
                const name = expression.trim().split(".").pop()!;
                const defined = [`const ${name} `, `const ${name}=`, `function ${name}(`]
                    .map(needle => src.indexOf(needle))
                    .filter(at => at >= 0)
                    .sort((a, b) => a - b)[0];
                if (defined === undefined) continue;
                const body = src.slice(defined, defined + 2000);
                if (claimsImeKeys(body)) unguarded.push(`${rel}:${line} <${m[1]}> ${name}`);
            }
        }
        expect(unguarded).toEqual([]);
    });
});
