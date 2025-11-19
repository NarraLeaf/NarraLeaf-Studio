import path from "path";

export function normalizePath(p: string): string {
    return path.normalize(p).replace(/\\/g, "/");
}