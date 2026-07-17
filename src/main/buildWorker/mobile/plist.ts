/**
 * Info.plist patcher for the iOS repack. Pure: string in → string out, no fs.
 *
 * The shell template ships a plain-text (XML) Info.plist — the template CI
 * asserts that shape (`plutil -lint`) — so the repack rewrites values in place
 * rather than re-encoding a binary plist. Only a fixed set of top-level keys
 * is touched: the bundle identity, the two version strings, and the
 * orientation whitelist. Every other byte of the document is preserved, and
 * nested dictionaries (e.g. CFBundleIcons, whose PNG *files* the zip layer
 * swaps) are never entered.
 *
 * Values are located structurally — the immediate children of the root
 * <dict>, tracking nesting depth so a key of the same name inside a nested
 * dict is not mistaken for the top-level one — not by blind text replacement.
 */

const ORIENTATION_VALUES: Record<"landscape" | "portrait" | "auto", string[]> = {
    landscape: ["UIInterfaceOrientationLandscapeLeft", "UIInterfaceOrientationLandscapeRight"],
    portrait: ["UIInterfaceOrientationPortrait", "UIInterfaceOrientationPortraitUpsideDown"],
    auto: [
        "UIInterfaceOrientationPortrait",
        "UIInterfaceOrientationPortraitUpsideDown",
        "UIInterfaceOrientationLandscapeLeft",
        "UIInterfaceOrientationLandscapeRight",
    ],
};

const ORIENTATION_KEYS = ["UISupportedInterfaceOrientations", "UISupportedInterfaceOrientations~ipad"];

type Token = { tag: string; isClose: boolean; selfClosing: boolean; start: number; end: number; inner: string };

/** Walk XML tags in order, ignoring comments, PIs, and the doctype. */
function* iterateTags(xml: string): Generator<Token> {
    const tagRe = /<(\/?)([A-Za-z_][\w.:~-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![^>]*>/g;
    let match: RegExpExecArray | null;
    while ((match = tagRe.exec(xml)) !== null) {
        if (match[2] === undefined) {
            continue; // comment / PI / doctype — skipped
        }
        yield {
            tag: match[2],
            isClose: match[1] === "/",
            selfClosing: match[4] === "/",
            start: match.index,
            end: tagRe.lastIndex,
            inner: match[3] ?? "",
        };
    }
}

type ChildValue = {
    /** Tag of the value element (string, array, dict, true, false, …). */
    valueTag: string;
    /** Span of the whole value element, open tag to close tag. */
    start: number;
    end: number;
    selfClosing: boolean;
};

/**
 * Map each immediate child key of the root <dict> to its value element span.
 * plist dicts alternate <key>…</key> then a value element; array/dict values
 * are followed to their matching close via depth counting.
 */
function locateRootChildren(xml: string): Map<string, ChildValue> {
    const tokens = [...iterateTags(xml)];
    const rootDictIndex = tokens.findIndex(token => token.tag === "dict" && !token.isClose);
    if (rootDictIndex < 0) {
        throw new Error("Info.plist has no root <dict>");
    }

    const children = new Map<string, ChildValue>();
    let i = rootDictIndex + 1;
    let pendingKey: string | null = null;
    while (i < tokens.length) {
        const token = tokens[i];
        if (token.tag === "dict" && token.isClose) {
            break; // end of the root dict
        }
        if (token.tag === "key" && !token.isClose) {
            const close = tokens[i + 1];
            if (!close || close.tag !== "key" || !close.isClose) {
                throw new Error("Malformed <key> in Info.plist root dict");
            }
            pendingKey = xml.slice(token.end, close.start);
            i += 2;
            continue;
        }
        // A value element for the pending key.
        if (pendingKey === null) {
            throw new Error(`Info.plist value <${token.tag}> without a preceding <key>`);
        }
        const value = readValueElement(tokens, i, xml);
        children.set(pendingKey, value.child);
        pendingKey = null;
        i = value.nextIndex;
    }
    return children;
}

function readValueElement(tokens: Token[], index: number, xml: string): { child: ChildValue; nextIndex: number } {
    const open = tokens[index];
    if (open.selfClosing) {
        return {
            child: { valueTag: open.tag, start: open.start, end: open.end, selfClosing: true },
            nextIndex: index + 1,
        };
    }
    // Follow to the matching close tag, honoring nested elements of the same tag.
    let depth = 1;
    let j = index + 1;
    for (; j < tokens.length; j++) {
        const token = tokens[j];
        if (token.selfClosing) {
            continue;
        }
        if (token.tag === open.tag) {
            depth += token.isClose ? -1 : 1;
            if (depth === 0) {
                return {
                    child: { valueTag: open.tag, start: open.start, end: token.end, selfClosing: false },
                    nextIndex: j + 1,
                };
            }
        }
    }
    void xml;
    throw new Error(`Unclosed <${open.tag}> in Info.plist`);
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function stringElement(value: string): string {
    return `<string>${escapeXml(value)}</string>`;
}

function orientationArray(orientation: "landscape" | "portrait" | "auto", indent: string): string {
    const inner = ORIENTATION_VALUES[orientation]
        .map(value => `${indent}\t<string>${value}</string>`)
        .join("\n");
    return `<array>\n${inner}\n${indent}</array>`;
}

/** Leading whitespace of the line the offset sits on — to indent a rebuilt array. */
function lineIndent(xml: string, offset: number): string {
    const lineStart = xml.lastIndexOf("\n", offset - 1) + 1;
    const match = /^[\t ]*/.exec(xml.slice(lineStart, offset));
    return match ? match[0] : "";
}

export type InfoPlistPatch = {
    bundleId?: string;
    displayName?: string;
    shortVersionString?: string;
    bundleVersion?: string;
    orientation?: "landscape" | "portrait" | "auto";
};

export type InfoPlistIdentity = {
    bundleId?: string;
    displayName?: string;
    shortVersionString?: string;
    bundleVersion?: string;
};

function readString(xml: string, children: Map<string, ChildValue>, key: string): string | undefined {
    const child = children.get(key);
    if (!child || child.valueTag !== "string") {
        return undefined;
    }
    const openEnd = xml.indexOf(">", child.start) + 1;
    const closeStart = xml.lastIndexOf("<", child.end - 1);
    return unescapeXml(xml.slice(openEnd, closeStart));
}

function unescapeXml(value: string): string {
    return value
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}

/** Read the identity fields back — for the repack self-check and tests. */
export function parseInfoPlist(xml: string): InfoPlistIdentity {
    const children = locateRootChildren(xml);
    return {
        bundleId: readString(xml, children, "CFBundleIdentifier"),
        displayName: readString(xml, children, "CFBundleDisplayName"),
        shortVersionString: readString(xml, children, "CFBundleShortVersionString"),
        bundleVersion: readString(xml, children, "CFBundleVersion"),
    };
}

/**
 * Rewrite the identity/orientation fields of an Info.plist. Every requested
 * key must already exist in the template (the shell contract guarantees the
 * placeholder keys are present) — a missing key is an error rather than a
 * silent no-op, so a template drift is caught, not shipped.
 *
 * Edits are applied right-to-left by document offset so earlier spans stay
 * valid as later ones are spliced.
 */
export function patchInfoPlist(xml: string, patch: InfoPlistPatch): string {
    const children = locateRootChildren(xml);
    const edits: { start: number; end: number; replacement: string }[] = [];

    const stringPatch = (key: string, value: string | undefined) => {
        if (value === undefined) {
            return;
        }
        const child = children.get(key);
        if (!child || child.valueTag !== "string") {
            throw new Error(`Info.plist has no top-level <string> value for ${key}`);
        }
        edits.push({ start: child.start, end: child.end, replacement: stringElement(value) });
    };

    stringPatch("CFBundleIdentifier", patch.bundleId);
    stringPatch("CFBundleDisplayName", patch.displayName);
    stringPatch("CFBundleShortVersionString", patch.shortVersionString);
    stringPatch("CFBundleVersion", patch.bundleVersion);

    if (patch.orientation !== undefined) {
        let touched = false;
        for (const key of ORIENTATION_KEYS) {
            const child = children.get(key);
            if (!child) {
                continue; // ~ipad variant is optional
            }
            if (child.valueTag !== "array") {
                throw new Error(`Info.plist ${key} is not an <array>`);
            }
            edits.push({
                start: child.start,
                end: child.end,
                replacement: orientationArray(patch.orientation, lineIndent(xml, child.start)),
            });
            touched = true;
        }
        if (!touched) {
            throw new Error("Info.plist has no UISupportedInterfaceOrientations array to patch");
        }
    }

    edits.sort((a, b) => b.start - a.start);
    let result = xml;
    for (const edit of edits) {
        result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
    }
    return result;
}
