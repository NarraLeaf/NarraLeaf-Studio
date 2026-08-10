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
        targets: "対象",
        identity: "識別情報",
        // レールに収まる短さ。この節は保護の設定も含む。
        content: "中身",
        signing: "署名",
        output: "出力",
    },
    arch: {
        label: "アーキテクチャ",
        x64: "Intel / AMD（x64）",
        arm64: "ARM（arm64）",
        universal: "ユニバーサル",
    },
    identity: {
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
        networkAllowHttp: "平文の HTTP を許可している",
        networkStrict: "平文の HTTP を遮断している",
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
        // プラットフォームを問わない書き方。モバイル向けのビルドはシェル自身の
        // 仮アイコンに落ちるので、Electron のアイコンではない。
        "icon-missing": "アプリのアイコンが未設定。代わりに NarraLeaf のアイコンが入る",
        "icon-unusable": "{platform} のアイコンを読めなかった。代わりに NarraLeaf のアイコンが入る",
        "icon-low-resolution": "{platform} のアイコンが {minimum}×{minimum} より小さく、引き伸ばして入る",
        "icon-stale": "{platform} のアイコンが用意されていない。「プロジェクト ▸ アプリ」を開いて焼き直す",
        "plugins-invalid": "プラグインの検証に失敗：\n{errors}",
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
            "{plugin} の {sidecar} プログラムは、実行できない状態のまま {platform} の成果物に入る。Windows では"
            + "ファイルに実行属性を付けられない。{targetPlatform} 向けのビルドは {targetPlatform} の端末で行う",
        "encryption-key-unavailable": "アセットの保護が有効だが、その鍵を読めなかった",
        "web-unprotected": "Web 書き出しにアセットの保護は効かない。そのファイル群は保護されずに配布される",
        "web-lossy-images": "非可逆の画像再圧縮が有効なので、書き出す画像は品質 {quality} で再エンコードされ、失われた情報は戻らない",
        "mobile-template-missing": "モバイルのシェルテンプレートを使えない：{reason}",
        "mobile-payload-too-large": "このプロジェクトのアセット（{size}）は、モバイルのパッケージに収まる大きさを超えている",
        "version-uncodable": "バージョン {version} は Android のバージョンコードに変換できない。メジャーは 2099 まで、マイナーとパッチは 999 まで",
        "appid-android-adjusted": "アプリ ID の {appId} は Android のパッケージ名として不正なので、ビルドは {applicationId} で出す",
        "bundleid-ios-adjusted": "アプリ ID の {appId} は iOS のバンドル識別子として不正なので、ビルドは {bundleId} で出す",
        // 各社の警告画面の名前は出さない。「Gatekeeper」も「SmartScreen」も作者の語彙ではなく、
        // 起きることはどちらも同じ。詳しい話は `build` のヘルプトピックにある。
        unsigned: "コード署名していない。プレイヤーが初めて開くとき、セキュリティの警告が出ることがある",
        "unsigned-android": "手元のデバッグ用の識別情報で署名している。これはサイドロードにしか使えず、これで署名した AAB は Google Play のアップロード鍵として使えない。自分の識別情報で署名するにはリリース用キーストアを選ぶ",
        // 証明書チェーンの注意はここに置く。作者が .p12 を書き出すのはこの文を読んでいる最中で、
        // 末端だけを書き出すと署名の段階でそのまま失敗する。
        "unsigned-ios": "この .ipa は署名されておらず、iOS は署名のないものを一切インストールしない。Apple の署名資格情報を選ぶ。.p12 はキーチェーンアクセスから発行元の証明書チェーンごと書き出す。そうしないと署名に失敗する",
        "signing-credential-missing": "{platform} の署名資格情報がこの端末にない。鍵の情報がプロジェクトと一緒に運ばれることはない。ここで読み込むか、選択を外して {platform} を署名なしでビルドする",
        "signing-credential-expired": "{platform} の署名証明書は今日の時点で有効ではない（有効期間は {notBefore} から {notAfter}）ので、署名は失敗する。発行元で更新し、新しいものを読み込む",
        "signing-credential-expiring": "{platform} の署名証明書は {notAfter} に期限が切れる。それより前に署名したビルドは有効なまま。以降は更新した証明書が要る",
        "signing-secret-unavailable": "{platform} の署名資格情報のパスワードをこの端末では読めない。資格情報を読み込み直して保存し直す",
        "signing-tool-missing": "{platform} のビルドに署名するには {tool} が必要だが、この端末に入っていない。入れて PATH を通してから、このダイアログを開き直す",
        "signing-host-unsupported": "この端末は {host} で動いており、選んだ資格情報では {platform} 向けに署名できない。その秘密鍵は当該プラットフォームにしかないシステムのサービスの中にある。この対象は {platform} の端末でビルドする",
        "signing-needs-network": "{platform} のビルドへの署名にはネットワーク接続が要る。このビルドのそれ以外はオフラインでも動く",
        "signing-macos-identity-missing": "{identity} という名前の証明書がこの Mac のキーチェーンにない。キーチェーンアクセスで入れるか、ここで別の証明書を選ぶ",
        "signing-macos-identity-unusable": "証明書 {identity} では署名できない。期限が切れている、秘密鍵がない、発行元のチェーンが揃っていない、のいずれか。どれなのかはキーチェーンアクセスで開くと分かる",
        "signing-macos-not-developer-id": "{identity} は「Developer ID Application」の証明書ではない。この Mac ではビルドが動くが、他人の Mac では Gatekeeper が拒み、Apple の公証も通らない",
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
    networkSummary: {
        other: "ビルドを中止：動かせないネットワークノードが {count} 件ある。プロジェクト設定で HTTP の許可を有効にするか、そのノードを取り除く",
    },
    /** この端末に変換器が無く、検査そのものができなかったときに出す。 */
    mediaUnchecked: {
        other: "メディアファイル {count} 件を検査していない。この端末に変換器がない",
    },
} satisfies LocaleNamespace<"build">;
