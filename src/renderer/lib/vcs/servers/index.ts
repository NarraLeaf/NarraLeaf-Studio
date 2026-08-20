/**
 * A server, as every screen that shows one sees it.
 *
 * Settings adds and removes them, the version rail points a project at one, and the
 * project wizard opens something already on one. All three read the same list through
 * {@link useServers}, name it with {@link serverDisplayName}, and draw it with
 * {@link ServerRow} - so a server looks and reads the same wherever it turns up, and
 * there is one place to change when it should not.
 */
export { ServerRow } from "./ServerRow";
export type { ServerRowProps } from "./ServerRow";
export { serverDisplayName, serverHost } from "./serverIdentity";
export { useServers } from "./useServers";
export type { ServersState } from "./useServers";
