import { audioTracksSpec } from "@shared/documents/specs";

/**
 * Which file the audio section writes, as the project-relative path the freeze policy takes.
 *
 * Read off the document spec rather than spelled here, for `dictionaryFreezeScope`'s reason: a path
 * written a second time is a path that falls behind the one `AudioTrackService` actually saves to,
 * and this one is compared against the set a live session declares writable.
 *
 * ⚠ **It covers the mixer and nothing else on this page.** The other sections of Project ▸ Game
 * write the `.nlproj`, which no session carries, so they keep the unscoped guard and stay grey - a
 * guard widened to the page would offer edits the write boundary throws away.
 */
export function audioTrackFreezeScope(): string {
    return audioTracksSpec.pathFor();
}
