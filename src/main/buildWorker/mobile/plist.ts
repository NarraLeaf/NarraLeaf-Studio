/**
 * XML property lists for the iOS side of the build: an Info.plist patcher for
 * the repack, and a whole-document reader used by the provisioning-profile
 * parser. Pure - strings in, values out, no fs.
 *
 * The two halves are deliberately different. Patching rewrites values in place
 * (see below); reading materializes the document as plain JS values, which is
 * only safe because the documents read this way are small, machine-written and
 * never round-tripped back out.
 *
 * The patcher:
 *
 * The shell template ships a plain-text (XML) Info.plist - the template CI
 * asserts that shape (`plutil -lint`) - so the repack rewrites values in place
 * rather than re-encoding a binary plist. Only a fixed set of top-level keys
 * is touched: the bundle identity, the two version strings, and the
 * orientation whitelist. Every other byte of the document is preserved, and
 * nested dictionaries (e.g. CFBundleIcons, whose PNG *files* the zip layer
 * swaps) are never entered.
 *
 * Values are located structurally - the immediate children of the root
 * <dict>, tracking nesting depth so a key of the same name inside a nested
 * dict is not mistaken for the top-level one - not by blind text replacement.
 */

const ORIENTATION_VALUES: Record<"landscape" | "portrait" | "auto", string[]> = {
  landscape: ["UIInterfaceOrientationLandscapeLeft", "UIInterfaceOrientationLandscapeRight"],
  portrait: ["UIInterfaceOrientationPortrait", "UIInterfaceOrientationPortraitUpsideDown"],
  auto: [
    "UIInterfaceOrientationPortrait",
    "UIInterfaceOrientationPortraitUpsideDown",
    "UIInterfaceOrientationLandscapeLeft",
    "UIInterfaceOrientationLandscapeRight"
  ]
};

const ORIENTATION_KEYS = [
  "UISupportedInterfaceOrientations",
  "UISupportedInterfaceOrientations~ipad"
];

type Token = {
  tag: string;
  isClose: boolean;
  selfClosing: boolean;
  start: number;
  end: number;
  inner: string;
};

/** Walk XML tags in order, ignoring comments, PIs, and the doctype. */
function* iterateTags(xml: string): Generator<Token> {
  const tagRe =
    /<(\/?)([A-Za-z_][\w.:~-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(xml)) !== null) {
    if (match[2] === undefined) {
      continue; // comment / PI / doctype - skipped
    }
    yield {
      tag: match[2],
      isClose: match[1] === "/",
      selfClosing: match[4] === "/",
      start: match.index,
      end: tagRe.lastIndex,
      inner: match[3] ?? ""
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
  const rootDictIndex = tokens.findIndex((token) => token.tag === "dict" && !token.isClose);
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

function readValueElement(
  tokens: Token[],
  index: number,
  xml: string
): { child: ChildValue; nextIndex: number } {
  const open = tokens[index];
  if (open.selfClosing) {
    return {
      child: { valueTag: open.tag, start: open.start, end: open.end, selfClosing: true },
      nextIndex: index + 1
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
          nextIndex: j + 1
        };
      }
    }
  }
  void xml;
  throw new Error(`Unclosed <${open.tag}> in Info.plist`);
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function stringElement(value: string): string {
  return `<string>${escapeXml(value)}</string>`;
}

function orientationArray(orientation: "landscape" | "portrait" | "auto", indent: string): string {
  const inner = ORIENTATION_VALUES[orientation]
    .map((value) => `${indent}\t<string>${value}</string>`)
    .join("\n");
  return `<array>\n${inner}\n${indent}</array>`;
}

/** Leading whitespace of the line the offset sits on - to indent a rebuilt array. */
function lineIndent(xml: string, offset: number): string {
  const lineStart = xml.lastIndexOf("\n", offset - 1) + 1;
  const match = /^[\t ]*/.exec(xml.slice(lineStart, offset));
  return match ? match[0] : "";
}

/* ------------------------------------------------------- whole-document read */

export type PlistDictionary = { [key: string]: PlistValue };
export type PlistValue = string | number | boolean | Date | Buffer | PlistValue[] | PlistDictionary;

/** Text content of an element whose open tag is `open` and close tag is `close`. */
function elementText(xml: string, open: Token, close: Token): string {
  return unescapeXml(xml.slice(open.end, close.start));
}

/** Index of the token closing the element opened at `index`, honoring nesting. */
function matchingClose(tokens: Token[], index: number): number {
  const open = tokens[index];
  let depth = 1;
  for (let j = index + 1; j < tokens.length; j++) {
    const token = tokens[j];
    if (token.selfClosing || token.tag !== open.tag) {
      continue;
    }
    depth += token.isClose ? -1 : 1;
    if (depth === 0) {
      return j;
    }
  }
  throw new Error(`Unclosed <${open.tag}> in the property list`);
}

function parsePlistValue(
  tokens: Token[],
  index: number,
  xml: string
): { value: PlistValue; next: number } {
  const open = tokens[index];
  if (open.isClose) {
    throw new Error(`Unexpected </${open.tag}> in the property list`);
  }
  // Booleans are always empty elements; every other type may be, and an empty
  // one means the type's zero value.
  if (open.tag === "true" || open.tag === "false") {
    return {
      value: open.tag === "true",
      next: open.selfClosing ? index + 1 : matchingClose(tokens, index) + 1
    };
  }
  if (open.selfClosing) {
    const empty: Record<string, PlistValue> = {
      string: "",
      data: Buffer.alloc(0),
      array: [],
      dict: {},
      integer: 0,
      real: 0
    };
    if (!(open.tag in empty)) {
      throw new Error(`Unsupported empty property list element <${open.tag}/>`);
    }
    // A fresh container per call; the table above must not hand out shared ones.
    const value = open.tag === "array" ? [] : open.tag === "dict" ? {} : empty[open.tag];
    return { value, next: index + 1 };
  }

  if (open.tag === "dict") {
    const dictionary: PlistDictionary = {};
    let i = index + 1;
    for (;;) {
      const token = tokens[i];
      if (!token) {
        throw new Error("Unclosed <dict> in the property list");
      }
      if (token.tag === "dict" && token.isClose) {
        return { value: dictionary, next: i + 1 };
      }
      if (token.tag !== "key" || token.isClose) {
        throw new Error(`Expected a <key> in a property list dict, found <${token.tag}>`);
      }
      let key = "";
      if (token.selfClosing) {
        i += 1;
      } else {
        const close = matchingClose(tokens, i);
        key = elementText(xml, token, tokens[close]);
        i = close + 1;
      }
      const parsed = parsePlistValue(tokens, i, xml);
      dictionary[key] = parsed.value;
      i = parsed.next;
    }
  }

  if (open.tag === "array") {
    const values: PlistValue[] = [];
    let i = index + 1;
    for (;;) {
      const token = tokens[i];
      if (!token) {
        throw new Error("Unclosed <array> in the property list");
      }
      if (token.tag === "array" && token.isClose) {
        return { value: values, next: i + 1 };
      }
      const parsed = parsePlistValue(tokens, i, xml);
      values.push(parsed.value);
      i = parsed.next;
    }
  }

  const close = matchingClose(tokens, index);
  const text = elementText(xml, open, tokens[close]);
  const next = close + 1;
  switch (open.tag) {
    case "string":
      return { value: text, next };
    case "integer":
    case "real": {
      const value = Number(text.trim());
      if (!Number.isFinite(value)) {
        throw new Error(`Malformed <${open.tag}> in the property list: "${text.trim()}"`);
      }
      return { value, next };
    }
    case "date": {
      const value = new Date(text.trim());
      if (Number.isNaN(value.getTime())) {
        throw new Error(`Malformed <date> in the property list: "${text.trim()}"`);
      }
      return { value, next };
    }
    case "data":
      // Apple wraps base64 across lines; Buffer.from ignores the newlines.
      return { value: Buffer.from(text.replace(/\s+/g, ""), "base64"), next };
    default:
      throw new Error(`Unsupported property list element <${open.tag}>`);
  }
}

/**
 * Read an XML property list into plain JS values. Binary plists are not
 * supported and are refused by name - the documents this reads (provisioning
 * profiles) are XML by Apple's own construction.
 */
export function parsePlist(xml: string): PlistValue {
  if (xml.startsWith("bplist")) {
    throw new Error("This is a binary property list, which cannot be read here");
  }
  const tokens = [...iterateTags(xml)];
  const rootIndex = tokens.findIndex((token) => token.tag === "plist" && !token.isClose);
  // Some tools emit the bare root element with no <plist> wrapper.
  const firstIndex = rootIndex >= 0 ? rootIndex + 1 : tokens.findIndex((token) => !token.isClose);
  if (firstIndex < 0 || firstIndex >= tokens.length) {
    throw new Error("This property list has no root value");
  }
  return parsePlistValue(tokens, firstIndex, xml).value;
}

/** `parsePlist` for a document whose root is a dict, which is the usual case. */
export function parsePlistDictionary(xml: string): PlistDictionary {
  const value = parsePlist(xml);
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    value instanceof Date ||
    Buffer.isBuffer(value)
  ) {
    throw new Error("This property list's root value is not a dictionary");
  }
  return value;
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

function readString(
  xml: string,
  children: Map<string, ChildValue>,
  key: string
): string | undefined {
  const child = children.get(key);
  if (!child || child.valueTag !== "string") {
    return undefined;
  }
  const openEnd = xml.indexOf(">", child.start) + 1;
  const closeStart = xml.lastIndexOf("<", child.end - 1);
  return unescapeXml(xml.slice(openEnd, closeStart));
}

function unescapeXml(value: string): string {
  return value.replace(
    /&(?:lt|gt|amp|quot|apos|#(\d+)|#[xX]([0-9a-fA-F]+));/g,
    (whole, decimal: string | undefined, hex: string | undefined) => {
      if (decimal !== undefined) {
        return String.fromCodePoint(Number(decimal));
      }
      if (hex !== undefined) {
        return String.fromCodePoint(parseInt(hex, 16));
      }
      return (
        { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&apos;": "'" }[whole] ?? whole
      );
    }
  );
}

/** Read the identity fields back - for the repack self-check and tests. */
export function parseInfoPlist(xml: string): InfoPlistIdentity {
  const children = locateRootChildren(xml);
  return {
    bundleId: readString(xml, children, "CFBundleIdentifier"),
    displayName: readString(xml, children, "CFBundleDisplayName"),
    shortVersionString: readString(xml, children, "CFBundleShortVersionString"),
    bundleVersion: readString(xml, children, "CFBundleVersion")
  };
}

/**
 * Rewrite the identity/orientation fields of an Info.plist. Every requested
 * key must already exist in the template (the shell contract guarantees the
 * placeholder keys are present) - a missing key is an error rather than a
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
        replacement: orientationArray(patch.orientation, lineIndent(xml, child.start))
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
