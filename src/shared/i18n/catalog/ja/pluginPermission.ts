import type { LocaleNamespace } from "../types";

/**
 * `pluginPermission` 日本語。プラグインの権限まわりの文言。同意ダイアログ
 * （インストール／信頼／ファイルシステム／API 要求）と、ランチャーのプラグイン詳細が
 * 使い回すインストール権限の内訳。
 */
export const pluginPermission = {
    title: "プラグインの権限",
    window: {
        launcher: "ランチャー",
        settings: "設定",
        workspace: "ワークスペース",
        projectWizard: "プロジェクトウィザード",
        devMode: "開発モード",
        pluginPermission: "プラグインの権限",
        studio: "Studio",
    },
    install: {
        type: "プラグインのインストール要求",
        title: "{requester} が {plugin} のインストールを求めている",
        body1: "このインストールで何が許可されるかを Studio が調べた内容：",
        body2: "承認すると、ここに並ぶすべてがこのバージョンのプラグインに許可される。信頼できるプラグインだけをインストールする",
        source: "入手元：{source}",
    },
    filesystem: {
        type: "ファイルシステムの権限要求",
        title: "{plugin} がファイルへのアクセスを求めている",
        body1: "承認すると、このプラグインは求めたファイルアクセスを使えるようになる",
        bodyPermanent: "「一度だけ許可」を選ぶと、今回の Studio セッションの間だけ許可される",
        bodySession: "この要求が有効なのは今回の Studio セッションの間だけ",
        permissionRecursive: "{path} の中で{mode}",
        permissionSingle: "{path} に対して{mode}",
    },
    api: {
        type: "プラグイン API の権限要求",
        title: "{plugin} が {capability} を求めている",
        body1: "承認すると、このプラグインは求めた Studio API を呼べるようになる",
        body2: "自分が始めた操作に必要な場合だけ承認する",
    },
    trust: {
        type: "プラグインの信頼要求",
        title: "{requester} が {plugin} を信頼することを求めている",
        body1: "信頼したプラグインは、次からは確認なしで有効にできる",
        body2: "出所の分かっているプラグインだけを信頼する",
        permission: "このプラグインの識別情報を信頼する",
    },
    generic: {
        type: "プラグインの権限要求",
        title: "{plugin} が Studio の権限を求めている",
        body: "許可する前に内容を確かめる",
    },
    mode: {
        read: "読み取り",
        write: "書き込み",
        readwrite: "読み書き",
    },
    /**
     * インストール権限の内訳。宣言された場所ではなく影響範囲で分ける。プレイヤー全員に配られる
     * ネイティブプログラムと、Studio の API 呼び出しは、同じ重さの要求ではない。
     */
    permissions: {
        section: {
            sidecar: "プレイヤーの端末で動くプログラム",
            sidecarNote: "このプラグインは、ビルドしたゲームの中にプログラムを同梱する",
            buildDependency: "ビルド時のダウンロード",
            runtime: "ゲームの中で",
            externalLink: "ゲームの外へのリンク",
            externalLinkNote: "このプラグインはプレイヤーを次のアドレスへ送り出せる。いずれもゲームの外で開く",
            network: "ゲームが要求するデータ",
            networkNote: "ゲームの実行中、このプラグインは次のアドレスからデータを要求する",
            studio: "Studio の権限",
        },
        sidecarPlatforms: "{platforms} で動く",
        /**
         * 見出しは両方をまとめて指すので、どちらなのかは行ごとに書く。片方は独立したプログラム、
         * もう片方はゲームと同じ届き方をするプラグイン自身のコードで、判断が変わる。
         */
        sidecarKind: {
            executable: "独立したプログラムとして動く",
            node: "プラグイン自身のコードがゲームの一部として動く",
        },
        buildDependencyHosts: "{hosts} からダウンロードする",
        /**
         * API 名ではなくプレイヤーのデータを主語にして書く。信頼するかどうかを決める人にとって
         * 「state.write」は何も意味しない。
         */
        runtimeCapability: {
            store: "プレイヤーのセーブと並べて独自のデータを保存する",
            events: "ゲームの進行を見る。シーン、台詞、選択、セーブが対象",
            stateRead: "ストーリー変数を読む",
            stateWrite: "ストーリー変数を書き換える",
            savesRead: "プレイヤーのセーブ一覧とその情報を読む",
            savesWrite: "プレイヤーのセーブを上書きし、読み込む",
            uiOverlay: "ゲームの上に重ねて描画する",
            assets: "パッケージ内アセットの URL を解決する",
            locale: "ゲームの言語を読み、それに合わせる",
        },
    },
    button: {
        dontAllow: "許可しない",
        deny: "拒否",
        allowOnce: "一度だけ許可",
        allow: "許可",
        alwaysAllow: "常に許可",
        granting: "許可中",
    },
    error: {
        load: "権限要求を読み込めなかった",
        grant: "権限を許可できなかった",
    },
} satisfies LocaleNamespace<"pluginPermission">;
