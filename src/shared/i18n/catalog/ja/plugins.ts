import type { LocaleNamespace } from "../types";

/**
 * `plugins` 日本語。プラグインの管理に関する文言を、管理する場所を問わずまとめたもの。
 *
 * もとは `launcher.plugins` にあった。ランチャーのプラグインタブが唯一の管理場所だった頃の名残で、
 * いまはワークスペース側にも同じ一覧を出すパネルがある。ランチャー自身のタブ名だけが
 * `launcher.nav` に残っている。
 */
export const plugins = {
    installLocal: "フォルダから読み込む",
    search: {
        placeholder: "プラグインを検索",
        clear: "検索を消去",
    },
    tab: {
        installed: "インストール済み",
        store: "ストア",
    },
    emptyList: "インストール済みのプラグインがない",
    emptyFiltered: "「{query}」に一致するプラグインがない",
    authorize: "承認する",
    uninstall: "アンインストール",
    builtIn: "組み込み",
    permissions: "権限",
    noPermissions: "特別な権限なし",
    updateAvailable: "更新あり",
    // 登録された studioVersion の範囲がこのビルドを含まないときに出る。メインプロセスで失敗させず、
    // インストールや更新のボタンを出さない。
    requiresStudio: "このプラグインには Studio {range} が必要。入っているのは {version}",
    openReleasePage: "リリースノートを見る",
    homepage: "ホームページ",
    moreActions: "その他の操作",
    moreActionsNamed: "{name} のその他の操作",
    field: {
        status: "状態",
        version: "バージョン",
        publisher: "発行元",
        entries: "エントリ",
        categories: "カテゴリ",
        installed: "インストール",
        updated: "更新",
    },
    status: {
        enabled: "有効",
        disabled: "無効",
        needsAuthorization: "承認が必要",
    },
    store: {
        install: "インストール",
        installed: "インストール済み",
        update: "更新",
        needsStudio: "Studio {range} が必要",
        emptyList: "レジストリに公開されているプラグインがない",
        offline: "プラグインレジストリに接続できなかった",
        retry: "再試行",
    },
    task: {
        installing: "プラグインをインストール中…",
        downloading: "プラグインをダウンロード中…",
        installed: "プラグインをインストールした",
        authorizing: "承認を待っている…",
        authorized: "プラグインを承認した",
        enabling: "プラグインを有効にしている…",
        disabling: "プラグインを無効にしている…",
        enabled: "プラグインを有効にした",
        disabled: "プラグインを無効にした",
        uninstalling: "プラグインをアンインストール中…",
        uninstalled: "プラグインをアンインストールした",
        reloading: "プラグインを再読み込み中…",
        reloaded: "プラグインを再読み込みした",
    },
    error: {
        load: "プラグインを読み込めなかった",
        install: "プラグインをインストールできなかった",
        approve: "プラグインを承認できなかった",
        update: "プラグインを更新できなかった",
        uninstall: "プラグインをアンインストールできなかった",
        registry: "プラグインレジストリに接続できなかった",
        download: "プラグインをダウンロードできなかった",
    },
    /**
     * ワークスペース側の受け持ち。プラグインが *このウィンドウで* 何をしているか。
     * プロジェクトを開いていないランチャーには言えないこと。
     */
    workspace: {
        reload: "このワークスペースで再読み込み",
        activity: {
            running: "ここで動作中",
            // 有効で studio エントリも持つのに、このウィンドウでは起動しなかった状態。
            stopped: "ここでは動いていない",
            runtimeOnly: "ゲームランタイムのみ",
            runtimeOnlyHint: "このプラグインが手を入れるのは動作中のゲームだけ。エディタには何も足さない",
            suppressed: "このプロジェクトでは無効",
            suppressedHint: "入っているバージョンが、このプロジェクトを作ったときのバージョンと合わない。更新するか、「プロジェクト → 依存関係」でプロジェクト側の依存表を更新する",
            failed: "読み込みに失敗",
        },
        // 読み込み時に一度だけ知らせる。プロジェクトの依存表がはじいたプラグインを名指しする。
        suppressedNotice: "このプロジェクトでは読み込まれていない：{names}。入っているバージョンが、プロジェクトを作ったときのバージョンと合わない。プラグインパネルを見る",
        // ワークスペースが反映できない状態で切り替えられたプラグイン。
        pendingReopen: "このプロジェクトを次に開いたときに反映される",
        /**
         * インストール状況が変わると必ず出る。含みを持たせてあるのは意図的。プラグインを切ると、
         * ホストが渡したもの（パネル、ノード、ウィジェット、アクション）は取り戻せるが、
         * プラグインのコードが自分でやったことは取り戻せない。`window` に付けたリスナー、
         * 差し替えたグローバル、仕掛けたタイマーなど。多くは綺麗に消えるが、そうでないものは
         * パネルから見分けられる痕跡を残さない。だから確実な言い方は「再起動すれば元通り」になる。
         */
        restartHint: "プラグインの変更には、ワークスペースを再起動してはじめて反映されるものがある",
        /** バナー自身の操作。保留中の保存をすべて書き出してから、このウィンドウを読み込み直す。 */
        restart: "再起動",
        restarting: "変更を保存して再起動している…",
        recoveryNotice: "復旧モードではプラグインを読み込まない。ここでの変更は、次に通常どおり開いたときに反映される",
        /** 下のトーストの操作、およびこのパネルへ誘導するあらゆる場所で使う。 */
        openPanel: "プラグインパネルを開く",
        error: {
            activate: "{name} をこのワークスペースで起動できなかった",
            deactivate: "{name} をこのワークスペースで停止できなかった",
            /** このウィンドウへ読み込む途中でプラグインが例外を投げた。理由はトーストの詳細に出る。 */
            loadFailed: "{name} を読み込めなかった",
            hostFailed: "プラグインを読み込めなかった",
        },
    },
} satisfies LocaleNamespace<"plugins">;
