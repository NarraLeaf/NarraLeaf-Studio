import type { LocaleNamespace } from "../types";

export const serverTrust = {
  window: "サーバーの信頼",
  title: "このサーバーを信頼しますか",
  issuedBy: "発行元：{subject}",
  fingerprint: "指紋",
  // 代償を一文で、和らげずに書く。「このアカウント」は細部ではなく、被害の範囲そのもの。
  meaning: "信頼すると、この認証局が発行した証明書はこのアカウントで受け入れられる。",
  confirm: "信頼する",
  cancel: "キャンセル",
  working: "信頼中",
  error: {
    load: "サーバーの情報を読み込めなかった",
    trust: "この認証局を信頼できなかった"
  }
} satisfies LocaleNamespace<"serverTrust">;
