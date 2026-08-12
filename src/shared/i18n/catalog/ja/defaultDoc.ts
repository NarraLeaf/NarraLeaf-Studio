import type { LocaleNamespace } from "../types";

/**
 * `defaultDoc` 日本語。新規プロジェクトに焼き込まれる UI ドキュメントの既定の中身。
 *
 * 要素名、プレビュー用の仮テキスト、ブループリントの表示名は、ドキュメント生成時に
 * `translate("defaultDoc.…")` で解決される。つまり作成時のエディタの言語が、
 * そのまま新しいプロジェクトのデータに入る。
 */
export const defaultDoc = {
    rootName: "ルート",
    componentName: "コンポーネント",
    pageName: "ページ",
    pageCopy: "{name} のコピー",
    speaker: "話者",
    dialog: {
        interactionLayer: "ダイアログ操作レイヤー",
        panel: "ダイアログパネル",
        content: "ダイアログ内容",
        avatar: "話者アバター",
        nametag: "ネームタグ",
        sentence: "本文",
        sentenceText: "現在の行がここに表示される",
        nextEvent: "ダイアログを進める",
        updateNametagEvent: "ネームタグを更新",
        updateAvatarEvent: "話者アバターを更新",
    },
    notification: {
        list: "通知リスト",
        item: "通知アイテム",
        message: "通知メッセージ",
        messageText: "通知メッセージ",
        anotherMessage: "別のメッセージ",
    },
    choice: {
        list: "選択肢リスト",
        item: "選択肢アイテム",
        text: "選択肢テキスト",
        itemText: "選択肢",
        selectEvent: "選択肢を選ぶ",
        previewA: "選択肢 A",
        previewB: "選択肢 B",
        previewC: "選択肢 C",
    },
    nvl: {
        interactionLayer: "NVL 操作レイヤー",
        panel: "NVL パネル",
        list: "NVL リスト",
        nametag: "NVL ネームタグ",
        texts: "NVL テキスト",
        entryText: "ダイアログの本文がここに表示される",
        nextEvent: "NVL を進める",
    },
} satisfies LocaleNamespace<"defaultDoc">;
