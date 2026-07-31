import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";

/**
 * The extensions Studio's built-in text editor knows how to open.
 *
 * **Not** the list of text files an author may create. Creating respects whatever extension the
 * author types (`plan.md`, `notes.ini`, `data.csv`, `schema.graphql`), because the file is for the
 * team and Studio is not the only thing that will read it. This list only decides which of those
 * files Studio opens in Monaco rather than leaving to the properties panel - a `.psd` in the Other
 * category still has to behave the way it does today.
 */
export const TEXT_EDITABLE_EXTENSIONS: readonly string[] = [
    "txt",
    "md",
    "markdown",
    "ini",
    "cfg",
    "conf",
    "toml",
    "yaml",
    "yml",
    "csv",
    "tsv",
    "log",
    "properties",
    "env",
    "gitignore",
    "xml",
];

const TEXT_EDITABLE_EXTENSION_SET = new Set(TEXT_EDITABLE_EXTENSIONS);

/**
 * Monaco language id per extension. Anything absent falls to `plaintext`, which is a complete
 * answer rather than a gap: a `.log` or a `.csv` has no grammar worth colouring, and inventing one
 * would make the file look like it means something it does not.
 *
 * TOML is deliberately routed to `ini`. Monaco ships no TOML grammar, and INI's - sections,
 * `key = value`, `#` comments - is right for the parts of TOML a plan file uses. The alternative is
 * plaintext, which is strictly less readable and no more honest.
 */
const MONACO_LANGUAGE_BY_EXTENSION: Record<string, string> = {
    md: "markdown",
    markdown: "markdown",
    ini: "ini",
    cfg: "ini",
    conf: "ini",
    properties: "ini",
    env: "ini",
    gitignore: "ini",
    toml: "ini",
    yaml: "yaml",
    yml: "yaml",
    xml: "xml",
};

/**
 * The extension of an asset display name, lowercased and without the dot.
 *
 * Read off the name rather than `Asset.ext` on purpose: `ext` is written at import with
 * `path.extname(...)`, which answers `""` for a dotfile - so a `.gitignore` asset carries no
 * extension at all in its record while its name says exactly what it is.
 */
export function textFileExtension(name: string): string {
    const dot = name.lastIndexOf(".");
    return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function isTextEditableExtension(extension: string): boolean {
    return TEXT_EDITABLE_EXTENSION_SET.has(extension.toLowerCase());
}

/** Whether this asset opens in the built-in text editor. */
export function isTextEditableAsset(asset: Asset): boolean {
    return asset.type === AssetType.Other && isTextEditableExtension(textFileExtension(asset.name));
}

export function monacoLanguageForFileName(name: string): string {
    return MONACO_LANGUAGE_BY_EXTENSION[textFileExtension(name)] ?? "plaintext";
}

export type LineEnding = "LF" | "CRLF";

/**
 * The line ending the document already uses, so saving does not silently convert a colleague's
 * file. A mixed file reports the ending of its majority; an empty one reports the platform default
 * Monaco would insert anyway.
 */
export function detectLineEnding(text: string): LineEnding {
    const crlf = (text.match(/\r\n/g) ?? []).length;
    const lf = (text.match(/\n/g) ?? []).length - crlf;
    if (crlf === 0 && lf === 0) {
        return navigator.platform.startsWith("Win") ? "CRLF" : "LF";
    }
    return crlf > lf ? "CRLF" : "LF";
}
