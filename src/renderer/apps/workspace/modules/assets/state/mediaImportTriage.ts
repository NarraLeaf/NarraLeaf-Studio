import {
  AssetCategory,
  AssetExtensions,
  AssetType
} from "@/lib/workspace/services/assets/assetTypes";
import type { MediaProbeOutcome } from "@shared/types/mediaProbe";
import {
  fileExtensionOf,
  imageConvertTargetFor,
  type MediaConvertTarget
} from "@shared/types/mediaConvert";
import { isRefusedMediaFileName, type MediaSupportVerdict } from "@shared/utils/mediaSupport";

/**
 * Sorting the files an author is importing into the ones that will play and the ones that will not.
 *
 * This is the half of the media pipeline the author meets. The verdict itself comes from
 * `@shared/utils/mediaSupport` by way of the main process's probe; nothing here re-decides whether a
 * file plays. What it decides is **which question to ask about each file**, which is not the same
 * thing and is where the cost lives: probing is a process spawn per file, and a folder of two hundred
 * PNGs must not pay for it.
 *
 * Nothing here starts a conversion or touches disk. It produces a plan; the dialog shows it and the
 * author says what happens next.
 */

/** Which of the dialog's three lists a file belongs in. Ordered as the dialog renders them. */
export type MediaImportGroup =
  /** Converts with the picture and sound carried across untouched. */
  | "lossless"
  /** Converts by rebuilding the picture and sound, which costs quality and time. */
  | "lossy"
  /** Nothing to offer. The file is not something the engine could ever play. */
  | "refused";

/** Why a refused file was refused, as the one sentence the dialog shows for it. */
export type MediaImportRefusal = "notMedia" | "noStreams";

export type MediaImportProblem = {
  /** Absolute source path, exactly as the importer would have received it. */
  path: string;
  group: MediaImportGroup;
  /** What to convert it into. `null` only for {@link MediaImportGroup} `refused`. */
  target: MediaConvertTarget | null;
  /**
   * Source duration in microseconds, straight from the probe that produced `target`.
   *
   * Carried rather than re-derived because it is the only number that turns ffmpeg's position
   * report into a percentage, and the probe already printed it. `null` is a real answer - a still
   * image has no duration, and neither do some raw streams - and must be passed on as `null`
   * rather than guessed at.
   */
  durationUs: number | null;
  refusal?: MediaImportRefusal;
  /**
   * Whether importing this file unconverted still gets the author something.
   *
   * True only when the container opens *and* at least one stream decodes: an HEVC recording with
   * AAC audio imports and plays its sound with a black picture. When the container will not open,
   * nothing plays at all and there is no partial result to offer - which is the difference between
   * the dialog offering "import without converting" and offering "skip these files".
   */
  partiallyUsable: boolean;
};

export type MediaImportPlan = {
  /** Paths that need nothing done to them. Handed to the importer as they are. */
  ready: string[];
  /** Everything the dialog has to ask about. Empty means no dialog. */
  problems: MediaImportProblem[];
};

/**
 * Extensions worth spawning a probe for.
 *
 * The audio and video member types of the Media section, which is the set of names the picker
 * offers there. A file the section would not have accepted cannot reach this anyway.
 */
const PROBE_EXTENSIONS: ReadonlySet<string> = new Set([
  ...AssetExtensions[AssetType.Audio],
  ...AssetExtensions[AssetType.Video]
]);

/**
 * Whether a section's imports are worth checking at all.
 *
 * Only the two sections that hold something a player has to decode. A font, a JSON file or anything
 * under Other is bytes Studio has no playback opinion about, and probing them would be a process
 * spawn to answer a question nobody asked.
 */
export function categoryNeedsMediaTriage(category: AssetCategory): boolean {
  return category === AssetCategory.Image || category === AssetCategory.Media;
}

/** The reading of a probed verdict that decides which list the file lands in. */
function problemFromVerdict(
  path: string,
  verdict: MediaSupportVerdict,
  durationUs: number | null
): MediaImportProblem | null {
  if (verdict.tier === "accept") {
    return null;
  }
  if (verdict.tier === "refuse") {
    return {
      path,
      group: "refused",
      target: null,
      durationUs: null,
      refusal: verdict.reason === "not-media" ? "notMedia" : "noStreams",
      partiallyUsable: false
    };
  }
  // `remux` and `reencode` both carry a target; the classifier never returns one without it.
  return {
    path,
    group: verdict.tier === "remux" ? "lossless" : "lossy",
    target: verdict.target,
    durationUs,
    partiallyUsable:
      verdict.tier === "reencode" &&
      verdict.container.demuxable &&
      verdict.streams.some((stream) => stream.decodable)
  };
}

/**
 * Sort a list of paths into what imports as it is and what the author has to be asked about.
 *
 * `probe` is injected so this can be tested without a main process, and returns `null` for the calls
 * that never happened.
 *
 * **An unanswerable probe means "import it".** A host with no ffprobe, a timeout, a file the demuxer
 * would not parse: none of those is evidence the file is broken, and refusing on the strength of a
 * question that was never answered would make a machine without the tool unable to import media it
 * imports perfectly well today. The existing format checks still run afterwards.
 */
export async function planMediaImport(
  paths: readonly string[],
  probe: (path: string) => Promise<MediaProbeOutcome | null>
): Promise<MediaImportPlan> {
  const plan: MediaImportPlan = { ready: [], problems: [] };

  for (const path of paths) {
    // Decided by name, and only here. A `.tif` is a TIFF; there is no codec axis to be wrong
    // about, so there is nothing for a probe to add and no reason to pay for one.
    const imageTarget = imageConvertTargetFor(path);
    if (imageTarget) {
      plan.problems.push({
        path,
        group: "lossless",
        target: imageTarget,
        durationUs: null,
        partiallyUsable: false
      });
      continue;
    }

    // Answered before the probe rather than by it, and not only to save a spawn: FFmpeg's
    // playlist demuxers resolve the entries they contain, and an entry can be an `http://` URL.
    // Handing an author-supplied `.m3u8` to ffprobe is handing a stranger's file a network
    // fetch. A playlist, a DRM wrapper and a MIDI score have no conversion that would produce
    // what the author expected, so the answer is the same either way.
    if (isRefusedMediaFileName(path)) {
      plan.problems.push({
        path,
        group: "refused",
        target: null,
        durationUs: null,
        refusal: "notMedia",
        partiallyUsable: false
      });
      continue;
    }

    if (!PROBE_EXTENSIONS.has(fileExtensionOf(path))) {
      plan.ready.push(path);
      continue;
    }

    const outcome = await probe(path);
    if (!outcome || outcome.status !== "probed") {
      plan.ready.push(path);
      continue;
    }

    const problem = problemFromVerdict(path, outcome.verdict, outcome.durationUs);
    if (problem) {
      plan.problems.push(problem);
    } else {
      plan.ready.push(path);
    }
  }

  return plan;
}

/** The problems the dialog can offer to convert, in the order it lists them. */
export function convertibleProblems(problems: readonly MediaImportProblem[]): MediaImportProblem[] {
  return problems.filter((problem) => problem.group !== "refused");
}
