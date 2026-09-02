import type { LocaleNamespace } from "../types";

export const projectTrust = {
    window: "プロジェクトの信頼",
    title: "このプロジェクトを信頼しますか",
    // 信頼するまでの状態を一文で。できることと、できないこと。
    untrusted: "このプロジェクトは Studio が作成したものではない。信頼するまでは編集できるが、実行・プレビュー・ビルド・テストはできない。",
    // 代償を一文で、和らげずに書く。
    meaning: "信頼すると、このプロジェクトに含まれるコードがこの端末で実行される。",
    later: "設定の「信頼済みプロジェクト」で変更できる",
    confirm: "信頼する",
    cancel: "今はしない",
    error: {
        load: "プロジェクトの情報を読み込めなかった",
    },
} satisfies LocaleNamespace<"projectTrust">;
