/**
 * How the JSON path nodes (`Get JSON Field`, `Set JSON Field`, `Remove JSON Field`) read a path: one
 * reading, shared by the nodes that run it and the analyses that predict what they do.
 *
 * A path is field names joined by dots; a backslash makes the next character literal, so `a\.b` is
 * the one field `a.b`. Empty segments are dropped - `.screenshot`, `screenshot.` and `screenshot` all
 * name the same field - and a path with no segment left names the value itself: reading it gives the
 * whole value, and setting it replaces the whole value.
 *
 * The nodes trim the path before splitting it; callers do the same.
 *
 * Comments in English per project convention.
 */
export function splitJsonPath(path: string): string[] {
    const out: string[] = [];
    let current = "";
    let escaping = false;
    for (const ch of path) {
        if (escaping) {
            current += ch;
            escaping = false;
            continue;
        }
        if (ch === "\\") {
            escaping = true;
            continue;
        }
        if (ch === ".") {
            out.push(current);
            current = "";
            continue;
        }
        current += ch;
    }
    if (escaping) {
        current += "\\";
    }
    out.push(current);
    return out.filter(segment => segment.length > 0);
}
