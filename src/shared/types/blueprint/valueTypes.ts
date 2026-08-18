/**
 * Canonical structured value types used by Blueprint data pins.
 * Comments in English per project convention.
 */

export const BLUEPRINT_VALUE_TYPE_VECTOR2D = "Vector2D" as const;
export const BLUEPRINT_VALUE_TYPE_RGBA_COLOR = "RGBAColor" as const;
export const BLUEPRINT_VALUE_TYPE_ELEMENT = "element" as const;
export const BLUEPRINT_VALUE_TYPE_ARRAY = "array" as const;
export const BLUEPRINT_VALUE_TYPE_IMAGE_ASSET = "ImageAsset" as const;
export const BLUEPRINT_VALUE_TYPE_IMAGE_ASSET_NULLABLE = "ImageAsset|null" as const;
export const BLUEPRINT_VALUE_TYPE_TIMER = "Timer" as const;
export const BLUEPRINT_VALUE_TYPE_ANIMATION_TOKEN = "AnimationToken" as const;
export const BLUEPRINT_VALUE_TYPE_SOUND_HANDLE = "SoundHandle" as const;
export const BLUEPRINT_VALUE_TYPE_RESPONSE_BODY = "ResponseBody" as const;

export type BlueprintElementRef = {
  surfaceId: string;
  elementId: string;
  elementType: string;
};

export type BlueprintVector2D = {
  x: number;
  y: number;
};

export type BlueprintRGBAColor = {
  r: number;
  g: number;
  b: number;
  a: number;
};

export type BlueprintImageAsset = {
  kind: "imageAsset";
  assetId: string;
};

/**
 * The kinds of library asset a blueprint pin can carry.
 *
 * Split by kind because the two are stored differently and read differently: an image travels as the
 * tagged {@link BlueprintImageAsset} record, a font as the bare id string. The reverse-lookup index
 * needs to know which of the two it is holding before it can turn a pin value into an asset id.
 */
export type BlueprintAssetPinKind = "image" | "font";

/**
 * Declares that a pin carries a library asset id, so the reverse-lookup index can find the
 * reference from the node catalogue instead of from a list of param names it has to keep in step by
 * hand. A pin with no declaration carries no asset, and a reference through it is invisible.
 *
 * `paramKey` covers the one shape where the stored key is not the pin id: the Image Asset literal
 * node publishes on a pin called `value` and stores the picked asset under `asset`.
 */
export type BlueprintAssetPinRef = {
  kind: BlueprintAssetPinKind;
  paramKey?: string;
  /**
   * Where the pin's value comes from.
   *
   * `"stored"` (the default) means the document holds it: the id sits under `paramKey`, and it is
   * a reference the reverse-lookup index reads and reports.
   *
   * `"published"` means the host resolves it while the game runs, and **the pin provably cannot
   * carry a library asset id**. Nothing is stored to read, and an edge out of such a pin is not a
   * reference the index is failing to see - so it must not be reported as one. Marking a pin this
   * way is a claim about what can flow through it: it needs an argument at the declaration, not a
   * guess, because a wrong one hides a real reference.
   */
  origin?: "stored" | "published";
};

export type BlueprintTimerToken = {
  kind: "timer";
  id: string;
};

export type BlueprintAnimationToken = {
  kind: "animation";
  id: string;
};

/**
 * A handle on one playing clip, returned by Play Sound and accepted by the
 * transport nodes. Opaque: the id addresses a SoundToken the host holds, so the
 * graph can pass playback around without the engine's object crossing into
 * blueprint data.
 */
export type BlueprintSoundHandle = {
  kind: "soundHandle";
  id: string;
};

/**
 * A handle on one fetched response body, returned by Fetch and accepted by the reader nodes.
 *
 * Opaque for the same reason as {@link BlueprintSoundHandle}, plus one of its own: the body may be
 * megabytes, and a graph that fetches inside a loop would otherwise put every one of them on a data
 * pin and into the node output store, where they are copied around and held for the rest of the
 * execution. The id addresses a buffer the host holds, so what travels between nodes is this.
 *
 * What the handle defers is *parsing*, not transfer - the body has already crossed into the host by
 * the time Fetch continues, bounded by the response cap. Deferring the parse is what lets a failed
 * `JSON.parse` have an execution branch instead of being reported as a `null` that a body of `null`
 * is indistinguishable from.
 *
 * The host releases every body when the execution that fetched it ends, so a handle is reachable
 * only from its own execution chain. Nothing carries a response across events: an author who needs
 * the data later reads it and stores what they want.
 */
export type BlueprintResponseBody = {
  kind: "responseBody";
  id: string;
};

export function blueprintElementValueType(elementType: string | undefined): string {
  const safe = elementType?.trim();
  return safe ? `${BLUEPRINT_VALUE_TYPE_ELEMENT}:${safe}` : BLUEPRINT_VALUE_TYPE_ELEMENT;
}

export function isBlueprintElementValueType(valueType: string | undefined): boolean {
  return (
    valueType === BLUEPRINT_VALUE_TYPE_ELEMENT ||
    valueType?.startsWith(`${BLUEPRINT_VALUE_TYPE_ELEMENT}:`) === true
  );
}

export function blueprintElementTypeFromValueType(
  valueType: string | undefined
): string | undefined {
  if (!valueType?.startsWith(`${BLUEPRINT_VALUE_TYPE_ELEMENT}:`)) {
    return undefined;
  }
  const elementType = valueType.slice(BLUEPRINT_VALUE_TYPE_ELEMENT.length + 1).trim();
  return elementType || undefined;
}

export function areBlueprintElementValueTypesCompatible(
  sourceType: string | undefined,
  targetType: string | undefined
): boolean {
  if (!isBlueprintElementValueType(sourceType) || !isBlueprintElementValueType(targetType)) {
    return false;
  }
  if (sourceType === BLUEPRINT_VALUE_TYPE_ELEMENT || targetType === BLUEPRINT_VALUE_TYPE_ELEMENT) {
    return true;
  }
  return sourceType === targetType;
}

export function isBlueprintArrayValueType(valueType: string | undefined): boolean {
  return valueType === BLUEPRINT_VALUE_TYPE_ARRAY;
}

export function isBlueprintImageAssetValueType(valueType: string | undefined): boolean {
  return (
    valueType === BLUEPRINT_VALUE_TYPE_IMAGE_ASSET ||
    valueType === BLUEPRINT_VALUE_TYPE_IMAGE_ASSET_NULLABLE
  );
}

export function isBlueprintNullableImageAssetValueType(valueType: string | undefined): boolean {
  return valueType === BLUEPRINT_VALUE_TYPE_IMAGE_ASSET_NULLABLE;
}

export function isBlueprintTimerValueType(valueType: string | undefined): boolean {
  return valueType === BLUEPRINT_VALUE_TYPE_TIMER;
}

export function isBlueprintAnimationTokenValueType(valueType: string | undefined): boolean {
  return valueType === BLUEPRINT_VALUE_TYPE_ANIMATION_TOKEN;
}

export function toBlueprintImageAsset(
  assetId: string | null | undefined
): BlueprintImageAsset | null {
  const safe = typeof assetId === "string" ? assetId.trim() : "";
  return safe ? { kind: "imageAsset", assetId: safe } : null;
}

export function normalizeBlueprintImageAssetValue(value: unknown): BlueprintImageAsset | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return toBlueprintImageAsset(value);
  }
  const record = readRecord(value);
  if (!record) {
    return null;
  }
  if (record.kind !== "imageAsset") {
    return null;
  }
  return toBlueprintImageAsset(typeof record.assetId === "string" ? record.assetId : null);
}

export function blueprintImageAssetId(value: unknown): string | null {
  return normalizeBlueprintImageAssetValue(value)?.assetId ?? null;
}

export function toBlueprintTimerToken(id: string | null | undefined): BlueprintTimerToken | null {
  const safe = typeof id === "string" ? id.trim() : "";
  return safe ? { kind: "timer", id: safe } : null;
}

export function normalizeBlueprintTimerToken(value: unknown): BlueprintTimerToken | null {
  if (typeof value === "string") {
    return toBlueprintTimerToken(value);
  }
  const record = readRecord(value);
  if (!record || record.kind !== "timer") {
    return null;
  }
  return toBlueprintTimerToken(typeof record.id === "string" ? record.id : null);
}

export function isBlueprintSoundHandleValueType(valueType: string | undefined): boolean {
  return valueType === BLUEPRINT_VALUE_TYPE_SOUND_HANDLE;
}

export function toBlueprintSoundHandle(id: string | null | undefined): BlueprintSoundHandle | null {
  const safe = typeof id === "string" ? id.trim() : "";
  return safe ? { kind: "soundHandle", id: safe } : null;
}

export function normalizeBlueprintSoundHandle(value: unknown): BlueprintSoundHandle | null {
  if (typeof value === "string") {
    return toBlueprintSoundHandle(value);
  }
  const record = readRecord(value);
  if (!record || record.kind !== "soundHandle") {
    return null;
  }
  return toBlueprintSoundHandle(typeof record.id === "string" ? record.id : null);
}

export function isBlueprintResponseBodyValueType(valueType: string | undefined): boolean {
  return valueType === BLUEPRINT_VALUE_TYPE_RESPONSE_BODY;
}

export function toBlueprintResponseBody(
  id: string | null | undefined
): BlueprintResponseBody | null {
  const safe = typeof id === "string" ? id.trim() : "";
  return safe ? { kind: "responseBody", id: safe } : null;
}

export function normalizeBlueprintResponseBody(value: unknown): BlueprintResponseBody | null {
  if (typeof value === "string") {
    return toBlueprintResponseBody(value);
  }
  const record = readRecord(value);
  if (!record || record.kind !== "responseBody") {
    return null;
  }
  return toBlueprintResponseBody(typeof record.id === "string" ? record.id : null);
}

export function toBlueprintAnimationToken(
  id: string | null | undefined
): BlueprintAnimationToken | null {
  const safe = typeof id === "string" ? id.trim() : "";
  return safe ? { kind: "animation", id: safe } : null;
}

export function normalizeBlueprintAnimationToken(value: unknown): BlueprintAnimationToken | null {
  if (typeof value === "string") {
    return toBlueprintAnimationToken(value);
  }
  const record = readRecord(value);
  if (!record || record.kind !== "animation") {
    return null;
  }
  return toBlueprintAnimationToken(typeof record.id === "string" ? record.id : null);
}

const DEFAULT_VECTOR2D: BlueprintVector2D = { x: 0, y: 0 };
const DEFAULT_RGBA_COLOR: BlueprintRGBAColor = { r: 255, g: 255, b: 255, a: 1 };

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeByte(value: unknown, fallback: number): number {
  const n = toFiniteNumber(value);
  return n === undefined ? fallback : Math.round(clamp(n, 0, 255));
}

function normalizeAlpha(value: unknown, fallback: number): number {
  const n = toFiniteNumber(value);
  return n === undefined ? fallback : clamp(n, 0, 1);
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function normalizeBlueprintVector2D(value: unknown): BlueprintVector2D {
  const record = readRecord(value);
  if (!record) {
    return { ...DEFAULT_VECTOR2D };
  }
  return {
    x: toFiniteNumber(record.x) ?? DEFAULT_VECTOR2D.x,
    y: toFiniteNumber(record.y) ?? DEFAULT_VECTOR2D.y
  };
}

function parseHexColor(input: string): BlueprintRGBAColor | undefined {
  const trimmed = input.trim();
  const match = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(trimmed);
  if (!match) {
    return undefined;
  }
  const raw = match[1]!;
  const hex =
    raw.length === 3
      ? raw
          .split("")
          .map((ch) => `${ch}${ch}`)
          .join("")
      : raw.length === 8
        ? raw.slice(0, 6)
        : raw;
  const alphaHex = raw.length === 8 ? raw.slice(6, 8) : undefined;
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
    a: alphaHex ? parseInt(alphaHex, 16) / 255 : 1
  };
}

function parseRgbColor(input: string): BlueprintRGBAColor | undefined {
  const match = /^rgba?\(([^)]+)\)$/i.exec(input.trim());
  if (!match) {
    return undefined;
  }
  const parts = match[1]!.split(",").map((part) => Number(part.trim()));
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) {
    return undefined;
  }
  return {
    r: normalizeByte(parts[0], DEFAULT_RGBA_COLOR.r),
    g: normalizeByte(parts[1], DEFAULT_RGBA_COLOR.g),
    b: normalizeByte(parts[2], DEFAULT_RGBA_COLOR.b),
    a: normalizeAlpha(parts[3], 1)
  };
}

export function normalizeBlueprintRGBAColor(value: unknown): BlueprintRGBAColor {
  if (typeof value === "string") {
    return parseHexColor(value) ?? parseRgbColor(value) ?? { ...DEFAULT_RGBA_COLOR };
  }
  const record = readRecord(value);
  if (!record) {
    return { ...DEFAULT_RGBA_COLOR };
  }
  if (typeof record.hex === "string") {
    const parsed = parseHexColor(record.hex);
    if (parsed) {
      return {
        ...parsed,
        a: normalizeAlpha(record.alpha, parsed.a)
      };
    }
  }
  return {
    r: normalizeByte(record.r, DEFAULT_RGBA_COLOR.r),
    g: normalizeByte(record.g, DEFAULT_RGBA_COLOR.g),
    b: normalizeByte(record.b, DEFAULT_RGBA_COLOR.b),
    a: normalizeAlpha(record.a, DEFAULT_RGBA_COLOR.a)
  };
}

function byteToHex(value: number): string {
  return Math.round(clamp(value, 0, 255))
    .toString(16)
    .padStart(2, "0");
}

export function blueprintRGBAColorToHex(value: unknown): string {
  const color = normalizeBlueprintRGBAColor(value);
  return `#${byteToHex(color.r)}${byteToHex(color.g)}${byteToHex(color.b)}`;
}

export function blueprintRGBAColorToRgbaHex(value: unknown): string {
  const color = normalizeBlueprintRGBAColor(value);
  return `${byteToHex(color.r)}${byteToHex(color.g)}${byteToHex(color.b)}${byteToHex(color.a * 255)}`.toUpperCase();
}

export function blueprintRGBAColorToCss(value: unknown): string {
  const color = normalizeBlueprintRGBAColor(value);
  if (color.a >= 1) {
    return blueprintRGBAColorToHex(color);
  }
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${Number(color.a.toFixed(3))})`;
}
