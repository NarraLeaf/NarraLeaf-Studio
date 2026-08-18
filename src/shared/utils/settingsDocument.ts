/**
 * The file an author moves their Studio preferences with.
 *
 * Deliberately NOT a copy of `global.json`. That file is one store holding four different kinds
 * of thing - preferences, the project history, per-project editor sessions, per-project writing
 * statistics - and a real profile measures 96 keys of which about thirty are preferences. Handing
 * someone that file hands them your project list.
 *
 * So this is a document with a version, a declared scope, and validation on the way back in. The
 * validation is not defensive politeness: the file is JSON an author can open, and a hand-edited
 * settings file is the normal case, not the exception.
 */

export const SETTINGS_DOCUMENT_FORMAT_VERSION = 1;

export type SettingsDocument = {
  formatVersion: number;
  /** ISO timestamp, for the author's benefit; nothing reads it back. */
  exportedAt: string;
  /** Studio version that wrote it, so a support conversation has the number. */
  studioVersion: string;
  /** Which machine wrote it - a path-shaped value that looks odd on import usually explains itself here. */
  platform: string;
  settings: Record<string, unknown>;
};

/**
 * What a value is allowed to be, per key, so an import can check it.
 *
 * A structural subset of the settings registry's descriptors rather than the descriptors
 * themselves: this module is shared, and the registry lives in the renderer and carries React
 * callbacks. The caller projects one onto the other.
 */
export type SettingsValueSpec = {
  key: string;
  kind: "boolean" | "number" | "string" | "enum" | "json";
  options?: readonly string[];
  min?: number;
  max?: number;
};

export type SettingsImportEntry = {
  key: string;
  current: unknown;
  incoming: unknown;
  /**
   * - `apply`: a valid value that differs from what is stored.
   * - `same`: valid and already the stored value, so importing it changes nothing.
   * - `unknown`: no spec, i.e. a key this build does not have.
   * - `invalid`: a spec exists and the value does not satisfy it.
   */
  verdict: "apply" | "same" | "unknown" | "invalid";
  /** Why, for the two rejecting verdicts. */
  reason?: string;
};

export type SettingsImportPlan = {
  document: SettingsDocument;
  entries: SettingsImportEntry[];
  /** Just the ones that would be written, in document order. */
  applicable: SettingsImportEntry[];
};

export function composeSettingsDocument(input: {
  settings: Record<string, unknown>;
  studioVersion: string;
  platform: string;
  exportedAt: string;
}): SettingsDocument {
  return {
    formatVersion: SETTINGS_DOCUMENT_FORMAT_VERSION,
    exportedAt: input.exportedAt,
    studioVersion: input.studioVersion,
    platform: input.platform,
    // Sorted so two exports of the same profile are the same bytes, which makes the file
    // diffable and a support answer reproducible.
    settings: Object.fromEntries(
      Object.entries(input.settings).sort(([a], [b]) => a.localeCompare(b))
    )
  };
}

export function serializeSettingsDocument(document: SettingsDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export class SettingsDocumentError extends Error {}

/**
 * Parse a document, refusing anything this build cannot read as a whole.
 *
 * A wrong `formatVersion` is refused rather than best-efforted: the point of the field is that a
 * future shape can change what a key means, and guessing would apply the new meaning under the
 * old rules.
 */
export function parseSettingsDocument(text: string): SettingsDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SettingsDocumentError("That file is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SettingsDocumentError("That file does not contain a settings document");
  }
  const record = parsed as Record<string, unknown>;
  if (record.formatVersion !== SETTINGS_DOCUMENT_FORMAT_VERSION) {
    throw new SettingsDocumentError(
      `That document is version ${String(record.formatVersion)}, and this version of Studio reads version ${SETTINGS_DOCUMENT_FORMAT_VERSION}`
    );
  }
  const settings = record.settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new SettingsDocumentError("That document has no settings in it");
  }
  return {
    formatVersion: SETTINGS_DOCUMENT_FORMAT_VERSION,
    exportedAt: typeof record.exportedAt === "string" ? record.exportedAt : "",
    studioVersion: typeof record.studioVersion === "string" ? record.studioVersion : "",
    platform: typeof record.platform === "string" ? record.platform : "",
    settings: settings as Record<string, unknown>
  };
}

/** Whether one value satisfies one spec, and if not, in what words. */
export function validateSettingValue(spec: SettingsValueSpec, value: unknown): string | null {
  switch (spec.kind) {
    case "boolean":
      return typeof value === "boolean" ? null : "expected true or false";
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return "expected a number";
      }
      if (spec.min !== undefined && value < spec.min) {
        return `below the minimum of ${spec.min}`;
      }
      if (spec.max !== undefined && value > spec.max) {
        return `above the maximum of ${spec.max}`;
      }
      return null;
    }
    case "string":
      return typeof value === "string" ? null : "expected text";
    case "enum": {
      if (typeof value !== "string") {
        return "expected text";
      }
      // An enum with no options recorded cannot be checked, and refusing on that basis
      // would reject a perfectly good value over a gap in the spec.
      if (spec.options && spec.options.length > 0 && !spec.options.includes(value)) {
        return `not one of: ${spec.options.join(", ")}`;
      }
      return null;
    }
    case "json":
      // Shapes the registry does not describe (the rewrite list, the keybinding map). Their
      // own readers normalize whatever they find, which is what makes this safe to wave
      // through - and is why those readers exist.
      return value === undefined ? "no value" : null;
  }
}

/**
 * What importing this document would do, key by key, before anything is written.
 *
 * Keys with no spec are reported as `unknown` and NOT written. Persisting a key this build cannot
 * interpret would make the store a dumping ground for a newer Studio's vocabulary, and there is
 * nothing meaningful to show the author about it in the preview either.
 */
export function planSettingsImport(
  document: SettingsDocument,
  specs: readonly SettingsValueSpec[],
  current: Record<string, unknown>
): SettingsImportPlan {
  const byKey = new Map(specs.map((spec) => [spec.key, spec]));
  const entries: SettingsImportEntry[] = [];

  for (const [key, incoming] of Object.entries(document.settings)) {
    const spec = byKey.get(key);
    if (!spec) {
      entries.push({ key, current: current[key], incoming, verdict: "unknown" });
      continue;
    }
    const problem = validateSettingValue(spec, incoming);
    if (problem) {
      entries.push({ key, current: current[key], incoming, verdict: "invalid", reason: problem });
      continue;
    }
    const unchanged = JSON.stringify(current[key]) === JSON.stringify(incoming);
    entries.push({ key, current: current[key], incoming, verdict: unchanged ? "same" : "apply" });
  }

  return {
    document,
    entries,
    applicable: entries.filter((entry) => entry.verdict === "apply")
  };
}
