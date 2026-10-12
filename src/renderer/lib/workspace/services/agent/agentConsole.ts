/**
 * The console tab agent calls are logged to. A module of its own so the console panel can name the
 * tab without importing the bridge and every tool behind it.
 *
 * Comments in English per project convention.
 */

/** The console tab every agent call is logged to. */
export const AGENT_CONSOLE_CHANNEL = "agent";
/** The `source` stamped on those lines. */
export const AGENT_CONSOLE_SOURCE = "Agent";
