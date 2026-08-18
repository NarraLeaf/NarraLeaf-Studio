import type { VcsServerAuthority } from "./vcs";

/**
 * What the trust window is asked about.
 *
 * One address and the authority answering at it, and nothing else. The window puts a
 * single question to the author, and any further field it carried would be an invitation
 * to answer a different one.
 */
export interface ServerTrustPromptProps {
  /** The server the answer is about, e.g. `lore://studio.example.lan:41337`. */
  address: string;
  /** The authority answering at that address, read off the connection. */
  authority: VcsServerAuthority;
}

/**
 * How the window ended.
 *
 * `trusted` is what this machine now believes rather than which button was pressed: the
 * press only starts the install, and an operating system that refuses it leaves the
 * author with the same untrusted authority as before. `null` where the window was closed
 * without an answer, which the caller reads the same way as a refusal.
 */
export type ServerTrustPromptResult = { trusted: boolean } | null;
