/**
 * `nl.puppet` is a Surface widget drawn by a runtime the *author* supplies.
 *
 * ## The type id names no renderer, and the display name names two
 *
 * The stored type is `nl.puppet`: one widget covering Spine2D, Live2D and anything else an author
 * writes a backend for, with `backend` picking which. That keeps the document schema stable — adding
 * support for another format later is a new folder in the author's project, not a migration — and it
 * keeps Studio's own vocabulary free of any renderer's name (the standing
 * phrasing is in `puppetBackendHost.ts`: nothing here names a renderer, and nothing here is allowed
 * to). The *author-facing* name does say "Spine2D / Live2D Model", because a widget called "Puppet"
 * tells nobody what it is for (user ruling 2026-07-29).
 *
 * **Studio ships no renderer and cannot.** The widget loads `runtimes/puppet/<backend>/index.js`
 * from the author's own project. A project without one draws an empty box, quietly - see the
 * degradation contract in `surfacePuppetSession.ts`.
 *
 * ## Why these fields and not others
 *
 * `motion` / `expression` / `skin` / `params` / `slots` are field-for-field the engine's
 * `PuppetState` — deliberately, and `puppetWidgetState()` in the widget's `helpers.ts` asserts it by
 * building one from these. The consequence that matters: a session is re-posed by applying a
 * **complete** state, and the engine's contract is that `null` *clears* rather than "leave as-is". A
 * half-state would make an undo or a loaded save fail to reproduce what it recorded, so there is
 * nowhere in this widget that a partial pose can be expressed.
 *
 * The box's size is the element's `UILayout` width/height. There is no second size prop: two
 * sources for one number is how a widget ends up drawing at a size its selection outline disagrees
 * with.
 */
export const UI_PUPPET_ELEMENT_TYPE = "nl.puppet";

export type UIPuppetWidgetProps = {
  /**
   * The model bundle asset (`AssetType.Model`) — a preserved directory tree, not a single file.
   *
   * Named `assetId` on purpose, not `modelAssetId`: both generic asset walks key on that literal
   * property name (`surfaceResourcePreload.ts` and `referenceModel.ts`), so this reference is
   * preloaded by the shipped game and is visible in "what uses this asset" with no per-widget code.
   */
  assetId: string | null;
  /**
   * The author's runtime, by directory name under the project's `runtimes/puppet/`.
   *
   * `""` means none chosen. A name the current machine does not have installed is kept rather than
   * dropped: the runtime is not on every machine the project is opened on, and silently rewriting
   * the document to `""` there would lose the author's choice.
   */
  backend: string;
  /** Handed to the backend verbatim. The engine never reads it and neither does Studio. */
  options: Record<string, unknown>;
  /** `PuppetState.motion` — the named action requested; `null` is "nothing playing", a real state. */
  motion: string | null;
  /** `PuppetState.expression`. `null` clears rather than substituting a model's own "neutral". */
  expression: string | null;
  /** `PuppetState.skin`. `null` is the model's own default skin. */
  skin: string | null;
  /** `PuppetState.params`. A key that is absent keeps the model's default, so clearing = dropping. */
  params: Record<string, number>;
  /** `PuppetState.slots`. An explicit `null` value is "cleared", which differs from an absent key. */
  slots: Record<string, string | null>;
};

export const defaultPuppetWidgetProps: UIPuppetWidgetProps = {
  assetId: null,
  backend: "",
  options: {},
  motion: null,
  expression: null,
  skin: null,
  params: {},
  slots: {}
};

function readAssetId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * A `PuppetState` name.
 *
 * Trimmed, and a blank string collapses to `null` — the engine's own "nothing requested". Keeping
 * `""` distinct from `null` would give two encodings of one state, and a backend handed `""` would
 * be asked for a motion whose name is the empty string.
 */
function readName(value: unknown): string | null {
  return readAssetId(value);
}

/** A plain object, or `{}`. Arrays are rejected: none of these three fields is a list. */
function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

/**
 * `params`, dropping anything that is not a finite number.
 *
 * A `NaN` reaching a backend is worse than a missing key: the engine's rule is that an absent key
 * keeps the model's own default, so dropping is exactly the documented "cleared".
 */
function readParams(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(readRecord(value))) {
    // Numbers, and strings that spell one. Nothing else goes through `Number()`, because
    // `Number(null)`, `Number("")` and `Number(false)` are all a perfectly finite 0 - so a
    // blanket coercion would turn every kind of junk into a parameter driven to zero, which a
    // model shows as a visibly wrong pose rather than as a missing key.
    const candidate =
      typeof raw === "number"
        ? raw
        : typeof raw === "string" && raw.trim().length > 0
          ? Number(raw)
          : Number.NaN;
    if (Number.isFinite(candidate)) {
      out[key] = candidate;
    }
  }
  return out;
}

/**
 * `slots`, keeping an explicit `null`.
 *
 * `null` is a *value* here and not a missing entry — `setSlot(id, null)` merges a cleared slot over
 * what was there — so a key present with null survives normalization. Anything that is neither a
 * string nor null is dropped rather than stringified.
 */
function readSlots(value: unknown): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [key, raw] of Object.entries(readRecord(value))) {
    if (raw === null) {
      out[key] = null;
    } else if (typeof raw === "string") {
      out[key] = raw;
    }
  }
  return out;
}

export function normalizePuppetProps(
  raw: Record<string, unknown> | undefined
): UIPuppetWidgetProps {
  return {
    assetId: readAssetId(raw?.assetId),
    backend:
      typeof raw?.backend === "string" ? raw.backend.trim() : defaultPuppetWidgetProps.backend,
    options: readRecord(raw?.options),
    motion: readName(raw?.motion),
    expression: readName(raw?.expression),
    skin: readName(raw?.skin),
    params: readParams(raw?.params),
    slots: readSlots(raw?.slots)
  };
}

/**
 * Whether this widget has been configured far enough for anything to be drawn.
 *
 * Both halves are needed and neither is an error: a model with no runtime to draw it and a runtime
 * with no model are the two states every puppet widget passes through while it is being authored.
 */
export function isPuppetWidgetConfigured(props: UIPuppetWidgetProps): boolean {
  return Boolean(props.assetId) && props.backend.length > 0;
}
