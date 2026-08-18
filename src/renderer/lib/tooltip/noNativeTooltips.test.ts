import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * Studio draws its own tooltips, and this is what stops the browser's from coming back.
 *
 * A `title` on a DOM element is a tooltip Chromium draws: it ignores the theme, waits about a second,
 * and covers the pixels being aimed at. Every one of them was moved to `data-tip` (see
 * `tooltipController.ts`), which is a rename with no visible seam - so a new `title=` typed by habit
 * would land back on the native bubble and look, to whoever wrote it, like it worked.
 *
 * Only DOM elements are checked. `title` on a component is a heading in this codebase (`Modal`,
 * `SettingsGroup`, `SectionCard`), which is why the scan cares what tag the attribute sits on.
 */

const SRC = join(process.cwd(), "src");
const DOM_TAGS = new Set([
  "a",
  "button",
  "div",
  "dd",
  "dt",
  "fieldset",
  "input",
  "label",
  "li",
  "p",
  "section",
  "span",
  "td",
  "textarea",
  "th",
  "tr",
  "ul"
]);
const TITLE_ATTRIBUTE = /(?<![\w$-])title\s*=/g;

function sourceFiles(dir: string, extension: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(path, extension));
    } else if (entry.name.endsWith(extension)) {
      out.push(path);
    }
  }
  return out;
}

/**
 * The attribute list of every JSX opening tag, as [tagName, start, end].
 *
 * Hand-rolled rather than a parser because this runs over the whole tree on every test run. Comments
 * are skipped at any depth: TypeScript allows `//` between attributes, and one apostrophe in a
 * comment ("the app's menus") otherwise reads as the start of a string and desyncs the rest of the
 * file - which is how two batches of `title=` survived the migration that added this test.
 */
function openingTags(source: string): Array<[string, number, number]> {
  const tags: Array<[string, number, number]> = [];
  let i = 0;
  while (i < source.length) {
    if (source[i] !== "<") {
      i += 1;
      continue;
    }
    const match = /^<([A-Za-z][\w.]*)/.exec(source.slice(i));
    if (!match) {
      i += 1;
      continue;
    }
    let j = i + match[0].length;
    const attributesStart = j;
    let depth = 0;
    let quote: string | null = null;
    let end = -1;
    while (j < source.length) {
      const ch = source[j];
      if (quote) {
        if (ch === "\\") {
          j += 2;
          continue;
        }
        if (ch === quote) {
          quote = null;
        }
        j += 1;
        continue;
      }
      if (ch === "/" && source[j + 1] === "/") {
        const nl = source.indexOf("\n", j);
        j = nl < 0 ? source.length : nl;
        continue;
      }
      if (ch === "/" && source[j + 1] === "*") {
        const close = source.indexOf("*/", j);
        j = close < 0 ? source.length : close + 2;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
        j += 1;
        continue;
      }
      if (ch === "{") {
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
      } else if (depth === 0 && ch === ">") {
        end = j;
        break;
      } else if (depth === 0 && ch === "<") {
        break;
      }
      j += 1;
    }
    if (end < 0) {
      i += 1;
      continue;
    }
    tags.push([match[1], attributesStart, end]);
    i = end + 1;
  }
  return tags;
}

/** Whether an offset inside an attribute list is an attribute name rather than part of a value. */
function isAttributeName(region: string, index: number): boolean {
  let depth = 0;
  let quote: string | null = null;
  let i = 0;
  while (i < index) {
    const ch = region[i];
    if (quote) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      i += 1;
      continue;
    }
    if (ch === "/" && region[i + 1] === "/") {
      const nl = region.indexOf("\n", i);
      i = nl < 0 ? region.length : nl;
      continue;
    }
    if (ch === "/" && region[i + 1] === "*") {
      const close = region.indexOf("*/", i);
      i = close < 0 ? region.length : close + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
    }
    i += 1;
  }
  return depth === 0 && quote === null;
}

describe("no native tooltips", () => {
  it("no DOM element carries a title attribute", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC, ".tsx")) {
      const source = readFileSync(file, "utf8");
      for (const [tag, start, end] of openingTags(source)) {
        if (!DOM_TAGS.has(tag)) {
          continue;
        }
        const region = source.slice(start, end);
        TITLE_ATTRIBUTE.lastIndex = 0;
        for (const match of region.matchAll(TITLE_ATTRIBUTE)) {
          if (!isAttributeName(region, match.index)) {
            continue;
          }
          const line = source.slice(0, start).split("\n").length;
          offenders.push(`${file.slice(SRC.length + 1)}:${line} <${tag}>`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("nothing assigns a title property to an element", () => {
    const offenders: string[] = [];
    for (const file of [...sourceFiles(SRC, ".ts"), ...sourceFiles(SRC, ".tsx")]) {
      const source = readFileSync(file, "utf8");
      if (/\b(?:span|div|button|element|node)\.title\s*=/i.test(source)) {
        offenders.push(file.slice(SRC.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });
});
