import type { LocaleNamespace } from "../types";

/**
 * `onboarding` 日本語。初回起動のセットアップで、ランチャーのホーム画面より先に出る。
 *
 * 訊いているのはどれも設定にある項目なので、ラベルと選択肢の名前は `settings` 名前空間から読む。
 * 同じ設定に二通りの訳を置くと、セットアップ画面と設定ウィンドウで「システムに合わせる」の
 * 言い方が食い違う。プレビュー内の入力欄の文言も同じ理由で `story.rows.*` から取る。
 */
export const onboarding = {
    windowTitle: "{name} へようこそ",
    progress: "進捗 {current}/{total}",
    steps: {
        welcome: "ようこそ",
        language: "言語",
        appearance: "外観",
        zoom: "拡大率",
        identity: "署名",
        team: "チーム",
        story: "ストーリーエディター",
        done: "完了",
    },
    welcome: {
        title: "ようこそ",
        expectation: "Studio の見た目と書き心地について、いくつか質問します。どれも後から設定で変更できます。",
        haveSettings: "ほかのコンピューターで Studio を使っていますか？",
    },
    language: {
        title: "言語",
        expectation: "Studio の画面表示に使う言語。設定でいつでも変更できる",
        matchedToDevice: "この端末の言語と一致",
    },
    appearance: {
        title: "外観",
        expectation: "テーマとアクセント。選んだ瞬間に反映される",
    },
    zoom: {
        title: "画面の拡大率",
        expectation: "Studio の画面を描く大きさ。このウィンドウそのものが見本になる",
        custom: "カスタム",
        surface: "プレビューに出す画面",
    },
    identity: {
        title: "書いている人",
        expectation: "改訂に記録される名前と、新しいプロジェクトに最初から入る作者名",
        unsigned: "空のままなら、改訂は {name} として記録される",
    },
    team: {
        title: "チームサーバー",
        expectation: "共有プロジェクトの置き場所。サーバーがなくても Studio の機能は欠けない",
        connect: "サーバーに接続",
        connected: "サインイン済み",
        none: "サーバーは未接続。プロジェクトはこの端末に置かれ、あとから設定で追加できる",
    },
    story: {
        title: "ストーリーエディター",
        expectation: "シーンエディターの読み方と入力の受け方。どれも設定にある",
    },
    import: {
        action: "設定ファイルを読み込む…",
        leaves: "適用するとそのまま Studio が開く。残りのセットアップはこのファイルが答える",
    },
    done: {
        title: "セットアップ完了",
        expectation: "ここで訊いたことも、その先の細かい調整も設定にある。どの画面でも F1 を押すと、カーソルの下にあるもののヘルプが開く",
        docs: "ドキュメントを読む",
    },
    previewWindow: {
        open: "ウィンドウ全体を見る",
        notice: "画面のプレビュー。入力できる行のほかは、どれも動かない",
    },
    skipConfirm: {
        title: "セットアップをスキップしますか？",
        message: "Studio は既定の設定で開きます。セットアップは再表示されませんが、ここで尋ねる項目はすべて設定にあります。",
    },
    nav: {
        skip: "セットアップをスキップ",
        finish: "Studio を開く",
    },
    sample: {
        projectName: "サンプルプロジェクト",
        storyName: "第 1 章",
        scene: "屋上、夕方",
        speaker: "アンヨ",
        line: "灯りが一斉に点いて、坂の下までずっと続いていた。",
        lineContinued: "道がどこで終わるのかも見えた。",
        narration: "ふもとの町は、もう起きていた。",
        background: "屋上",
        placement: "中央",
        transition: "フェード",
        rail: {
            story: "ストーリー",
            versions: "バージョン管理",
            team: "チーム",
        },
        versions: {
            latest: "屋上のシーン、初稿",
            earlier: "章の始まり",
            checkpoint: "チェックポイント",
        },
        dashboard: {
            lastActive: "たった今",
            trackedSince: "今週",
        },
        console: {
            start: "プレビューをビルド中…",
            assets: "アセット 86 個、シーン 12 個",
            warning: "シーン「屋上、夕方」に立ち絵のないキャラクターがいる",
            done: "プレビュー完了、3.4 秒",
        },
        teamAlone: "この端末で作業中",
    },
} satisfies LocaleNamespace<"onboarding">;
