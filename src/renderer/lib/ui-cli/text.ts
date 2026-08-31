/**
 * Spelling help for the command surface and the catalogue.
 *
 * Edit distance rather than substring matching, because the mistakes worth answering are the ones
 * inside the word: `nl.buton` is one edit from `nl.button` and contains none of it, and `--projct`
 * contains no substring of `--project` long enough to rank.
 *
 * Comments in English per project convention.
 */

/** The closest of a set of known words, when one of them is close enough to have been meant. */
export function didYouMean(input: string, known: readonly string[]): string {
    const best = nearest(input, known, 1)[0];
    return best ? `Did you mean "${best}"?` : "";
}

/** The `limit` closest of `known`, nearest first, dropping anything too far to have been a typo. */
export function nearest(input: string, known: readonly string[], limit: number): string[] {
    return known
        .map(candidate => ({ candidate, distance: editDistance(input.toLowerCase(), candidate.toLowerCase()) }))
        .filter(scored => scored.distance <= Math.max(2, Math.floor(input.length / 3)))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, limit)
        .map(scored => scored.candidate);
}

export function editDistance(a: string, b: string): number {
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
        const current = [i];
        for (let j = 1; j <= b.length; j += 1) {
            current[j] = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
        }
        previous = current;
    }
    return previous[b.length];
}
