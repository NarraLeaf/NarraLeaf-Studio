import { Fs } from "./fs";
import { Result } from "./types";

export async function readJson<T>(path: string): Promise<Result<T>> {
    const content = await Fs.read(path);
    if (!content.ok) {
        return {
            ok: false,
            error: content.error,
        };
    }
    return {
        ok: true,
        data: JSON.parse(content.data) as T,
    } satisfies Result<T, true>;
}
