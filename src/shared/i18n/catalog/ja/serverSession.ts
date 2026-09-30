import type { LocaleNamespace } from "../types";

export const serverSession = {
    window: "サーバーのサインイン",
    title: "このプロジェクトでこのサインインを使いますか",
    signedInAs: "{name} としてサインイン中",
    // 作者が答えるまでの状態を一文で。
    unused: "このプロジェクトはまだこのサインインを使っていない。",
    // 同意した結果を、作者に見える形で書く。
    meaning: "使うと、このプロジェクトは {name} としてバージョンを送り、取得する。",
    later: "プロジェクトの NarraLeaf Team で変更できる",
    confirm: "使う",
    cancel: "使わない",
    error: {
        load: "サインインの情報を読み込めなかった",
    },
} satisfies LocaleNamespace<"serverSession">;
