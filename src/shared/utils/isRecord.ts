/** Whether `value` is a non-null object that is not an array: the shape a JSON object decodes to. */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
