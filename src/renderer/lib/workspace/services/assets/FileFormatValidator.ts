import { AssetExtensions, AssetType } from "./assetTypes";
import {
  parseSharedBlueprintAssetJson,
  SharedBlueprintAssetParseError
} from "./blueprintAssetSchema";

export type FileFormatValidationResult =
  | {
      success: true;
      data: void;
      error?: never;
    }
  | {
      success: false;
      data?: never;
      error?: string;
    };

/**
 * Editors on Windows commonly write UTF-8 with a byte-order mark, which `JSON.parse` rejects as
 * an unexpected token. The mark is not part of the document, so it is dropped before parsing.
 */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Service for validating file formats based on content and extensions
 */
export class FileFormatValidator {
  /**
   * Validate file format by checking magic bytes and extension consistency
   */
  public async validateFileFormat(
    type: AssetType,
    path: string,
    buffer: Uint8Array
  ): Promise<FileFormatValidationResult> {
    const parts = path.split(".");
    const fileExt = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";

    // Check if file extension is in the allowed list for this asset type
    const allowedExtensions = AssetExtensions[type];
    const allowAll = allowedExtensions.includes("*");
    if (!allowAll && !allowedExtensions.includes(fileExt)) {
      return {
        success: false,
        error: `File extension .${fileExt} is not allowed for ${type} assets. Allowed extensions: ${allowedExtensions.join(", ")}`
      };
    }

    // Some of those allowed extensions are only allowed as far as the *picker*: the engine cannot
    // demux them at all, so importing one yields an asset that never plays. Refuse it here, while
    // the author still has the source file in hand and can convert it.
    //
    // The message names NarraLeaf rather than Chromium on purpose. Which browser engine is inside
    // the player is Studio's business, not the author's — they did not choose it and cannot swap
    // it, so naming it turns an actionable sentence into trivia.
    const undecodable = UNDECODABLE_EXTENSIONS[type]?.[fileExt];
    if (undecodable) {
      return {
        success: false,
        error:
          `NarraLeaf cannot ${UNDECODABLE_VERB[type] ?? "read"} .${fileExt} files.` +
          ` Convert to ${undecodable} before importing.`
      };
    }

    let detectedFormat: string | null = null;

    // Detect format based on asset type
    switch (type) {
      case AssetType.Image:
        detectedFormat = this.detectImageFormat(buffer);
        break;
      case AssetType.Audio:
        detectedFormat = this.detectAudioFormat(buffer);
        break;
      case AssetType.Video:
        detectedFormat = this.detectVideoFormat(buffer);
        break;
      case AssetType.Font:
        detectedFormat = this.detectFontFormat(buffer);
        break;
      case AssetType.JSON:
        // JSON is validated by parsing it: a file that cannot be parsed is refused here
        // rather than imported and left to fail in every consumer downstream. The parser's
        // own message carries the position, which is the only actionable part.
        try {
          JSON.parse(stripBom(new TextDecoder().decode(buffer)));
          return { success: true, data: void 0 };
        } catch (e) {
          return {
            success: false,
            error: `Not a valid JSON file: ${e instanceof Error ? e.message : "parse failed"}`
          };
        }
      case AssetType.Blueprint:
        try {
          const text = stripBom(new TextDecoder().decode(buffer));
          parseSharedBlueprintAssetJson(text);
          return { success: true, data: void 0 };
        } catch (e) {
          const msg =
            e instanceof SharedBlueprintAssetParseError
              ? e.message
              : "Invalid shared blueprint asset";
          return {
            success: false,
            error: msg
          };
        }
      case AssetType.Other:
        // No validation for other types (extension check is sufficient)
        return { success: true, data: void 0 };
    }

    // If format was detected, verify it matches the file extension
    if (detectedFormat && detectedFormat !== "unknown") {
      const formatMatches = this.checkFormatMatch(type, fileExt, detectedFormat);
      if (!formatMatches) {
        return {
          success: false,
          error: `File format mismatch: file extension is .${fileExt.toUpperCase()} but file content indicates ${detectedFormat.toUpperCase()} format. The file may be corrupted or misnamed.`
        };
      }
    }

    return { success: true, data: void 0 };
  }

  private detectImageFormat(buffer: Uint8Array): string | null {
    if (buffer.length < 4) return null;

    // JPEG
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      return "jpeg";
    }

    // PNG
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return "png";
    }

    // GIF
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
      return "gif";
    }

    // WebP
    if (buffer.length >= 12) {
      const riffStr = String.fromCharCode(...buffer.subarray(0, 4));
      const webpStr = String.fromCharCode(...buffer.subarray(8, 12));
      if (riffStr === "RIFF" && webpStr === "WEBP") {
        return "webp";
      }
    }

    // BMP
    if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
      return "bmp";
    }

    // TIFF
    if (
      (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
      (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a)
    ) {
      return "tiff";
    }

    return "unknown";
  }

  private detectAudioFormat(buffer: Uint8Array): string | null {
    if (buffer.length < 12) return null;

    // MP3
    if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
      return "mp3";
    }

    // An 11-bit frame sync, which an MPEG audio frame header and an ADTS AAC header both open
    // with. The two are told apart by the layer field in the second byte: MPEG numbers its layers
    // I/II/III as 0b11/0b10/0b01, and ADTS is required to write 0b00 there. Reading it as MP3
    // regardless is why every raw .aac file used to be rejected as misnamed.
    if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
      const layer = (buffer[1] >> 1) & 0x03;
      return layer === 0b00 ? "aac" : "mp3";
    }

    // WAV
    if (
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x41 &&
      buffer[10] === 0x56 &&
      buffer[11] === 0x45
    ) {
      return "wav";
    }

    // OGG
    if (buffer[0] === 0x4f && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) {
      return "ogg";
    }

    // FLAC
    if (buffer[0] === 0x66 && buffer[1] === 0x4c && buffer[2] === 0x61 && buffer[3] === 0x43) {
      return "flac";
    }

    // M4A/AAC
    if (
      buffer.length >= 8 &&
      buffer[4] === 0x66 &&
      buffer[5] === 0x74 &&
      buffer[6] === 0x79 &&
      buffer[7] === 0x70
    ) {
      return "m4a";
    }

    return "unknown";
  }

  private detectVideoFormat(buffer: Uint8Array): string | null {
    if (buffer.length < 12) return null;

    // MP4/M4V
    if (
      buffer.length >= 8 &&
      buffer[4] === 0x66 &&
      buffer[5] === 0x74 &&
      buffer[6] === 0x79 &&
      buffer[7] === 0x70
    ) {
      if (buffer.length >= 12) {
        const brand = String.fromCharCode(buffer[8], buffer[9], buffer[10], buffer[11]);
        if (brand === "M4V " || brand === "M4VH" || brand === "M4VP") {
          return "m4v";
        }
        if (brand === "qt  ") {
          return "mov";
        }
      }
      return "mp4";
    }

    // WebM/MKV
    if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
      return "webm"; // Could also be mkv, but webm is more common in web contexts
    }

    // AVI
    if (
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x41 &&
      buffer[9] === 0x56 &&
      buffer[10] === 0x49 &&
      buffer[11] === 0x20
    ) {
      return "avi";
    }

    return "unknown";
  }

  private detectFontFormat(buffer: Uint8Array): string | null {
    if (buffer.length < 4) return null;

    // TTF
    if (buffer[0] === 0x00 && buffer[1] === 0x01 && buffer[2] === 0x00 && buffer[3] === 0x00) {
      return "ttf";
    }

    // OTF
    if (buffer[0] === 0x4f && buffer[1] === 0x54 && buffer[2] === 0x54 && buffer[3] === 0x4f) {
      return "otf";
    }

    // WOFF
    if (buffer[0] === 0x77 && buffer[1] === 0x4f && buffer[2] === 0x46 && buffer[3] === 0x46) {
      return "woff";
    }

    // WOFF2
    if (buffer[0] === 0x77 && buffer[1] === 0x4f && buffer[2] === 0x46 && buffer[3] === 0x32) {
      return "woff2";
    }

    // EOT
    if (buffer.length >= 36 && buffer[34] === 0x4c && buffer[35] === 0x50) {
      return "eot";
    }

    return "unknown";
  }

  /**
   * The canonical extension for what these bytes actually are, or null when nothing is recognised.
   *
   * For callers that have bytes but no trustworthy filename — a remote asset whose URL ends in a
   * slash or a query string is the case this exists for. Everywhere a real file was picked, its
   * own extension is the better answer and this is not needed.
   *
   * Returns the *first* extension of the detected format's list, which is the conventional one
   * (`jpeg` -> `jpg`). Deliberately not consulted for `Other`, whose whole point is that Studio has
   * no opinion about the bytes.
   */
  public sniffExtension(type: AssetType, buffer: Uint8Array): string | null {
    let detected: string | null = null;
    switch (type) {
      case AssetType.Image:
        detected = this.detectImageFormat(buffer);
        break;
      case AssetType.Audio:
        detected = this.detectAudioFormat(buffer);
        break;
      case AssetType.Video:
        detected = this.detectVideoFormat(buffer);
        break;
      case AssetType.Font:
        detected = this.detectFontFormat(buffer);
        break;
      case AssetType.JSON:
        return "json";
      case AssetType.Blueprint:
        return "nlbp";
      default:
        return null;
    }
    if (!detected || detected === "unknown") {
      return null;
    }
    return FORMAT_EXTENSIONS[type][detected]?.[0] ?? null;
  }

  private checkFormatMatch(type: AssetType, extension: string, detectedFormat: string): boolean {
    const formatMaps: Record<AssetType, Record<string, string[]>> = FORMAT_EXTENSIONS;

    const formatMap = formatMaps[type];
    for (const [_format, extensions] of Object.entries(formatMap)) {
      if (extensions.includes(detectedFormat) && extensions.includes(extension)) {
        return true;
      }
    }

    return false;
  }
}

/**
 * Which file extensions each detected format may legitimately wear, per asset type.
 *
 * Read two ways, and both matter: {@link FileFormatValidator.checkFormatMatch} asks whether a name
 * and its bytes agree, and {@link FileFormatValidator.sniffExtension} takes the first entry as the
 * conventional extension for bytes with no name to check — so the first entry of each list is a
 * decision, not an accident.
 *
 * Every extension named here must also be in {@link AssetExtensions} for the same type, or it is
 * unreachable: the extension gate runs first and would have rejected the file already. A test in
 * `FileFormatValidator.test.ts` enforces that, because the two tables drifting apart is what made
 * `.apng`, `.opus`, `.pjp` and friends impossible to import.
 */
export const FORMAT_EXTENSIONS: Record<AssetType, Record<string, string[]>> = {
  [AssetType.Image]: {
    // APNG is a PNG: same signature, animation carried in ancillary chunks.
    jpeg: ["jpg", "jpeg", "jpe", "jfif", "pjpeg", "pjp"],
    png: ["png", "apng"],
    gif: ["gif"],
    webp: ["webp"],
    bmp: ["bmp", "dib"],
    tiff: ["tiff", "tif"]
  },
  [AssetType.Audio]: {
    mp3: ["mp3"],
    wav: ["wav", "wave"],
    // Opus ships in an Ogg container, so its bytes are indistinguishable from any other .ogg.
    ogg: ["ogg", "oga", "opus"],
    flac: ["flac"],
    // Raw ADTS. `.aac` is also written by encoders that emit MPEG-4 audio, hence its second home
    // under `m4a` below - either byte layout under that name is legitimate.
    aac: ["aac"],
    m4a: ["m4a", "aac"]
  },
  [AssetType.Video]: {
    // The whole ISO-BMFF family shares the `ftyp` box; only a handful of brands are distinctive
    // enough to name a format of their own, and the rest land here. `.f4v` is Adobe's name for
    // the same layout and was rejected for years by omission alone — it is in `AssetExtensions`,
    // so the file reached this check, and then matched no format.
    mp4: ["mp4", "m4v", "3gp", "3g2", "m4b", "m4r", "f4v"],
    m4v: ["m4v", "mp4"],
    webm: ["webm", "mkv"],
    avi: ["avi"],
    mov: ["mov", "qt"]
  },
  [AssetType.Font]: {
    ttf: ["ttf"],
    otf: ["otf"],
    woff: ["woff"],
    woff2: ["woff2"],
    eot: ["eot"]
  },
  [AssetType.JSON]: {},
  [AssetType.Blueprint]: {},
  // A bundle is a directory; there is no single file whose magic bytes could be checked.
  [AssetType.Model]: {},
  [AssetType.Other]: {}
};

function convertTo(extensions: string[], suggestion: string): Record<string, string> {
  return Object.fromEntries(extensions.map((extension) => [extension, suggestion]));
}

/**
 * Extensions that reach Chromium's demuxer and produce nothing, mapped to what to convert them to.
 *
 * Measured against Chromium 140 (Electron 38): each of these fails with
 * `DEMUXER_ERROR_COULD_NOT_OPEN` - not a codec that plays badly, not one stream out of two, no
 * playable content at all. Importing one used to succeed and the asset broke later, at preview or at
 * runtime, far from the decision that caused it.
 *
 * They stay in {@link AssetExtensions} so the file dialog still lists them; the refusal lives here.
 * That is also the seam where a future transcoder turns "cannot" into an offer to convert, so the
 * message names a target format rather than just saying no.
 *
 * Nothing in the ISO-BMFF or Matroska families belongs here - `.mkv`, `.mka`, `.mov`, `.qt`, `.3gp`,
 * `.m4v`, `.m4b` and `.m4r` were all measured playing.
 */
/**
 * What the refusal says this type's assets are *for*, because "cannot play a .tiff" is nonsense and
 * reads as a bug in the sentence rather than a fact about the file. Caught only by importing one
 * into the running app — the tests asserted the format list, which was right, and the verb, which
 * was not.
 */
const UNDECODABLE_VERB: Partial<Record<AssetType, string>> = {
  [AssetType.Image]: "display",
  [AssetType.Audio]: "play",
  [AssetType.Video]: "play"
};

export const UNDECODABLE_EXTENSIONS: Partial<Record<AssetType, Record<string, string>>> = {
  // Chromium has no TIFF decoder, and XBM (an X11-era C source format) was measured failing too.
  [AssetType.Image]: convertTo(["tif", "tiff", "xbm"], ".png or .webp"),
  [AssetType.Audio]: convertTo(["aiff", "aif", "aifc", "mp2"], ".mp3 or .wav"),
  [AssetType.Video]: convertTo(
    [
      "avi",
      "flv",
      "wmv",
      "asf",
      "mpg",
      "mpeg",
      "mpe",
      "mpv",
      "m2v",
      "ts",
      "m2ts",
      "mts",
      "m2t",
      "vob"
    ],
    ".mp4 or .webm"
  )
};
