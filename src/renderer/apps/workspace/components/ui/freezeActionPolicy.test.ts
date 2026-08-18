import { describe, expect, it } from "vitest";
import type { ActionDefinition, ActionMenuItem, ActionSubmenu } from "../../registry/types";
import { Separator } from "../../registry/types";
import { getVisibleActionMenuItems, isActionMenuAction } from "./actionMenuModel";
import {
  applyFreezeToActionMenuItems,
  isActionFrozenOut,
  isFreezeExemptActionGroup,
  resolveFrozenActionDisabled
} from "./freezeActionPolicy";

/**
 * The frozen top bar: everything registered is disabled, except the ids the table names.
 *
 * The ids are asserted as literals rather than imported from `modules/actions`, so that renaming a
 * group there breaks this test instead of silently emptying the exemption - the failure mode being
 * guarded against is a File menu that quietly goes dead in a frozen project.
 */

const FILE_GROUP = "narraleaf-studio:file";
const HELP_GROUP = "narraleaf-studio:help";
const BUILD_ACTION = "narraleaf-studio:build";

function action(id: string, extra: Partial<ActionDefinition> = {}): ActionDefinition {
  return { id, label: id, onClick: () => {}, ...extra };
}

/** The shape of the File group as `useFileMenu` registers it: items plus an "Open Recent" submenu. */
function fileMenuItems(): ActionMenuItem[] {
  const openRecent: ActionSubmenu = {
    id: "narraleaf-studio:file-open-recent",
    label: "Open Recent",
    // Registered disabled by useFileMenu when there is no history to list.
    items: [action("narraleaf-studio:file-open-recent:empty", { disabled: true })]
  };
  return [
    action("narraleaf-studio:file-new"),
    action("narraleaf-studio:file-open"),
    openRecent,
    Separator,
    action("narraleaf-studio:file-close-workspace")
  ];
}

const actionsOf = (items: ActionMenuItem[]): ActionDefinition[] => items.filter(isActionMenuAction);

describe("freeze exemption table", () => {
  it("exempts the File and Help groups and nothing else", () => {
    expect(isFreezeExemptActionGroup(FILE_GROUP)).toBe(true);
    expect(isFreezeExemptActionGroup(HELP_GROUP)).toBe(true);
    // Build starts a production build - a side effect the write boundary cannot catch.
    expect(isFreezeExemptActionGroup(BUILD_ACTION)).toBe(false);
    expect(isFreezeExemptActionGroup("some-plugin:tools")).toBe(false);
  });

  it("gives a plugin no way to opt in, whatever it puts on the definition", () => {
    // The only lever a registrant has is `group`, and claiming a core group id is the one thing
    // that would work - which is why the table is keyed on ids Studio itself owns.
    const impostor = action("some-plugin:publish", { group: "some-plugin:file" });
    expect(resolveFrozenActionDisabled(impostor, true)).toBe(true);

    // Nothing on ActionDefinition marks an action as exempt; a plugin passing extra fields is
    // ignored because the policy never reads the definition for permission.
    const withExtras = {
      ...action("some-plugin:deploy"),
      exemptWhileFrozen: true
    } as ActionDefinition;
    expect(resolveFrozenActionDisabled(withExtras, true)).toBe(true);
  });
});

describe("resolveFrozenActionDisabled", () => {
  it("disables a registered standalone action while frozen", () => {
    const build = action(BUILD_ACTION);
    expect(resolveFrozenActionDisabled(build, false)).toBe(false);
    expect(resolveFrozenActionDisabled(build, true)).toBe(true);
    expect(isActionFrozenOut(build, true)).toBe(true);
  });

  it("leaves an exempt group's action enabled while frozen", () => {
    const close = action("narraleaf-studio:file-close-workspace", { group: FILE_GROUP });
    expect(resolveFrozenActionDisabled(close, true)).toBe(false);
    expect(isActionFrozenOut(close, true)).toBe(false);
  });

  it("restores on thaw, because the registration was never touched", () => {
    const plugin = action("some-plugin:tool");
    expect(resolveFrozenActionDisabled(plugin, true)).toBe(true);
    expect(resolveFrozenActionDisabled(plugin, false)).toBe(false);
    expect(plugin.disabled).toBeUndefined();
  });

  it("keeps an already-disabled registration disabled, and does not blame the freeze for it", () => {
    const busy = action("some-plugin:tool", { disabled: true });
    expect(resolveFrozenActionDisabled(busy, false)).toBe(true);
    expect(resolveFrozenActionDisabled(busy, true)).toBe(true);
    // Thawing must not enable it: it is off for its own reason.
    expect(resolveFrozenActionDisabled(busy, false)).toBe(true);

    // An exempt group's already-disabled item stays disabled too.
    const emptyRecent = action("narraleaf-studio:file-open-recent:empty", {
      disabled: true,
      group: FILE_GROUP
    });
    expect(resolveFrozenActionDisabled(emptyRecent, true)).toBe(true);
    expect(isActionFrozenOut(emptyRecent, true)).toBe(false);
  });
});

describe("applyFreezeToActionMenuItems", () => {
  it("disables every item of a non-exempt group without mutating what was registered", () => {
    const items = [action("some-plugin:one"), Separator, action("some-plugin:two")];
    const frozen = applyFreezeToActionMenuItems(items, true);

    expect(actionsOf(frozen).map((item) => item.disabled)).toEqual([true, true]);
    expect(actionsOf(items).map((item) => item.disabled)).toEqual([undefined, undefined]);
    expect(frozen[1]).toBe(Separator);
  });

  it("returns the registered items untouched when not frozen out", () => {
    const items = fileMenuItems();
    // Identity, not just equality: the File group's menu must not even be rebuilt.
    expect(applyFreezeToActionMenuItems(items, false)).toBe(items);
    expect(actionsOf(items).every((item) => item.disabled === undefined)).toBe(true);
  });

  it("leaves a submenu row expandable while disabling what is inside it", () => {
    const items = fileMenuItems();
    const frozen = applyFreezeToActionMenuItems(items, true);

    // The group still has visible items, so ActionBar keeps rendering it and the dropdown
    // still opens - a menu that could not be opened would hide what the freeze is doing.
    expect(getVisibleActionMenuItems(frozen).length).toBe(getVisibleActionMenuItems(items).length);

    const submenu = frozen.find((item): item is ActionSubmenu => "items" in item)!;
    expect(submenu).toBeDefined();
    // A submenu carries no disabled flag of its own; the dropdown derives its row state from
    // whether it has visible children, and those are still there.
    expect(getVisibleActionMenuItems(submenu.items).length).toBe(1);
    expect(actionsOf(submenu.items).map((item) => item.disabled)).toEqual([true]);

    const original = items.find((item): item is ActionSubmenu => "items" in item)!;
    expect(original.items).not.toBe(submenu.items);
  });

  it("recurses to arbitrary depth", () => {
    const leaf = action("some-plugin:deep");
    const inner: ActionSubmenu = { id: "some-plugin:inner", label: "Inner", items: [leaf] };
    const outer: ActionSubmenu = { id: "some-plugin:outer", label: "Outer", items: [inner] };

    const frozen = applyFreezeToActionMenuItems([outer], true) as ActionSubmenu[];
    const frozenInner = frozen[0].items[0] as ActionSubmenu;
    expect(actionsOf(frozenInner.items).map((item) => item.disabled)).toEqual([true]);
    expect(leaf.disabled).toBeUndefined();
  });
});
