export function safeExecuteFn(fn: any) {
    if (typeof fn === "function") {
        return fn();
    }
}