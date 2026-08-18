import { Logger } from "@shared/utils/logger";
import type { DownloadRewriteRule } from "@shared/types/downloadSource";
import { DOWNLOAD_REWRITES_KEY } from "@shared/types/downloadSource";
import {
  describeRewrite,
  normalizeRewriteRules,
  rewriteDownloadUrl
} from "@shared/utils/downloadSource";

/**
 * The main process's view of the author's download rewrites.
 *
 * A module-level source rather than a parameter threaded through every client, because the
 * alternative is passing the same array through `resolve` -> `fetchRegistryIndex` ->
 * `downloadIcon` and three more chains that exist to fetch one URL. The clients keep their
 * signatures; the rewrite is applied at the single point each of them turns a URL into a
 * request.
 *
 * Deliberately reads through a callback rather than caching an array: global state is written
 * from the Settings window at any moment, and a snapshot taken at startup would leave an
 * author's new mirror inert until they restarted. Reading is a synchronous store lookup.
 *
 * The build worker is a separate process and cannot see this - it receives its rules in the
 * worker config, the same way `electronMirror` already travels.
 */

const logger = new Logger("DownloadRewrites");

type RuleSource = () => unknown;

let source: RuleSource | null = null;

/** Wired once by `App`, from global state. Tests set their own. */
export function setDownloadRewriteSource(fn: RuleSource | null): void {
  source = fn;
}

/** The rules as stored, normalized. Never throws - an unreadable store means no rewrites. */
export function currentDownloadRewrites(): DownloadRewriteRule[] {
  if (!source) {
    return [];
  }
  try {
    return normalizeRewriteRules(source());
  } catch {
    return [];
  }
}

/**
 * The address to actually fetch, plus the log line R4 asks for.
 *
 * `log` lets a caller that already has a channel the author is watching (the build log) put the
 * line where they will see it; without one it goes to the main log, which is what the
 * diagnostics bundle carries.
 */
export function applyDownloadRewrite(url: string, log?: (message: string) => void): string {
  const outcome = rewriteDownloadUrl(url, currentDownloadRewrites());
  const line = describeRewrite(url, outcome);
  if (line) {
    if (log) {
      log(line);
    } else {
      logger.info(`[Network] ${line}`);
    }
  }
  return outcome.url;
}

/** The global-state key this module reads, re-exported so callers do not restate the string. */
export { DOWNLOAD_REWRITES_KEY };
