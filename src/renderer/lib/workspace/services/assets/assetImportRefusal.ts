import type { FsRejectErrorCode } from "@shared/types/os";
import type { RequestStatus } from "@shared/types/ipcEvents";
import type { RemoteAssetFetchErrorCode } from "@shared/types/remoteAsset";
import type { Asset, AssetSource } from "./types";
import type { AssetType } from "./assetTypes";

/**
 * Why one file of an import did not become an asset - or did not become the new contents of one - as
 * data rather than prose.
 *
 * The importer knows exactly what went wrong and nothing about the language the author reads Studio
 * in, and its `error` sentence is written for the log: it is English, and it names both the source
 * path and the destination - the asset's id split into folders. So a failed file also carries one of
 * these, and the surface that lists it (the asset panel's import strip, the voice panel's import
 * summary) turns it into a sentence with `describeAssetImportRefusal`.
 *
 * A failure with no refusal is one no author can act on; it is listed by name alone.
 */
export type AssetImportRefusal =
    /** The file picked could not be read. `fsCode` says why, when the disk said. */
    | { kind: "sourceUnreadable"; fsCode?: FsRejectErrorCode }
    /** The file is there and has nothing in it. */
    | { kind: "empty" }
    /** The extension is not one this kind of asset takes. */
    | { kind: "wrongType"; ext: string }
    /**
     * A format the player cannot use at all, with the two formats to convert to. `use` is what an
     * asset of this type is for, so the sentence can say "cannot play .avi" rather than "cannot read".
     */
    | { kind: "cannotUse"; ext: string; use: "display" | "play" | "use"; convertTo: readonly [string, string] }
    /** The bytes are not what the extension says: a JPEG named `.png`, a font collection named `.ttf`. */
    | { kind: "mismatch"; ext: string; actual: string }
    /** A file that should parse (JSON) and does not. */
    | { kind: "undecodable" }
    /** Copying into the project failed. `fsCode` says why, when the disk said. */
    | { kind: "copyFailed"; fsCode?: FsRejectErrorCode }
    /** A model is imported as a folder, and this is not one. */
    | { kind: "notAFolder" }
    /** A model folder with no files in it. */
    | { kind: "emptyFolder" }
    /** A model folder whose copy in the project does not hold every file the source did. */
    | { kind: "copyIncomplete" }
    /** The project is frozen or being re-read, and takes no new content until that is over. */
    | { kind: "projectNotAccepting" }
    /**
     * A URL the main process could not fetch, by the fetcher's code: no answer, a status that is not
     * a success, a file over the ceiling, a project that is not trusted.
     */
    | { kind: "remoteFetch"; code: RemoteAssetFetchErrorCode }
    /** The server answered an import with "not modified", which leaves nothing to store. */
    | { kind: "remoteNoContent" }
    /** A URL the bytes of which are a model: a model is a folder, and one URL cannot stand for one. */
    | { kind: "remoteBundle" }
    /**
     * Sound or video from a URL the player cannot play. A local file is offered a conversion; bytes
     * pinned to a URL cannot be converted in place, so this is a refusal with the reason in it.
     */
    | { kind: "remoteUnplayable"; cause: RemoteUnplayableCause }
    /**
     * A URL that answered with a web page where a file was expected: a sign-in page, an error page
     * served with a success status, a consent wall.
     */
    | { kind: "remotePage" }
    /**
     * A URL whose answer is not media of the kind the asset is: declared as text or a document, or
     * bytes with no signature of any format the asset type takes. `expected` is the sidebar section
     * the asset belongs to, which is how the author named what they were importing.
     */
    | { kind: "remoteUnrecognized"; expected: RemoteMediaSection };

/** The sidebar sections whose assets are media with a signature to check, by `AssetCategory` value. */
export type RemoteMediaSection = "image" | "media" | "font";

/** Which part of a fetched media file the player cannot read. */
export type RemoteUnplayableCause =
    /** Streams in codecs nothing here decodes, by their probe names: `hevc`, `prores`. */
    | { kind: "codecs"; codecs: readonly string[] }
    /** A container nothing here opens, by its probe name when the probe gave one. */
    | { kind: "container"; container: string | null }
    /** Nothing in it is a sound or a picture that can be played. */
    | { kind: "noStreams" };

/** An answer from a step that brings a picked file into the library: what it made, or why not. */
export type RefusableStatus<T> = RequestStatus<T> & { refusal?: AssetImportRefusal };

/** One file's answer from the importer: an asset, or why not. */
export type AssetImportStatus<T extends AssetType> = RefusableStatus<Asset<T, AssetSource.Local>>;
