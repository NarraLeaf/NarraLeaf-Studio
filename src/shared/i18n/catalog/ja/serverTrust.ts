import type { LocaleNamespace } from "../types";

export const serverTrust = {
    window: "サーバーの信頼",
    title: "このサーバーを信頼しますか",
    issuedBy: "発行元：{subject}",
    fingerprint: "指紋",
    // 代償を一文で、和らげずに書く。「このアカウント」は細部ではなく、被害の範囲そのもの。
    meaning: "この認証局の鍵を持つものは、どのアドレスに対しても証明書を発行でき、このアカウントはそれを信じます。",
    confirm: "信頼する",
    cancel: "キャンセル",
    working: "信頼中",
    error: {
        load: "どのサーバーについての確認かを読み込めなかった",
        trust: "この認証局を信頼できなかった",
    },
} satisfies LocaleNamespace<"serverTrust">;
