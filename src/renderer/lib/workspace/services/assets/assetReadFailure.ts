/**
 * The `code` an asset read answers with when its bytes were read and could not be understood - an
 * image the decoder refused, audio with no stream it can measure, JSON that does not parse.
 *
 * A read that failed at the disk answers with the filesystem's own code (`FsRejectErrorCode`)
 * instead, and a surface words the two apart: a file that is not there is something the author can
 * put back, a file that is there and broken is something they have to replace. The `error` beside
 * either is written for the log - it is English, and a read failure's names the asset's storage
 * path, which is its id split into folders - so no surface shows it. See `describeAssetReadFailure`.
 */
export const ASSET_UNDECODABLE = "ASSET_UNDECODABLE";
