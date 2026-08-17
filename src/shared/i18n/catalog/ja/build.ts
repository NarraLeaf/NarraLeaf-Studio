import type { LocaleNamespace } from "../types";

/** `build` 日本語。製品ビルドのダイアログ、プラットフォームと形式の名前、状態のトースト。 */
export const build = {
    dialog: {
        title: "配布用にビルド",
        start: "ビルド",
        runningTitle: "ビルドが進行中",
        runningBody: "このプロジェクトのビルドはすでに走っている。進み具合はコンソールに出る",
        viewConsole: "コンソールを見る",
        cancelBuild: "ビルドを中止",
    },
    platform: {
        windows: "Windows",
        macos: "macOS",
        linux: "Linux",
        web: "Web",
        android: "Android",
        ios: "iOS",
    },
    unavailable: {
        windows: "この端末では Windows 向けにビルドできない",
        macos: "macOS 向けのビルドは Mac でしかできない",
        linux: "この端末では Linux 向けにビルドできない",
        web: "Web 向けのビルドはどの端末でもできる",
        android: "Android 向けのビルドはどの端末でもできる",
        ios: "iOS 向けのビルドはどの端末でもできる",
    },
    format: {
        zip: "ポータブル ZIP",
        nsis: "インストーラ",
        dmg: "ディスクイメージ",
        appimage: "AppImage",
        dir: "フォルダ",
        apk: "APK",
        aab: "AAB",
        ipa: "IPA",
    },
    outputDir: "出力フォルダ",
    chooseFolder: "フォルダを選ぶ…",
    section: {
        variant: "バリアント",
        targets: "対象",
        identity: "識別情報",
        // レールに収まる短さ。この節は保護の設定も含む。
        content: "中身",
        // プラグインが求める値。何が配布に入るかは「中身」の側で、別の事実。
        plugins: "プラグイン",
        signing: "署名",
        output: "出力",
    },
    arch: {
        label: "アーキテクチャ",
        x64: "Intel / AMD（x64）",
        arm64: "ARM（arm64）",
        universal: "ユニバーサル",
    },
    // 最初のページ。どの版をビルドするのか、その版が何になるのか。
    variant: {
        // 選んだバリアントが自分では言っていない値の隣に出る。アプリのページと同じ読みになる理由を、
        // 上書きされた値と同じ行の位置で言う。
        inherited: "プロジェクトから",
        // このバリアントのストーリーがどこで止まるか。名指しするカットポイントから数えるので、
        // どのカットポイントも名指しできないリリースのバリアントは、常にストーリー全体として読める。
        boundary: "物語の終わり",
        endsNever: "ストーリーの最後まで進む",
        endsAt: {
            other: "{count} 箇所のカットポイントで終わる。その先はこのビルドに入らない",
        },
        variantRows: {
            other: "{count} 行がバリアントを読んでいて、ビルドごとに変わりうる",
        },
        blocking: "このビルドを止めているもの",
        blockingNone: "このビルドを止めているものはない",
    },
    identity: {
        // 最初のページで決めた選択の名前であり、それを決める一覧のラベル。
        variant: "ビルドバリアント",
        // 選んだバリアントが継承ではなく自分で言っている値の隣に出る。アプリのページと違う値には、
        // その理由が同じ行にある。
        fromVariant: "このビルドバリアントから",
        version: "バージョン",
        productName: "製品名",
        productNameSource: "プロジェクト名から",
        appId: "アプリ ID",
        copyright: "著作権表示",
        icons: "アイコン",
        iconsHint: "アイコンをクリックするとプロジェクト設定で変えられる",
        iconUnset: "未設定",
        // バージョンや著作権表示が空のときの表示。この節はもう報告しかしないので、
        // 空欄が入力待ちのコントロールに見えないよう、空であることを言葉で出す。
        notSet: "未設定",
        editInProject: "「プロジェクト ▸ アプリ」で編集",
    },
    content: {
        protection: "アセットの保護",
        protectionOn: "パッケージしたゲームの中で、アセットとセーブは暗号化される",
        protectionOff: "アセットとセーブは暗号化せずに配布される",
        plugins: "同梱するプラグイン",
        pluginsNone: "このゲームに同梱されるプラグインはない",
        pluginsRescanUnavailable: "このウィンドウではプラグイン一覧を取り直せない",
        locales: "同梱する言語",
        localesNone: "ローカライズを設定していない。ゲームは 1 言語で配布される",
        localeSource: "{name}（原文）",
        network: "ネットワークの方針",
        networkPolicyName: {
            off: "使わない",
            allowlist: "許可一覧",
            any: "任意のアドレス",
        },
        networkPolicy: {
            off: "パッケージしたゲームは HTTP と HTTPS の要求をすべて拒否する",
            allowlist: "パッケージしたゲームはプロジェクトの許可一覧にあるアドレスだけに到達できる",
            any: "パッケージしたゲームは HTTP または HTTPS で任意のアドレスに到達できる",
        },
    },
    /**
     * プラグインのページ。フィールドのラベルと説明はプラグインのマニフェストから来るので、
     * ここにあるのは秘密の値についての言葉だけ。ページが唯一表示できない値がそれ。
     */
    pluginConfig: {
        secretUnset: "未設定",
        // 保管庫がまだ答えていない間。分かっているのは「設定済み」だけで、
        // 下の 2 つはどちらも、直後に自分で取り消す主張になってしまう。
        secretSet: "設定済み",
        secretHere: "この端末で設定済み",
        secretElsewhere: "他の端末で設定済み。値はこの端末にない",
        secretEnter: "新しい値を入力",
        clear: "消去",
        secretFailed: "この端末にその値を保存できなかった",
    },
        patch: {
            title: "パッチを書き出す",
            variantLabel: "バリアント",
            variantHint: "パッチは、書き出した対象のバリアントのビルドでのみ開く",
            baselineLabel: "本パッチが更新するビルド",
            baselinePlaceholder: "空のままにするとゲーム全体を含める",
            baselineHint: "以前のビルドが出力したデスクトップビルドのフォルダー。そのフォルダーと異なるファイルだけを含める",
            outputLabel: "保存先",
            nameLabel: "名前",
            namePlaceholder: "ゲームのログに表示される",
            browse: "参照…",
            exportAction: "書き出す",
            busy: "ビルドがすでに実行中",
            noKey: "このプロジェクトには配布キーがない。「プロジェクト」ページで作成し、ゲームをビルドし直す。パッチを受け入れるのは、キーの作成後に生成されたビルドだけ。",
        },
    signing: {
        empty: "署名できる対象を選ぶ",
        // プロジェクト設定では "linux" の下にあるが、Linux の話ではない。
        // 署名はビルドが書き出すすべての成果物の隣に置かれる。
        detached: "分離署名",
        none: "署名なし",
        missing: "この端末にない",
        import: "読み込む…",
        // ダイアログは選択されているものを報告するだけ。選択と読み込みはパネルで行う。
        editInProject: "「プロジェクト ▸ 設定」で管理",
        remove: "この端末から取り除く",
        removeConfirm: "{label} をこの端末から取り除くか",
        removeConfirmDetail: "鍵の情報がこの端末から削除される。これを使うプロジェクトは、読み込み直すまで署名なしでビルドされる",
        removeAction: "取り除く",
        chooseFile: "選ぶ…",
        noFile: "なし",
        expires: "{date} に期限切れ",
        expired: "{date} に期限切れ",
        certUnsupported: "この形式のコンテナは Studio では開けない",
        certUnreadable: "証明書を読めなかった",
        alias: "鍵 {alias}",
        keyId: "鍵 {keyId}",
        azure: "{account} / {profile}",
        importTitle: "{platform} 向けに読み込む",
        importAction: "読み込む",
        aliasLocked: "キーストアのパスワードを入力する",
        aliasEmpty: "このキーストアに署名鍵がない",
        keyPasswordSame: "キーストアのパスワードと同じ",
        macIdentityLoading: "キーチェーンを読んでいる…",
        macIdentityEmpty: "この Mac のキーチェーンにコード署名用の証明書がない。キーチェーンアクセスで入れるか、証明書ファイルを読み込む",
        macIdentityNotDeveloperId: "配布用ではない",
        notarized: "Apple の公証済み",
        notNotarized: "公証していない。初回起動時に Gatekeeper がプレイヤーへ警告を出す",
        kind: {
            "windows-pfx": "証明書ファイル",
            "windows-store": "Windows の証明書ストア",
            "windows-azure": "Azure Trusted Signing",
            "macos-keychain": "キーチェーン内の証明書",
            "macos-apple": "証明書ファイル",
            "android-keystore": "リリース用キーストア",
            "ios-apple": "Apple の識別情報",
            "linux-gpg": "GPG 鍵",
        },
        field: {
            kind: "種類",
            label: "名前",
            pfx: "証明書（.pfx / .p12）",
            keystore: "キーストア",
            appleCertificate: "証明書（.p12）",
            provisioningProfile: "プロビジョニングプロファイル",
            password: "パスワード",
            storePassword: "キーストアのパスワード",
            keyPassword: "鍵のパスワード",
            alias: "鍵",
            subjectName: "サブジェクト名",
            sha1: "拇印",
            endpoint: "エンドポイント",
            account: "アカウント",
            profile: "証明書プロファイル",
            publisher: "発行元",
            keyId: "鍵 ID",
            gpgPath: "gpg のパス",
            macIdentity: "証明書",
            notaryKey: "公証用の鍵（.p8）",
            notaryKeyId: "公証用の鍵 ID",
            notaryIssuerId: "公証の発行者 ID",
        },
    },
    output: {
        artifacts: "成果物",
        artifactsEmpty: "作られるファイルを見るには対象を選ぶ",
        openWhenDone: "終わったら出力フォルダを開く",
        compression: "圧縮",
        compressionMaximum: "最大（最小サイズ）",
        compressionNormal: "標準",
        compressionStore: "なし（最速）",
    },
    /**
     * ビルドが終わったあと、成果物の一覧の下に出す大きさの読み。数字そのものは訳さない。
     * 共通のバイト表記はどの言語でも同じ数文字だから、ここに置くのは数字の周りの言葉だけ。
     */
    size: {
        // 大きさを読めなかった成果物で、数字の代わりに立つ。「0 B」とは書かない。
        // それを読んだ作者は、ビルドが何も書かなかったと思ってしまう。
        unknown: "大きさ不明",
        // 合計は 1 行だけ。全部ではなく実際に測れた分を数えるので、
        // 読めなかったものがあってもこの文は本当のままでいられる。
        totalOne: "合計サイズ：{size}（成果物 1 件）",
        totalMany: "合計サイズ：{size}（成果物 {count} 件）",
    },
    mirror: {
        official: "公式の配布元",
        change: "変更",
    },
    preflight: {
        "no-targets": "プラットフォームと形式を少なくとも 1 つ選ぶ",
        "unbuildable-platform": "この端末では {platform} 向けにビルドできない",
        "version-invalid": "バージョン {version} はセマンティックバージョンとして不正で、ビルドは失敗する",
        "version-missing": "バージョンが未設定。ゲームは 0.0.0 としてビルドされる",
        "identifier-missing": "プロジェクトの識別子が未設定。アプリ ID の {appId} を使う",
        // ビルド自身も同じファイルで止まるので、前提を置いた話ではなく、何で止まったかを言う。
        "variants-unreadable": "プロジェクトのビルドバリアントを読めなかった：{reason}",
        // プラットフォームを問わない書き方。モバイル向けのビルドはシェル自身の
        // 仮アイコンに落ちるので、Electron のアイコンではない。
        "icon-missing": "アプリのアイコンが未設定。代わりに NarraLeaf のアイコンが入る",
        "icon-unusable": "{platform} のアイコンを読めなかった。代わりに NarraLeaf のアイコンが入る",
        "icon-low-resolution": "{platform} のアイコンが {minimum}×{minimum} より小さく、引き伸ばして入る",
        "icon-stale": "{platform} のアイコンが用意されていない。「プロジェクト ▸ アプリ」を開いて焼き直す",
        // この行は終わりとして読め、行が無いときと同じパッケージができる。つまり全編が配布に入る。
        // 行番号ではなくシーンの名前を出す。ビルドのダイアログには行を数えるガターが無く、
        // 作者が開くのはシーンのほう。
        "cut-point-inert":
            "{scene}（{story}）のカットポイントは {variant} から何も取り除かないので、そのビルドはストーリー全体を運ぶ",
        // ストーリーを短くするバリアントにだけ出る。どちらでも答えられる。ページを選ぶか、
        // バリアントで「何も出さない」を選んで最後のフレームを画面に残す。
        "variant-ending-missing":
            "{variant} はストーリーを途中で終わらせるが、終わったときに出すページが無い。「プロジェクト ▸ アプリ ▸ ビルドバリアント」で選ぶ",
        // 文の中に件数は入れない。ダイアログは素の翻訳器で所見を描くので複数形を選べず、
        // 数はシーンの名前が言う以上のことを足さない。
        "variant-branch-uncut":
            "{scene}（{story}）から出る一部のルートはカットポイントに行き着かないので、{variant} はそれらを丸ごと配布する",
        "plugins-invalid": "プラグインの検証に失敗：\n{errors}",
        // `{platforms}` は、この 1 つの値を埋めなければならない相手。値がプラットフォームごとなら
        // そのプラットフォーム、1 つの値が全体を覆うならビルドの全プラットフォーム。空にはならないので、
        // どちらでも文はそのまま読める。
        "plugin-config-missing": "{platforms} をビルドするには、{plugin} の {field} に値が要る",
        "plugin-secret-unavailable": "{plugin} の {field} は設定済みだが、その値はこの端末にない。秘密の値がプロジェクトと一緒に動くことはない。{platforms} をビルドするには、ここでもう一度入力する",
        // キャッシュのパスも出す。ネットワークの無い端末の作者にも、別の場所で
        // ダウンロードしてそこへ置くという道が残る。
        "build-dependency-unavailable":
            "{plugin} は {platform} 向けに {dependency} を必要とする。この端末にキャッシュがなく、{url} からの取得にも失敗した"
            + "（{reason}）。ネットワーク無しでビルドするには {path} として保存する",
        // エラーではない。ゲームはビルドできて動く。失われるのはそのプログラムがしていたことで、
        // 成果物の側にはそれを示すものが何も残らない。
        "sidecar-target-missing":
            "{plugin} は {platform} 向けの {sidecar} プログラムを持たないので、それが担っていたものはそのビルドから欠ける",
        "sidecar-crossbuild-exec-bit":
            "{plugin} の {sidecar} プログラムは、実行できない状態のまま {platform} の成果物に入る。"
            + "{targetPlatform} 向けのビルドは {targetPlatform} の端末で行う",
        "encryption-key-unavailable": "アセットの保護が有効だが、その鍵を読めなかった",
        "web-unprotected": "Web 書き出しにアセットの保護は効かない。そのファイル群は保護されずに配布される",
        "progress-carry-unsupported":
            "{blueprints} は版と版のあいだで進行状況を引き継ぐが、{platform} のビルドはそれを拒む。"
            + "どちらのノードも失敗の枝に進む",
        "web-lossy-images": "書き出す画像は品質 {quality} で再エンコードされ、失われた情報は戻らない",
        "mobile-template-missing": "モバイルのシェルテンプレートを使えない：{reason}",
        "mobile-payload-too-large": "このプロジェクトのアセット（{size}）は、モバイルのパッケージに収まる大きさを超えている",
        "version-uncodable": "バージョン {version} は Android のバージョンコードに変換できない。メジャーは 2099 まで、マイナーとパッチは 999 まで",
        "appid-android-adjusted": "アプリ ID の {appId} は Android のパッケージ名として不正なので、ビルドは {applicationId} で出す",
        "bundleid-ios-adjusted": "アプリ ID の {appId} は iOS のバンドル識別子として不正なので、ビルドは {bundleId} で出す",
        // 各社の警告画面の名前は出さない。「Gatekeeper」も「SmartScreen」も作者の語彙ではなく、
        // 起きることはどちらも同じ。詳しい話は `build` のヘルプトピックにある。
        unsigned: "コード署名していない。プレイヤーが初めて開くとき、セキュリティの警告が出ることがある",
        "unsigned-android": "手元のデバッグ用の識別情報で署名している。サイドロードには使えるが、これで署名した AAB は Google Play のアップロード鍵として使えない。リリース用キーストアを選んで署名する",
        // 証明書チェーンの注意はここに置く。作者が .p12 を書き出すのはこの文を読んでいる最中で、
        // 末端だけを書き出すと署名の段階でそのまま失敗する。
        "unsigned-ios": "この .ipa は署名されておらず、iOS は署名のないものを一切インストールしない。Apple の署名資格情報を選ぶ。.p12 はキーチェーンアクセスから発行元の証明書チェーンごと書き出す。そうしないと署名に失敗する",
        "signing-credential-missing": "{platform} の署名資格情報がこの端末にない。ここで読み込むか、選択を外して {platform} を署名なしでビルドする",
        "signing-credential-expired": "{platform} の署名証明書は今日の時点で有効ではない（有効期間は {notBefore} から {notAfter}）ので、署名は失敗する。発行元で更新し、新しいものを読み込む",
        "signing-credential-expiring": "{platform} の署名証明書は {notAfter} に期限が切れる。それより前に署名したビルドは有効なまま。以降は更新した証明書が要る",
        "signing-secret-unavailable": "{platform} の署名資格情報のパスワードをこの端末では読めない。資格情報を読み込み直して保存し直す",
        "signing-tool-missing": "{platform} のビルドに署名するには {tool} が必要だが、この端末に入っていない。入れて PATH を通してから、このダイアログを開き直す",
        "signing-host-unsupported": "この端末は {host} で動いており、選んだ資格情報では {platform} 向けに署名できない。この対象は {platform} の端末でビルドする",
        "signing-needs-network": "{platform} のビルドへの署名にはネットワーク接続が要る。このビルドのそれ以外はオフラインでも動く",
        "signing-macos-identity-missing": "{identity} という名前の証明書がこの Mac のキーチェーンにない。キーチェーンアクセスで入れるか、ここで別の証明書を選ぶ",
        "signing-macos-identity-unusable": "証明書 {identity} では署名できない。期限が切れている、秘密鍵がない、発行元のチェーンが揃っていない、のいずれか。どれなのかはキーチェーンアクセスで開くと分かる",
        "signing-macos-not-developer-id": "{identity} は「Developer ID Application」の証明書ではない。この Mac ではビルドが動く。他の Mac では拒否され、公証も通らない",
        "signing-android-not-play": "署名済みの APK はサイドロードや itch.io などのストアで使える。Google Play が受け取るのは AAB だけ。Android の対象で AAB 形式を有効にすると作られる",
        "signing-ios-profile-mismatch": "アプリ ID の {bundleId} はプロビジョニングプロファイルの対象外で、そのプロファイルは {profileAppId} 向けに発行されている。プロジェクトの識別子を変えるか、対象に合うプロファイルを読み込む",
        "cross-build-download": "{platforms} 向けのクロスビルドは、初回だけ Electron をダウンロードする。以降はキャッシュを使う",
        "output-not-writable": "{outputDir} に書き込めない",
        "output-not-empty": "出力フォルダが空ではない。このビルドは名前の一致するファイルを上書きする",
    },
    webStaticNotice: "Web ビルドは、どのウェブサーバーにも置ける静的サイト。アセットの暗号化と HTTP の制限は効かない",
    toast: {
        submitted: "ビルドを開始した。進み具合はコンソールに出る",
        done: "ビルドが完了した",
        failed: "ビルドに失敗した",
    },
    invalidCommand: "{story} / {scene} に無効なコマンド：{source}",
    invalidCommandSummary: {
        other: "ビルドを中止：無効なコマンドが {count} 件ある。コンソールを見る",
    },
    /** AppTag の関門。上の無効なコマンドの対と同じ形。場所ごとに 1 行、最後に件数。 */
    appTagUnresolved: "{story} / {scene} で AppTag が固定の値にならない：{source}",
    appTagUnresolvedSummary: {
        other: "ビルドを中止：固定の値にならない AppTag の式が {count} 件ある。コンソールを見る",
    },
    /**
     * 同じ関門のブループリント側。バリアントの判定が定数にならないグラフのこと。
     *
     * 最初の行は上の `appTagUnresolved` の兄弟としてわざと揃えてある。同じ機能について同じ事実を
     * 報告し、作者は同じコンソールで両方に出会うから。1 行ではなく 3 行なのは、3 つの拒否が
     * それぞれ別の直しどころだから。カットポイントの行と同じく、何が問題かを言ってから打つ手を書く。
     */
    appTagGraphUnresolved: "{blueprint} / {graph} でアプリタグが固定の値にならない。バリアント名と比べるか、その値をそのまま使う",
    appTagGraphUnknownNode: "{blueprint} / {graph} はバリアントを判定しつつ、このビルドが読めないノードも使っている。バリアントの判定をそのノードの無いグラフへ移す",
    appTagGraphFnHead: "{blueprint} / {graph} のバリアントの判定が、Fn があるかどうかを決めている。その Fn を、判定が決める分岐の外へ出す",
    appTagGraphSummary: {
        other: "ビルドを中止：バリアントの判定が固定の値にならないブループリントのグラフが {count} 件ある。コンソールを見る",
    },
    /**
     * カットポイントの関門。上の関門の隣にあり、どのビルドでも同じ理由で拒む。
     *
     * 事実の後は全部が打つ手。打つ手はちょうど 1 つしかないから。カットポイントはストーリーを
     * 終わらせるもので、その場所を言えるのはシーンが必ず通る行だけ。
     */
    cutPointNested: "{story} / {scene} の {variant} のカットポイントが、条件か群の中にある。シーンの最上位へ移す",
    cutPointNestedSummary: {
        other: "ビルドを中止：シーンの最上位に無いカットポイントが {count} 件ある。コンソールを見る",
    },
    /**
     * 中身の関門。ビルドが読めない名前でシーンを開始しうるものがプロジェクトにあり、
     * かつこのバリアントはシーンを落とす。
     *
     * 3 行それぞれが自分の打つ手を持つ。最初の一手が違い、3 つとも出た作者には 3 つとも要るから。
     * 後半はどれも同じで、このバリアントで開始しうるシーンをプロジェクトのパネルに並べること。
     * 何かを取り除くバリアントにしか出ないので、どの行もバリアントを名指す。
     */
    contentBlockedStartStory: "{location} のゲーム開始ノードは、実行中にシーンを決める。インスペクタでシーンを選ぶか、{variant} のバリアントで開始しうるシーンを並べる",
    contentBlockedScript: "ブループリント {location} は TypeScript で書かれていて、どのシーンでも開始できる。{variant} のバリアントで開始しうるシーンを並べる",
    contentBlockedPlugin: "{location} プラグインはどのシーンでも開始できる。{variant} のバリアントで開始しうるシーンを並べる",
    contentBlockedSummary: {
        other: "ビルドを中止：{variant} のビルドが読めないシーンを開始しうるものが {count} 件ある。コンソールを見る",
    },
    /** 並べたシーンが、その後で削除された。止めはせず知らせるだけ。作者の答え自体はまだ有効。 */
    contentStaleDeclaration: "{variant} のバリアントで {location} に並べたシーンが、もうプロジェクトに無い",
    /** このバリアントのパッケージが何になったか。何かを落としたときだけ出す。 */
    contentKept: {
        other: "{variant} のビルドには {count} 件のシーンが入る",
    },
    contentDropped: "{story} の {scene} はこのビルドに入らない",
    /**
     * 参照の索引の関門。シーンを落とすビルドのときだけ、しかもストーリーのドキュメントの欠けにだけ出す。
     * 索引が絵柄を特定できないウィジェットは、どのシーンに行き着けるかについて何も言っていないので、
     * それで拒んでいたら、どのバリアントのビルドも誰も解決できない URL の後ろに置かれてしまう。
     */
    contentCoverageGap: "{location} を読めなかったので、{variant} のビルドが何を落とすかを決められない",
    /** ドキュメント 1 件ではなく索引全体が欠けているときに `{location}` に入る言葉。 */
    contentCoverageWholeProject: "プロジェクト",
    contentCoverageSummary: {
        other: "ビルドを中止：{variant} のビルドはシーンを落とすが、{count} 件のドキュメントを読めなかった。コンソールを見る",
    },
    /**
     * メディアの関門。アセット 1 件につき 1 行、最後にまとめを 1 行。
     *
     * 各行はそれだけで手が打てるように書く。作者が後から戻ってくる先はコンソールだから。
     * 2 つの場合で打てる手が違うので、含みのある 1 文にせず 2 文に分けてある。
     * 一方には変換という道があり、もう一方は中身そのものが無い。
     */
    mediaNeedsConverting: "{asset} は再生できない。アセットブラウザで変換する",
    mediaNotPlayable: "{asset} には音声も映像も入っていない。ファイルを差し替えるか、取り除く",
    mediaSummary: {
        other: "ビルドを中止：再生できないアセットが {count} 件ある。コンソールを見る",
    },
    /**
     * ネットワークの関門。ネットワークを許可していないプロジェクトで、ブループリントがそれを求めている。
     *
     * 上のメディアの関門と同じく無条件で、書き方も同じ。何がおかしいか、次にどうするか。
     * 打てる手を両方とも書くのは、どちらも正しいから。要求は要るのに設定を忘れていた場合と、
     * その要求がもう要らない場合がある。
     */
    networkNodeDisallowed: "{blueprint} はネットワーク要求を行うが、このプロジェクトはそれを許可していない",
    pointerNodeUnsupported: "{blueprint} はマウスカーソルを移動するが、{platforms} では動作しない",
    networkSummary: {
        other: "ビルドを中止：動かせないネットワークノードが {count} 件ある。プロジェクト設定で HTTP の許可を有効にするか、そのノードを取り除く",
    },
    networkAddressNotAllowlisted: "{blueprint} は {url} を要求するが、このアドレスはプロジェクトのネットワーク要求許可一覧にない",
    networkAllowlistSummary: {
        one: "ビルドを中止した。{count} 件のアドレスがネットワーク要求許可一覧にない。プロジェクト設定で追加するか、ノードを修正する",
        other: "ビルドを中止した。{count} 件のアドレスがネットワーク要求許可一覧にない。プロジェクト設定で追加するか、ノードを修正する",
    },
    /** この端末に変換器が無く、検査そのものができなかったときに出す。 */
    mediaUnchecked: {
        other: "メディアファイル {count} 件を検査していない。この端末に変換器がない",
    },
} satisfies LocaleNamespace<"build">;
