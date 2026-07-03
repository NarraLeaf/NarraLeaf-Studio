const STORY_UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidStoryId(value: unknown): value is string {
    return typeof value === "string" && STORY_UUID_V4_PATTERN.test(value);
}

export function assertValidStoryId(value: unknown, label = "Story id"): asserts value is string {
    if (!isValidStoryId(value)) {
        throw new Error(`${label} must be a UUID v4 string`);
    }
}

export function isValidStoryEntityId(value: unknown): value is string {
    return isValidStoryId(value);
}

export function assertValidStoryEntityId(value: unknown, label = "Story entity id"): asserts value is string {
    if (!isValidStoryEntityId(value)) {
        throw new Error(`${label} must be a UUID v4 string`);
    }
}
