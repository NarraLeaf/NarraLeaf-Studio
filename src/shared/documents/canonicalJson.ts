/**
 * Canonical JSON: the same logical content always produces the same bytes.
 *
 * Version control is the whole reason this exists. `JSON.stringify` emits keys in
 * property insertion order, so a document rebuilt through a different code path -
 * a migration, a spread, an edit that recreated one object - comes back with its
 * keys in a different order throughout. A one-word change then lands as a
 * whole-file diff, and three-way merge has nothing to align on. Sorting is not
 * prettier output; it is what makes a diff mean anything.
 *
 * The encoder is deliberately stricter than `JSON.stringify`, which is a lossy
 * function that never says so: it drops `undefined` properties, writes `null` for
 * `NaN`, `Infinity` and array holes, drops symbol-keyed properties, and turns a
 * `Map` into `{}`. In a document format every one of those is data loss that
 * resurfaces as a deliberate-looking deletion in the next diff. All of them throw
 * here, naming the JSON path of the offending value, because "invalid document"
 * with no location is useless in a 4000-line story file.
 */

/** A step in a JSON path: an object key, or an array index. */
export type JsonPathSegment = string | number;

export class CanonicalJsonError extends Error {
  /** Where the offending value sits, e.g. `stories[2].updatedAt`. */
  public readonly jsonPath: string;

  constructor(jsonPath: string, message: string) {
    super(`${message} (at ${jsonPath})`);
    this.name = "CanonicalJsonError";
    this.jsonPath = jsonPath;
  }
}

/**
 * Two spaces and real newlines rather than one long line.
 *
 * Not for human line-diffing - our diff is structural. It is for Lore's FastCDC
 * content-defined chunking: a single-line document rewrites its entire chunk for a
 * one-character edit, where a line-structured one moves a chunk or two.
 */
const INDENT = "  ";

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function encodeCanonicalJson(value: unknown): string {
  const out: string[] = [];
  writeValue(value, "", [], out, new Set<object>());
  // The trailing newline is part of the format: without it every tool that appends
  // to a file, and every "\ No newline at end of file" diff, becomes a spurious change.
  out.push("\n");
  return out.join("");
}

/**
 * Whether `text` is already exactly what {@link encodeCanonicalJson} would produce.
 *
 * The normalize-on-open pass reads this to leave untouched files alone: rewriting
 * every document on open would put a whole-project diff in front of the author for
 * no change in content.
 */
export function isCanonicalJson(text: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return false;
  }

  try {
    return encodeCanonicalJson(parsed) === text;
  } catch {
    // Reachable: `1e400` parses to `Infinity`, and nesting deeper than the call stack
    // overflows the encoder while `JSON.parse` walks it iteratively. See
    // {@link findCanonicalJsonDefect} for the full set. Bytes we cannot encode are by
    // definition not bytes the encoder produced, so `false` is the honest answer.
    return false;
  }
}

/**
 * The reason `value` cannot be written as canonical JSON, or `null` if it can.
 *
 * This exists so a caller can find out *without risking a throw of its own*, which is
 * what {@link loadDocument} needs: a file's contents must never be able to take down
 * the function whose job is containing bad files.
 *
 * It is the encoder itself, with the output discarded, rather than a second walk
 * applying the same rules - a separate implementation would be free to drift, and the
 * drift would show up as exactly the crash this is here to prevent.
 *
 * Most of the encoder's rejections are unreachable from `JSON.parse`, which builds
 * only null, booleans, numbers, strings, dense arrays and plain objects: no
 * `undefined`, no functions, symbols or bigints, no `Date`/`Map`/`Set`, no
 * symbol-keyed properties, no array holes, no cycles. `NaN` is unreachable too - the
 * JSON grammar has no `NaN` literal and nothing here does arithmetic. What remains:
 *
 *  - `Infinity` and `-Infinity`, from a numeric literal that overflows a double
 *    (`1e400`, or simply four hundred digits). The value survives the parse and only
 *    fails on the way back out.
 *  - Nesting deeper than the call stack, which V8's iterative JSON parser accepts and
 *    a recursive encoder cannot walk. That arrives as a `RangeError` rather than a
 *    {@link CanonicalJsonError}, so it is caught and described here too.
 *
 * A `"__proto__"` key is deliberately not in that list: `JSON.parse` makes it an
 * ordinary own data property, the prototype is untouched, and it round-trips.
 */
export function findCanonicalJsonDefect(value: unknown): CanonicalJsonError | null {
  try {
    encodeCanonicalJson(value);
    return null;
  } catch (error) {
    if (error instanceof CanonicalJsonError) {
      return error;
    }
    const message = error instanceof Error ? error.message : String(error);
    return new CanonicalJsonError("(root)", `cannot be encoded as canonical JSON: ${message}`);
  }
}

/** Render a JSON path for an error message. Exported so document specs report locations the same way. */
export function formatJsonPath(segments: readonly JsonPathSegment[]): string {
  if (segments.length === 0) {
    return "(root)";
  }

  let out = "";
  for (const segment of segments) {
    if (typeof segment === "number") {
      out += `[${segment}]`;
    } else if (IDENTIFIER.test(segment)) {
      out += out.length === 0 ? segment : `.${segment}`;
    } else {
      out += `[${JSON.stringify(segment)}]`;
    }
  }
  return out;
}

function fail(path: readonly JsonPathSegment[], message: string): never {
  throw new CanonicalJsonError(formatJsonPath(path), message);
}

function writeValue(
  value: unknown,
  indent: string,
  path: JsonPathSegment[],
  out: string[],
  ancestors: Set<object>
): void {
  switch (typeof value) {
    case "string":
      // `JSON.stringify` on a lone string is the escaping rule the JSON spec fixes:
      // minimal escapes, and lone surrogates escaped as \uD800 (well-formed since
      // ES2019). Reimplementing it would only be a way to disagree with every parser.
      out.push(JSON.stringify(value));
      return;
    case "number":
      writeNumber(value, path, out);
      return;
    case "boolean":
      out.push(value ? "true" : "false");
      return;
    case "undefined":
      fail(
        path,
        "undefined has no JSON representation; JSON.stringify would drop this property from its object, or write null for it inside an array"
      );
      break;
    case "function":
      fail(
        path,
        "a function has no JSON representation; JSON.stringify would drop this property without a word"
      );
      break;
    case "symbol":
      fail(
        path,
        "a symbol has no JSON representation; JSON.stringify would drop this property without a word"
      );
      break;
    case "bigint":
      fail(
        path,
        "a bigint has no JSON representation; JSON.stringify throws on it. Store it as a string, or as a number if it fits"
      );
      break;
  }

  if (value === null) {
    out.push("null");
    return;
  }

  writeObject(value as object, indent, path, out, ancestors);
}

function writeNumber(value: number, path: JsonPathSegment[], out: string[]): void {
  if (!Number.isFinite(value)) {
    fail(
      path,
      `${String(value)} has no JSON representation; JSON.stringify would write null, and the value would read back as null on the next open`
    );
  }

  // `String` already gives the shortest representation that round-trips, so the only
  // number needing help is -0: `String(-0)` is "0", which throws away a sign that
  // `JSON.parse("-0")` would have handed back. Emitting "-0" keeps parse/serialize exact.
  out.push(Object.is(value, -0) ? "-0" : String(value));
}

function writeObject(
  value: object,
  indent: string,
  path: JsonPathSegment[],
  out: string[],
  ancestors: Set<object>
): void {
  if (ancestors.has(value)) {
    fail(
      path,
      "this value is one of its own ancestors; a cycle has no JSON form. (A value merely referenced twice is fine - only a loop is rejected)"
    );
  }

  const inner = indent + INDENT;

  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push("[]");
      return;
    }

    ancestors.add(value);
    out.push("[\n");
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) {
        out.push(",\n");
      }
      out.push(inner);
      path.push(index);
      // A hole reads as `undefined` and is rejected one frame down. `JSON.stringify`
      // writes `null` for holes, which quietly turns a sparse array dense on reload.
      writeValue(value[index], inner, path, out, ancestors);
      path.pop();
    }
    out.push("\n", indent, "]");
    ancestors.delete(value);
    return;
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    if (value instanceof Date) {
      fail(
        path,
        "Date is not accepted: it serialises to a string and parses back as a string, so the document stops round-tripping and the asymmetry only shows up as a type error somewhere far away. Store the ISO string"
      );
    }
    fail(
      path,
      `${constructorNameOf(value)} is not plain JSON data; JSON.stringify would write {} for a Map or a Set, and an unrelated shape for most other classes. Convert it before saving`
    );
  }

  const symbolKeys = Object.getOwnPropertySymbols(value).filter((symbol) =>
    Object.prototype.propertyIsEnumerable.call(value, symbol)
  );
  if (symbolKeys.length > 0) {
    fail(
      path,
      `symbol-keyed properties (${symbolKeys.map(String).join(", ")}) cannot be written; JSON.stringify would drop them without a word`
    );
  }

  // Plain `.sort()` compares UTF-16 code units, which is the ordering the format is
  // defined in terms of: every engine agrees on it and no locale can change it.
  // `localeCompare` would make the bytes depend on the author's machine, so two people
  // saving the same document would produce different files.
  const keys = Object.keys(value).sort();
  if (keys.length === 0) {
    out.push("{}");
    return;
  }

  ancestors.add(value);
  out.push("{\n");
  for (let index = 0; index < keys.length; index += 1) {
    if (index > 0) {
      out.push(",\n");
    }
    const key = keys[index];
    out.push(inner, JSON.stringify(key), ": ");
    path.push(key);
    writeValue((value as Record<string, unknown>)[key], inner, path, out, ancestors);
    path.pop();
  }
  out.push("\n", indent, "}");
  ancestors.delete(value);
}

function constructorNameOf(value: object): string {
  try {
    const name = (value as { constructor?: { name?: unknown } }).constructor?.name;
    return typeof name === "string" && name.length > 0 ? name : "This object";
  } catch {
    return "This object";
  }
}
