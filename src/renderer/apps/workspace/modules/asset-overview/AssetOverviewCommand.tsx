/**
 * Retired. Renders nothing and registers nothing.
 *
 * This used to register `assets:open-overview`, the palette entry that opened the asset overview as
 * its own editor tab. The overview is now the assets panel's third view (see `AssetsPanel`'s view
 * toggle), so there is no separate page for a command to open, and the standalone entry is gone
 * along with the tab and the sidebar button that also opened it.
 *
 * The component itself survives only because its one render site, `WorkspaceLayout`, is held by
 * another session's uncommitted work this cycle and cannot be edited here. Deleting the mount is a
 * one-line follow-up once that file is free; nothing else refers to this.
 */
export function AssetOverviewCommand() {
    return null;
}
