export function keyboardBlueprintPayload(event: KeyboardEvent): Record<string, unknown> {
    return {
        key: event.key,
        code: event.code,
        repeat: event.repeat,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
    };
}
