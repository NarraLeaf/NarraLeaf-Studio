/**
 * The plugin's own message bundle: the names the dialogue toolbar's effects panel shows.
 *
 * Nothing here reaches a player. The effect changes how the author's text moves, never what it says.
 *
 * Comments in English per project convention.
 */

export const TEXT_EFFECTS_MESSAGES = {
    messages: {
        en: {
            shake: "Shake",
            intensity: "Intensity",
            speed: "Speed",
        },
        zh: {
            shake: "抖动",
            intensity: "强度",
            speed: "速度",
        },
        ja: {
            shake: "揺れ",
            intensity: "強さ",
            speed: "速さ",
        },
    },
} as const;
