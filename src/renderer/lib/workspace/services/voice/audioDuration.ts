/**
 * How long a take is.
 *
 * `VoiceUnit.duration` has been in the model since the module shipped and nothing ever wrote it, so
 * a director could not see that a 40-word line came back as a two-second read. It is measured here,
 * once, when a clip is linked - not on every render, and never by decoding the whole file: the
 * media element reports duration from the container header at `loadedmetadata`.
 *
 * Everything about this is best-effort. A container the browser cannot parse, a stream with no
 * duration in its header, or a slow decode all resolve to `undefined`, and the unit is stored
 * without a duration exactly as before. Comments in English per project convention.
 */

/** Give up rather than hold a batch import open on one unreadable file. */
const METADATA_TIMEOUT_MS = 5000;

export async function readAudioDuration(bytes: Uint8Array): Promise<number | undefined> {
  if (
    typeof Audio !== "function" ||
    typeof URL?.createObjectURL !== "function" ||
    bytes.length === 0
  ) {
    return undefined;
  }
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
  const audio = new Audio();
  try {
    return await new Promise<number | undefined>((resolve) => {
      const finish = (value: number | undefined) => {
        clearTimeout(timer);
        audio.onloadedmetadata = null;
        audio.onerror = null;
        resolve(value);
      };
      const timer = setTimeout(() => finish(undefined), METADATA_TIMEOUT_MS);
      audio.onloadedmetadata = () => {
        // A stream with no duration in its header reports Infinity, which is not a length.
        const duration = audio.duration;
        finish(Number.isFinite(duration) && duration > 0 ? duration : undefined);
      };
      audio.onerror = () => finish(undefined);
      audio.preload = "metadata";
      audio.src = url;
    });
  } finally {
    audio.src = "";
    URL.revokeObjectURL(url);
  }
}

/** Format a duration for a table cell: `1:04`, or `0:07`. Empty when unknown. */
export function formatVoiceDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return "";
  }
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
