/**
 * Order-independent JSON for *keys*, tolerant of whatever it is handed.
 *
 * Not {@link import("../documents/canonicalJson").encodeCanonicalJson}: that one throws on
 * `undefined`, `NaN` and friends because a *document* must never lose data silently. This encodes a
 * cache key or a React dependency, where the only requirement is that two equal values produce equal
 * text and two different ones usually do not — so an unrepresentable value is stamped rather than
 * rejected. The values that reach it include options bags an author wrote, and a throw here would take
 * whatever was being keyed down with it.
 *
 * Lives under `@shared` because both a workspace service and the packaged game runtime need it, and
 * the runtime bundle's import guard (`runtimeAliasPlugin` in `project/build/build-runtime.js`) will not
 * let the runtime reach into `@/lib/workspace`.
 */
export function encodeStableJson(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "?";
  const type = typeof value;
  if (type === "number") return Number.isFinite(value as number) ? String(value) : "?num";
  if (type === "boolean" || type === "bigint") return String(value);
  if (type === "string") return JSON.stringify(value);
  if (type === "function" || type === "symbol") return "?opaque";
  if (Array.isArray(value)) {
    return `[${value.map(encodeStableJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${encodeStableJson(item)}`).join(",")}}`;
}
