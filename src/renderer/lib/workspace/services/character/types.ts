import type { NormalizedCrop } from "@/lib/utils/headCrop";
import type { PortraitCrop } from "@shared/types/character/model";

/**
 * The character model, which now lives in `@shared/types/character/model`.
 *
 * It moved because the character store became a versioned document: its spec parses, canonically
 * serializes and semantically diffs `editor/services/character.json` from the MAIN process, which
 * cannot import a renderer module. Everything is re-exported from here so the ninety-odd editor
 * modules that import "the character model" did not have to move with it, and so this stays the one
 * name the renderer imports it under.
 */
export * from "@shared/types/character/model";

/**
 * The shared {@link PortraitCrop} and the head-crop detector's {@link NormalizedCrop} are the same
 * rect, and this is where that stays true.
 *
 * They cannot be one type: the detector lives in the renderer (it decodes an image on a canvas) and
 * the crop is written to disk, so the disk shape has to be reachable from shared. Two structurally
 * identical types drift silently - a field added to one is simply not on the other, and every
 * assignment between them keeps compiling until the day one is renamed. These two assignments fail
 * the build instead.
 */
type _CropsAgree = [
  NormalizedCrop extends PortraitCrop ? true : never,
  PortraitCrop extends NormalizedCrop ? true : never
];
