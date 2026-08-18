/**
 * Rendering a binding string for humans, split out from `KeybindingService` so a surface that only
 * *shows* a chord does not have to pull the dispatcher, the focus manager and the UI store in with
 * it. The help browser is such a surface, and it runs in the launcher window, which has none of
 * those.
 *
 * `KeybindingService` re-exports `formatKeybinding`, so every existing import still resolves.
 */

const MAC_MODIFIER_SYMBOLS: Record<string, string> = {
  mod: "⌘",
  cmd: "⌘",
  meta: "⌘",
  super: "⌘",
  ctrl: "⌃",
  control: "⌃",
  alt: "⌥",
  option: "⌥",
  shift: "⇧"
};

const MODIFIER_LABELS: Record<string, string> = {
  mod: "Ctrl",
  cmd: "Win",
  meta: "Win",
  super: "Win",
  ctrl: "Ctrl",
  control: "Ctrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift"
};

/** Key tokens whose name reads better than the raw string once capitalized. */
const KEY_LABELS: Record<string, string> = {
  " ": "Space",
  space: "Space",
  escape: "Esc",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  "=": "+"
};

/**
 * Render a binding for humans: "mod+c" → "⌘C" on macOS, "Ctrl+C" elsewhere.
 *
 * The same string a binding is registered with is the one shown in menus, so a
 * `mod` binding must not be displayed verbatim - and hardcoding "ctrl" in the
 * label is how it silently drifts from what the key actually does on macOS.
 *
 * Exported for tests (the platform flag is injected there).
 */
export function formatKeybinding(binding: string, isMac: boolean): string {
  const parts = binding.toLowerCase().split("+");
  const rendered = parts.map((part) => {
    const modifier = isMac ? MAC_MODIFIER_SYMBOLS[part] : MODIFIER_LABELS[part];
    if (modifier) {
      return modifier;
    }
    const key = KEY_LABELS[part] ?? part;
    return key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1);
  });
  // macOS convention runs the symbols together (⇧⌘P); elsewhere they are joined.
  return isMac ? rendered.join("") : rendered.join("+");
}
