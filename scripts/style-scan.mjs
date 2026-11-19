/**
 * Shared scanning primitives for the style ratchet and codemod.
 *
 * Both tools inspect string and template literals in shipped renderer sources. TypeScript's parser
 * distinguishes those literals from comments, JSX text, regular expressions and identifiers while
 * preserving source offsets for the codemod.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

/** Patterns the design-system consolidation is retiring. See docs/design-system.md. */
export const METRICS = {
    "arbitrary-hex": /\[#[0-9a-fA-F]{3,8}\]/g,
    "raw-neutral-palette": /\b(?:bg|text|border|ring|divide|from|via|to)-(?:gray|slate|zinc|neutral|stone)-\d/g,
    "raw-white-black-alpha": /\b(?:bg|text|border|ring|divide|shadow|from|via|to)-(?:white|black)\/\d/g,
    "arbitrary-px-font": /text-\[\d+px\]/g,
    "bare-or-arbitrary-rounded": /\brounded(?![-\w])|rounded-\[/g,
    "raw-accent": /#40a8c4|\b(?:bg|text|border|ring)-cyan-\d/gi,
};

/** Collect shipped renderer sources; test fixtures and generated build output are not UI code. */
export function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        if (name === "dist" || name === "node_modules" || name === "__tests__") continue;
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(name) && !/\.(?:test|spec)\.tsx?$/.test(name)) out.push(full);
    }
    return out;
}

/** Retain literal source text, blanking all other characters without changing offsets. */
export function styleLiterals(src, file = "source.tsx") {
    const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const source = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
    const out = src.split("").map(character => character === "\n" ? "\n" : " ");
    function visit(node) {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ||
            node.kind === ts.SyntaxKind.TemplateHead || node.kind === ts.SyntaxKind.TemplateMiddle ||
            node.kind === ts.SyntaxKind.TemplateTail) {
            for (let index = node.getStart(source); index < node.end; index += 1) out[index] = src[index];
        }
        ts.forEachChild(node, visit);
    }
    visit(source);
    return out.join("");
}

/** Read a file and return its original source and offset-aligned literal mask. */
export function readCode(file) {
    const src = readFileSync(file, "utf8");
    return { src, styles: styleLiterals(src, file) };
}
