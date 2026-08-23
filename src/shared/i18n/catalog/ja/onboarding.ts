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
        expectation: "始める前に、いくつか簡単な設定をします。",
        haveSettings: "ほかのコンピューターで Studio を使っていますか？",
    },
    language: {
        title: "言語",
        expectation: "Studio の画面表示に使う言語。設定でいつでも変更できる",
        matchedToDevice: "この端末の言語と一致",
    },
    appearance: {
        title: "外観",
        expectation: "好みのテーマとアクセントを選んでください",
    },
    zoom: {
        title: "画面の拡大率",
        expectation: "Studio の画面を描く大きさ。下の「ウィンドウ全体を見る」を押すと、実際の大きさを確かめられる",
        custom: "カスタム倍率",
        surface: "プレビューに出す画面",
    },
    identity: {
        title: "あなたは誰？",
        expectation: "バージョン管理に表示され、どの改訂を誰が入れたかを見分けるために使う",
        unsigned: "空のままなら、改訂は {name} として記録される",
    },
    team: {
        title: "Team サーバー",
        expectation: "NarraLeaf Team はチームでの制作に向けた機能。チームがサーバーを用意しているなら、ここで接続できる",
        connect: "サーバーに接続",
        connected: "サインイン済み",
        none: "サーバーはあとからホーム画面の Team でも追加できる",
    },
    story: {
        title: "エディターの設定",
        expectation: "ストーリーエディターの設定をいくつか。残りはすべて設定にある",
    },
    import: {
        action: "設定ファイルを読み込む…",
        leaves: "適用するとこれらの設定が読み込まれ、そのまま Studio が開く",
    },
    done: {
        title: "創作はここから",
        expectation: "NarraLeaf Studio のセットアップが終わった。設定には好みに合わせる項目がまだたくさんある。さあ、いちばん良いやり方で自分のビジュアルノベルを作ろう。千里の道も一歩から",
        docs: "ドキュメントを読む",
    },
    previewWindow: {
        open: "ウィンドウ全体を見る",
        notice: "このウィンドウは拡大率のプレビュー。中のものは操作できない。ほかの拡大率はドロップダウンから見られる",
    },
    skipConfirm: {
        title: "セットアップをスキップしますか？",
        message: "Studio は既定の設定で開きます。好みに合わせる項目は設定にたくさんあります。",
    },
    nav: {
        skip: "セットアップをスキップ",
        finish: "Studio を開く",
    },
    sample: {
        projectName: "Welcome to Studio",
        storyName: "第 1 章",
        scene: "こんにちは！",
        speaker: "Narra",
        line: "NarraLeaf Studio へようこそ！",
        lineContinued: "ここで好みの見た目を選んでください。",
        narration: "ほかにも設定で変更できます。",
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
