/** Read a persisted number without treating empty or non-numeric values as zero or one. */
export function storedNumber(value: unknown): number {
    if (typeof value === "number") {
        return value;
    }
    return typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
}
