import type { LocaleMessages } from "./types";

/**
 * 日本語カタログ（プレースホルダ）。
 *
 * Intentionally partial: only a handful of keys are translated. Everything else
 * resolves to the English source at runtime. This is the reference example for
 * how an incompletely-translated locale behaves — ship it, translate over time.
 */
export const ja = {
    common: {
        ok: "OK",
        cancel: "キャンセル",
    },
    launcher: {
        nav: {
            projects: "プロジェクト",
            plugins: "プラグイン",
            learning: "学習",
            settings: "設定",
        },
    },
} satisfies LocaleMessages;
