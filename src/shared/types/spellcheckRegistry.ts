/**
 * The dictionary registry index, as Studio reads it.
 *
 * Shaped after `@shared/types/pluginRegistry` on purpose: the two do the same job, and the plugin
 * store's client is what the dictionary client is modelled on. Everything here is remote input and
 * is validated field by field before it becomes one of these records.
 */

/** One dictionary the registry offers. */
export type SpellcheckRegistryEntry = {
  /** Language tag, e.g. `en-GB`. Also the filename in the cache, hence the pattern check. */
  code: string;
  /** Display name, e.g. `English (United Kingdom)`. */
  name: string;
  /** Compressed size in bytes, so a download can be described before it starts. */
  bytes: number;
  /**
   * SPDX-style licence identifier of the word list.
   *
   * Required, not optional. Only permissively licensed lists are hosted and the licence has to
   * be displayable beside the entry - an entry that will not say costs nothing to drop.
   */
  license: string;
  /** Lower-case hex sha256 of the gzipped bytes, checked before anything is written. */
  sha256: string;
  /** Absolute `https:` URL of the gzipped word list. */
  download: string;
  /** Entry count, when the index states it. Shown as a rough sense of coverage. */
  words?: number;
};

export type SpellcheckRegistryIndex = {
  formatVersion: number;
  /** Where the index came from, for the "who published this" line. */
  repository: string;
  dictionaries: SpellcheckRegistryEntry[];
};
