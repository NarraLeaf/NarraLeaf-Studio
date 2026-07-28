/**
 * Embedded key material for the signing tests. Real files, made once with the
 * tools an author would use and then frozen here - so the tests exercise what
 * keytool and openssl actually write rather than what this repo believes they
 * write, while still running offline on a machine with neither installed.
 *
 * These are throwaway probe identities whose passwords are published right
 * here. They sign nothing anyone trusts and no NarraLeaf release ever uses them.
 *
 * How they were made:
 *
 *   keytool -genkeypair -keystore release.p12 -storetype PKCS12
 *     -storepass androidprobe -keypass androidprobe -alias release
 *     -keyalg RSA -keysize 2048 -validity 10000
 *     -dname "CN=NarraLeaf Release Probe, OU=Studio, O=NarraLeaf, C=US"
 *   ...and the same with -storetype JKS for the .jks below.
 *
 *   openssl: a CA, then a leaf issued by it, standing in for an Apple
 *   "Apple Development" certificate under the WWDR intermediate; both exported
 *   into one .p12, which is the shape iOS signing requires.
 */

function decode(parts: string[]): Buffer {
    return Buffer.from(parts.join(""), "base64");
}

/* ------------------------------------------------------------------ Android */

/** The password on both Android keystores below - store and key alike. */
export const ANDROID_KEYSTORE_PASSWORD = "androidprobe";
/** The alias both of them hold. */
export const ANDROID_KEYSTORE_ALIAS = "release";

const ANDROID_RELEASE_P12 = [
    "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",
];

/** A keytool-written PKCS#12 release keystore, self-signed as release keys are. */
export function androidReleaseP12(): Buffer {
    return decode(ANDROID_RELEASE_P12);
}

/**
 * keytool's own SHA-256 of the certificate inside `androidReleaseP12`, copied
 * from `keytool -list -v`. An independent oracle: an APK whose signer
 * certificate hashes to this was signed by that keystore and nothing else.
 */
export const ANDROID_RELEASE_P12_SHA256 =
    "2D:76:18:EC:E3:EC:10:64:43:F2:29:67:23:BA:A1:60:6C:54:DB:AF:94:0D:74:1B:2C:71:9C:92:F4:1D:FC:FA";

/** The certificate's subject, as keytool wrote it. */
export const ANDROID_RELEASE_P12_SUBJECT = "CN=NarraLeaf Release Probe";

const ANDROID_RELEASE_JKS = [
    "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",
    "oSTc78qk2XP3lxK4gqNkR4Cs1yPBAnPCPCQ=",
];

/** The same identity in Sun's JKS format, which authors still have plenty of. */
export function androidReleaseJks(): Buffer {
    return decode(ANDROID_RELEASE_JKS);
}

/** keytool's SHA-256 for the JKS keystore's certificate - a different key. */
export const ANDROID_RELEASE_JKS_SHA256 =
    "4D:28:66:59:5A:9E:5F:A2:DB:1A:25:09:86:66:13:8B:8B:7F:0D:6A:9C:02:C0:AA:A4:F7:0A:5E:FC:A9:62:B8";

/* ---------------------------------------------------------------------- iOS */

const APPLE_IDENTITY_P12 = [
    "MIIPtgIBAzCCD2QGCSqGSIb3DQEHAaCCD1UEgg9RMIIPTTCCCWoGCSqGSIb3DQEHBqCCCVswgglXAgEAMIIJUAYJKoZIhvcNAQcBMF8G",
    "CSqGSIb3DQEFDTBSMDEGCSqGSIb3DQEFDDAkBBBmYYPkaNl7ZltRVdeF+4MxAgIIADAMBggqhkiG9w0CCQUAMB0GCWCGSAFlAwQBKgQQ",
    "VPfh/i2Yg4tneNva0EsZ+oCCCODRPEDmPnUoeqpdhmENR0rcWpVOFoHJAIxTkbO21pShk2auDZFcw2H1tUJxN7vIxl7T/XGUtovYbWu2",
    "pEN2Ajjyiom2UWGAfmAO2hqwYQKbu+CavuQndClt/aiocdhi1WlRyfolMyU1Tfb09r7FhCi+JSJF1MfRCV2QoPXRmjis9LVvfIGguoxi",
    "m01ECA+mKonMmmcmTBPKvU7koSm8xO/cSbHhno3Sl2Yp88b+5E0o5qFTUwadgFZfBRQlsx0WpkmjhCBEbhWUvDcy8WiRZzsXG4By1DCP",
    "Bu7qEs8uuOuo+Q5zEa/skD2ytq9t4KcMoXadDpgIjwSGN1qwN4siJ6uqPTWSltLBVoSxVxpipYG7cc6bMoF0VNKh20RsRTr8+/rXGJSn",
    "CwjNsYMUeiXE2ENu0vEJpZdubL35tw9ClCMRaI824wbG8YKJZRoZMqGloApzOrCRRl+gSDJSioBWz9d0q1DtbU1vLLfGZQct9IP552jt",
    "kNcrURgJk8b/6APPsnunkB5Q5GpI49JK3hFgFsm0LAth2CggReYWOb3vbJIA53LJkEFwC/tlXTFBp22BQZSoSZ+q4/4M144xThDe4Zzn",
    "2w1r179IralS8vyBtj+3qojpJq1+g20fiuNhz1HUgLAIDPSHPXxooL2Frkwat9UySrV0euy6+UJCPeHpTjayW/p8+K4mNBZdZzNbAL5B",
    "iueMcZikn+0caZDHqEsmcvCy4HvOsz0Wc93nlsz6Fw5nrKzlIGv8PmJFgwsX6o0es+7MFnnAo9Tj2WM1EgCi2oB9ibaC2oWjrFz/Ssnv",
    "jpcvznfl2Sds3bz7qK265qj3PgvRC99FN7lNXZZk2CGt1/teI3mQle0/jirbVX6nAy4Q74C/OHW89BAXUJwBt5EPRo/9UNilM59yFXpm",
    "U8ZVfHqOT9SgmrklIsC1zHbH4AhRA8gZJnIvBbV+xD0D9LQU9ftyzQmaQJAO8vTbvDa/9M3ET5YOCfusZKe+v+FFv2qs26RFP1wHvg6k",
    "7p9bVkUekXu7rJUrptbVcUIuh0qVGIDxxEiWmZa20l3kqIZ6p4kDQyx/MHfZV5Aa9AUpJ4NJCvNQ/DnmT0pBZZOSQMZzwrvtEJHiUFwT",
    "zSM/ORje0BdepiHCKehspyQOzBZnwjPgC1/WdfV60VNhoJhj0oMIpwIQyf5q5OIv2gnhIGRbd5xC1B8R2WVSIvrEy7qE5WhJEozeFmY+",
    "L1ZD6h77G6vE4/8ETUhjulXNlZ/bmTN9VYbAj50LeQEB1NNXfd2P+wcAbplxsU55a53ZX05mO0d6veumE0UbQQfJNsOsmB1ssrSESw2+",
    "A/f60aESJ7ywz530YHE5t8mhOX9h83JFeCgMEgL7eXvCsexbZ6ZWvP+o9IzVjYsuytpNfZPwiGJ7xawTmYkXVS+iZjRgK07U1+m9/A/V",
    "cTh0veSKczICp5I48sm8kuXh0Bq0XSFCMN4dVyIQlRDtp6hj8sr9bfLwzArEd2C3pLzohZysxiwkaz0SmF+BPT2rQ58FHjtc02DiX9sy",
    "BabRdtHppqT7Nnvvkvv7NZoV8Ik1EZqD6u/mLvD72MtEF5LvKRruTklKw7XM8GHZ35iR213O5ved971OGzJF3YbvCD5NoaTdykV6Wv4g",
    "68xi3VIC4xPT2bvdk79oG96MDooGaEEpUjmz/xpFskNr8Zf5J8Dm2q+bi3X7RaW63z+3Lxm48xuOJfVagx16mSTwQO3Dhs7z2C+jM+SU",
    "oTzz3D5WXztthEErgwBOP/cuFqdapv5fxx3+o/GungEuS1UaFBY3MfnFa8CkT1h4mJ0/vD2kNl2aJHoCxfbuG7nZAiddaRsr9nzaWidh",
    "VibhJGJ4eGOdorgbdPDACV/P/K8QkuNuMvukk4JOFPD+chTYiK1qWDUTnv1YHk5KOW7lEuU6OiQzhzL+GzNg3Mkr89gWWMZ4Y1bNjAYf",
    "LqdmGCoZVJiFOzP7pMQpcnTLrMTsjHgInEa1tYPPmKXV8TG1mLS0t9nD87Hwedvl5+pJuD2AVChqboO+nfPjKxkxONkb8UBe1hGle7zi",
    "gVoNMxNV9X+5CVEwsnz7ov8gXx9xyxUnX2vMb5Y49UQbu/+V3WmQP9aY2HF2OmgsmED/TXB4F0Rwbkaj0rBZn4a7Gw/4jnekaLGzGZem",
    "HuaAkijW22Jy9PUM67NIOorBZH+rC3air2PDZagiRbf/csRTMnXe1gBqZdUv12ZpKlH8Y0sV6nKss+qCoW/IxvPCaCDtxSZaEfvVhkY9",
    "O/6mfu9TrEiNIFrR9atyg/BXdzZOHDRzzNmG1dYG70kt2RwniHgW9fyETmHUe8ShKXovkv1LGmh8pFEfebvUXeIKcM4VVhW8LtMISUFC",
    "muRdK7d5LqLWDP7XJJQx+0LeeGYB3XX3O2OO42r2H+x/bwTjswkuWISCP3iUsyuu0LAumglJvHxhlhw0JnYYKe7anm3PN/5yIS5STf6a",
    "kxI778n48UVXAoqcvPi8IHVZImAf9Uwq1HEB6DB02hri41nCFIbEB38VQpatu3sTi5ZKEb6rZTvDbwGVTPZI3kSk4s0yn4K+v3cmJNNx",
    "37TOffc0Joi3n7JqZq5Wk9SHJ+k3JoX60WrP5bdBOnRyJQbIOJYvI8fNap+3fMWjytPsGZKIXbQk2ZDVzG7bCEDeVkh076JQ5mhWpCqj",
    "SwIuuN5LHKXpB5xb1T6GOu2a0fW3q46OPZOryyFzKTlzjYUGUcu+LHpL834An6wi1MQRvW7T+6Apr8YC/FsljpRxjaHmxHlCARvlVLEH",
    "/L0w6mcMHnmFCO7JHFjugmUUI4QqWRXnPqhagw69EOWZH1RwumG+T6D9KorP2CHdMWXkmVcEH/4tHjNB6VDjDmKJMl8hmr7A6zAKlKb+",
    "moprwD1At4Grq1BfLgO5ADgtr1ZXZEsUt8tCjjOE956jwgIcFLbEG3rAUw5VpnNWaiimRouH8GN4nWHBS5UlOEjXdGZ0UCzMxB48GzFE",
    "4UMQe97xdQEvAHtKtYc9Sbno2dRjWfJTuUGATI18MIIF2wYJKoZIhvcNAQcBoIIFzASCBcgwggXEMIIFwAYLKoZIhvcNAQwKAQKgggU5",
    "MIIFNTBfBgkqhkiG9w0BBQ0wUjAxBgkqhkiG9w0BBQwwJAQQCdNM28OYEKS+Y59P8fKccwICCAAwDAYIKoZIhvcNAgkFADAdBglghkgB",
    "ZQMEASoEEIpV2TprKzTi6tdvIeAgkWEEggTQHsoWyBGL74bHMBA+cj0vZ5bPSrTuzfKCgp0+8Ljh4gQdP6A1xtjprEvi3AOhpH7rZn5l",
    "/J4FZbsQrh3Nx30gI1CP1f9Pv3vC03T6r426bnM/F6ygBDyRcUpfNbsUJ0Vzd24/OjVQ7KpcA2r1tgh9T1yHZvQglABA0EAWkZkoKEhS",
    "kO3WGX1zpLqo3Wr6eGnNAfSnDIoHf1AadFYUvFMz/hFu7ssA7ciAPiYdD2ogk9eUP1sLjYGWIFxV5c0Vgm3hnkFSYomq0G+oZoUtw2nM",
    "8pE79ALCygYNafYIgVlVHJ1rPQ2aGZTpkcU3pl2EpAGIjvjVcwsU2JAvSC/goc49VYPo0EcdVo7BG5KOqnCA4JBFUbIMDxHGj3Q82c45",
    "6K4+XAI9RiEGlbpzhMxNh9UumSWn+YWDoWZzya5qhA/FsyRAnJPaQlKtLIJi8yRpCzsNlq3G51gHsPZ2R6DKtBjAw615RLY2jKtXcTh8",
    "CWccCfEtverEdUHI/oMIc7b1YXIgzg/eSaX+b/igpTk3KI3mt8axzY2fFZKR9C4W4g8RHYJwMt/B6YgFe2hLhMdeDEvMY28LFXGAVeC7",
    "0CN/32DEgkSFCnbhvRVH5K103QzY+7SXA2/hcttyfDqC7astmQnDMn85/X0425RMCO4NqXbfk4Ryo96e7ZVuJqXnXpeV4c1PpWxUb0bW",
    "4VvXN9UV/HBxBpLlwIFK15bN+ubpMHXD9jW2SN+kx6z2fNtoi96XblitfoX7OIM+ON9gs1SpO2DOb+MQ+ILru2ev+ot5HdXrQwwN+uBR",
    "dBZpuSflE9dGbyMfRP8hbX2HxzHVJWHzd0jBfVQoBYM7RkyV3I2YVUEgMEmHKpAbse/ZwMsG9T0cegjXhNkSPLzeNDwl+GOtyYItloUS",
    "iSKUpG4Xp+5m1pJJxM+VHv7GU6CTF9KKgzzJ1DsmPipZDMoqe5NxAw+z2tVfcOs9O0aCWu9QpfU5hcOQvxNDf05AQN8RIIyl9yiv99Vv",
    "3DsI66/i9HF61OvnCN9FM80sAOjgTHQ7xaSXP4a0T+q8nR8VCgpxLyL0FzbhlcDFL63JF3k/cDsn9d3SvIr3mF331gRJS9AZxbxt2FKY",
    "LsuJ6cuJkG5pVVMI1PjO+0Ja+BcvSMEOwrc8i3FfQFCwhbdhkPzyXpvDT8Jhmt70M9/jQGbDP7OcJRNKtl+G6KsKhA1vMbGIP9ME9vxZ",
    "c2dpMjU5VY4QquG2JfDluDrOB83kVYbBriJQPaPNGJUo9rmm15DecVWbbNDEoJFMwBmqv72PKfVuJkFB+JaPInc6XgbXBw1IyCPYzrGW",
    "Y/Hbcml6nwHq4RqlIB1tpQqBcsHjleWF8jFHcx3xlL2BkNrBGJkcDBI2LANPhYaSTLPuJmK1gdegFiUUOo8f8bYNCHJw2p+zzYmKYWC2",
    "fXFPt+5unjTHuefiIJSPa2sWrvo5RD3JPpFdPun98z4xq13NWVpI/gOq5R1q3JE9Ord5RjVuosxoH5FGazXlD/E5H7YgoV7ElZ8w9UPt",
    "Fwj2fiHMY818c/ZSCe5EZCIxdaO2x2bgQaU5EmqgtuYo9duc62EyTHN9xe2nqQWcQ2vFtNzpGD0a/aOxFAk9W9qsE8a5ojnB/xXAcLNE",
    "mrj6qdylywxEt0kxdDAjBgkqhkiG9w0BCRUxFgQURzWWN64TLroSglHqi9I9Uc7BXIkwTQYJKoZIhvcNAQkUMUAePgBBAHAAcABsAGUA",
    "IABEAGUAdgBlAGwAbwBwAG0AZQBuAHQAOgAgAFAAcgBvAGIAZQAgAFQAZQBzAHQAZQByMEkwMTANBglghkgBZQMEAgEFAAQgxRhieCcn",
    "hUoMg7YadcYg54H/143seHbLZiIWN/NPIIcEEAYSQ74BXBVNUz4Os3E/DfECAggA",
];

/** The password on `appleIdentityP12`. */
export const APPLE_IDENTITY_PASSWORD = "probe123";

/**
 * An Apple-shaped signing identity: the leaf plus the intermediate that issued
 * it. Both are needed - a signer handed only the leaf cannot build the chain
 * the signature has to carry, and fails with an error about the issuer.
 */
export function appleIdentityP12(): Buffer {
    return decode(APPLE_IDENTITY_P12);
}

export const APPLE_IDENTITY_SUBJECT_CN = "Apple Development: Probe Tester (ABCDE12345)";

const APPLE_PROVISIONING_PROFILE = [
    "MIIRRQYJKoZIhvcNAQcCoIIRNjCCETICAQExDzANBglghkgBZQMEAgEFADCCCk4GCSqGSIb3DQEHAaCCCj8Eggo7PD94bWwgdmVyc2lv",
    "bj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPCFET0NUWVBFIHBsaXN0IFBVQkxJQyAiLS8vQXBwbGUvL0RURCBQTElTVCAxLjAvL0VO",
    "IiAiaHR0cDovL3d3dy5hcHBsZS5jb20vRFREcy9Qcm9wZXJ0eUxpc3QtMS4wLmR0ZCI+CjxwbGlzdCB2ZXJzaW9uPSIxLjAiPgo8ZGlj",
    "dD4KCTxrZXk+QXBwSUROYW1lPC9rZXk+PHN0cmluZz5OYXJyYUxlYWYgUHJvYmU8L3N0cmluZz4KCTxrZXk+QXBwbGljYXRpb25JZGVu",
    "dGlmaWVyUHJlZml4PC9rZXk+PGFycmF5PjxzdHJpbmc+VEVBTTEyMzQ1Njwvc3RyaW5nPjwvYXJyYXk+Cgk8a2V5PkNyZWF0aW9uRGF0",
    "ZTwva2V5PjxkYXRlPjIwMjYtMDctMjhUMDA6MDA6MDBaPC9kYXRlPgoJPGtleT5EZXZlbG9wZXJDZXJ0aWZpY2F0ZXM8L2tleT48YXJy",
    "YXk+PGRhdGE+TUlJRUJEQ0NBdXlnQXdJQkFnSVVVUVhTNVYxZjc2bkpaUFB6elppYWhWeGl0a0F3RFFZSktvWklodmNOQVFFTEJRQXdn",
    "WkF4UkRCQ0JnTlZCQU1NTzFCeWIySmxJRmR2Y214a2QybGtaU0JFWlhabGJHOXdaWElnVW1Wc1lYUnBiMjV6SUVObGNuUnBabWxqWVhS",
    "cGIyNGdRWFYwYUc5eWFYUjVNU1l3SkFZRFZRUUxEQjFRY205aVpTQkRaWEowYVdacFkyRjBhVzl1SUVGMWRHaHZjbWwwZVRFVE1CRUdB",
    "MVVFQ2d3S1VISnZZbVVnU1c1akxqRUxNQWtHQTFVRUJoTUNWVk13SGhjTk1qWXdOekk0TWpFek9ETTNXaGNOTWpjd056STRNakV6T0RN",
    "M1dqQndNVFV3TXdZRFZRUUREQ3hCY0hCc1pTQkVaWFpsYkc5d2JXVnVkRG9nVUhKdlltVWdWR1Z6ZEdWeUlDaEJRa05FUlRFeU16UTFL",
    "VEVUTUJFR0ExVUVDd3dLVkVWQlRURXlNelExTmpFVk1CTUdBMVVFQ2d3TVVISnZZbVVnVkdWemRHVnlNUXN3Q1FZRFZRUUdFd0pWVXpD",
    "Q0FTSXdEUVlKS29aSWh2Y05BUUVCQlFBRGdnRVBBRENDQVFvQ2dnRUJBTWNhRTlQM0hnQ0Q3NlZDL2tsazNGZTF2UkR1d3hjdUcraDd1",
    "elh3ZXR2d0ZWbnA4L2h5bzVMTkpLU2g0azRtSEZiQWpPL0ZEblEzZ3ptQTRoandwamc0YVhDVW8vZ3hqNkF4SStFRU92RVZIbTZhdTZp",
    "TSsyaTdzYU95bHBEaUJpeFhjelk0MGFmWEs0dWlwOHV3RTA2TitlbithUDFoYkF4V2RGZGhnSDVZVEVlWXdTMElxcCtuUlBSWnVieE1h",
    "bDB1UHMrOEFjMHhxZzBKYThmRC9Zclo4UnpSSy9IZ1JLNWNoai9WUmR3a3NNZUZFUGZpOGZGOUxmRWwxWTRRQlRMbE4rc0N1N2tLMG56",
    "ang1dEIxNUFBQ3ZyYU1Oc2QwcmExWmZXb1JrQzBoQU8rcjZURE1xQVNSU2tmZGRJTDdnRXhEL2VqWDFKc2ZrdDFRR1VsWWVVQ0F3RUFB",
    "YU4xTUhNd0RBWURWUjBUQVFIL0JBSXdBREFPQmdOVkhROEJBZjhFQkFNQ0I0QXdFd1lEVlIwbEJBd3dDZ1lJS3dZQkJRVUhBd013SFFZ",
    "RFZSME9CQllFRkJudTN0U3hYbUlvWlZleG9wbFBRR1JOaTlNVU1COEdBMVVkSXdRWU1CYUFGTUxoaFJyY1FzR2Mwa0hzSVJWaFJMZFUx",
    "ekZLTUEwR0NTcUdTSWIzRFFFQkN3VUFBNElCQVFBUDVKcXorUmRSbHBXaitaWUU1NUdWQ2VEL0l0MEJjaWRwUUN1KzZiZ29ncEErNG1m",
    "NXZFQTJ4UmJUUEZTZkRUeDZPNk5hL0pqNjdZWXI5b2gva1hQam94N2hrQkYwcU1RNXpEZkJaWnEzMzNBengzeDBGcnpwZUJFaThZcVVl",
    "UEhKcGcxVmlJcGlkbWczOUljTnJIM25UTEEzRndpYi9xejMxdEc4OEJnMEx1T1NHOWNIVFFZUGhHUTBXOFF3MEU0NFEvL1RPMXRycXd5",
    "ZEoxbVlxMjVPamZxdC83My9RdWpVRXc1NnFoNWNwUzQrQ1Y1bGR4eDRmc05JRWFBa2tHL3JOa3l6WnRMVDBGYmtVQkt3TVBHQjQzUHRC",
    "SHNVZUROSXdIcXFET3BZQjNFUFdvZ3luMExaeGRXVWJuQVRzMmEvVnRzdldYUU5sK3ozaTVZdW9JZWI8L2RhdGE+PC9hcnJheT4KCTxr",
    "ZXk+RW50aXRsZW1lbnRzPC9rZXk+PGRpY3Q+CgkJPGtleT5hcHBsaWNhdGlvbi1pZGVudGlmaWVyPC9rZXk+PHN0cmluZz5URUFNMTIz",
    "NDU2LmNvbS5uYXJyYWxlYWYuZ2FtZXMucHJvYmU8L3N0cmluZz4KCQk8a2V5PmNvbS5hcHBsZS5kZXZlbG9wZXIudGVhbS1pZGVudGlm",
    "aWVyPC9rZXk+PHN0cmluZz5URUFNMTIzNDU2PC9zdHJpbmc+CgkJPGtleT5nZXQtdGFzay1hbGxvdzwva2V5Pjx0cnVlLz4KCQk8a2V5",
    "PmtleWNoYWluLWFjY2Vzcy1ncm91cHM8L2tleT48YXJyYXk+PHN0cmluZz5URUFNMTIzNDU2Lio8L3N0cmluZz48L2FycmF5PgoJPC9k",
    "aWN0PgoJPGtleT5FeHBpcmF0aW9uRGF0ZTwva2V5PjxkYXRlPjIwMjctMDctMjhUMDA6MDA6MDBaPC9kYXRlPgoJPGtleT5OYW1lPC9r",
    "ZXk+PHN0cmluZz5OYXJyYUxlYWYgUHJvYmUgUHJvZmlsZTwvc3RyaW5nPgoJPGtleT5Qcm92aXNpb25lZERldmljZXM8L2tleT48YXJy",
    "YXk+PHN0cmluZz4wMDAwODAzMC0wMDAwMDAwMDAwMDAwMDBFPC9zdHJpbmc+PC9hcnJheT4KCTxrZXk+VGVhbUlkZW50aWZpZXI8L2tl",
    "eT48YXJyYXk+PHN0cmluZz5URUFNMTIzNDU2PC9zdHJpbmc+PC9hcnJheT4KCTxrZXk+VGVhbU5hbWU8L2tleT48c3RyaW5nPlByb2Jl",
    "IFRlc3Rlcjwvc3RyaW5nPgoJPGtleT5UaW1lVG9MaXZlPC9rZXk+PGludGVnZXI+MzY1PC9pbnRlZ2VyPgoJPGtleT5VVUlEPC9rZXk+",
    "PHN0cmluZz4xMTExMTExMS0yMjIyLTMzMzMtNDQ0NC01NTU1NTU1NTU1NTU8L3N0cmluZz4KCTxrZXk+VmVyc2lvbjwva2V5PjxpbnRl",
    "Z2VyPjE8L2ludGVnZXI+CjwvZGljdD4KPC9wbGlzdD4KoIIECDCCBAQwggLsoAMCAQICFFEF0uVdX++pyWTz882YmoVcYrZAMA0GCSqG",
    "SIb3DQEBCwUAMIGQMUQwQgYDVQQDDDtQcm9iZSBXb3JsZHdpZGUgRGV2ZWxvcGVyIFJlbGF0aW9ucyBDZXJ0aWZpY2F0aW9uIEF1dGhv",
    "cml0eTEmMCQGA1UECwwdUHJvYmUgQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkxEzARBgNVBAoMClByb2JlIEluYy4xCzAJBgNVBAYTAlVT",
    "MB4XDTI2MDcyODIxMzgzN1oXDTI3MDcyODIxMzgzN1owcDE1MDMGA1UEAwwsQXBwbGUgRGV2ZWxvcG1lbnQ6IFByb2JlIFRlc3RlciAo",
    "QUJDREUxMjM0NSkxEzARBgNVBAsMClRFQU0xMjM0NTYxFTATBgNVBAoMDFByb2JlIFRlc3RlcjELMAkGA1UEBhMCVVMwggEiMA0GCSqG",
    "SIb3DQEBAQUAA4IBDwAwggEKAoIBAQDHGhPT9x4Ag++lQv5JZNxXtb0Q7sMXLhvoe7s18Hrb8BVZ6fP4cqOSzSSkoeJOJhxWwIzvxQ50",
    "N4M5gOIY8KY4OGlwlKP4MY+gMSPhBDrxFR5umruojPtou7GjspaQ4gYsV3M2ONGn1yuLoqfLsBNOjfnp/mj9YWwMVnRXYYB+WExHmMEt",
    "CKqfp0T0Wbm8TGpdLj7PvAHNMaoNCWvHw/2K2fEc0Svx4ESuXIY/1UXcJLDHhRD34vHxfS3xJdWOEAUy5TfrAru5CtJ848ebQdeQAAr6",
    "2jDbHdK2tWX1qEZAtIQDvq+kwzKgEkUpH3XSC+4BMQ/3o19SbH5LdUBlJWHlAgMBAAGjdTBzMAwGA1UdEwEB/wQCMAAwDgYDVR0PAQH/",
    "BAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMDMB0GA1UdDgQWBBQZ7t7UsV5iKGVXsaKZT0BkTYvTFDAfBgNVHSMEGDAWgBTC4YUa3ELB",
    "nNJB7CEVYUS3VNcxSjANBgkqhkiG9w0BAQsFAAOCAQEAD+Sas/kXUZaVo/mWBOeRlQng/yLdAXInaUArvum4KIKQPuJn+bxANsUW0zxU",
    "nw08ejujWvyY+u2GK/aIf5Fz46Me4ZARdKjEOcw3wWWat99wM8d8dBa86XgRIvGKlHjxyaYNVYiKYnZoN/SHDax950ywNxcIm/6s99bR",
    "vPAYNC7jkhvXB00GD4RkNFvEMNBOOEP/0ztba6sMnSdZmKtuTo36rf+9/0Lo1BMOeqoeXKUuPgleZXcceH7DSBGgJJBv6zZMs2bS09BW",
    "5FASsDDxgeNz7QR7FHgzSMB6qgzqWAdxD1qIMp9C2cXVlG5wE7Nmv1bbL1l0DZfs94uWLqCHmzGCArwwggK4AgEBMIGpMIGQMUQwQgYD",
    "VQQDDDtQcm9iZSBXb3JsZHdpZGUgRGV2ZWxvcGVyIFJlbGF0aW9ucyBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTEmMCQGA1UECwwdUHJv",
    "YmUgQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkxEzARBgNVBAoMClByb2JlIEluYy4xCzAJBgNVBAYTAlVTAhRRBdLlXV/vqclk8/PNmJqF",
    "XGK2QDANBglghkgBZQMEAgEFAKCB5DAYBgkqhkiG9w0BCQMxCwYJKoZIhvcNAQcBMBwGCSqGSIb3DQEJBTEPFw0yNjA3MjgyMTM4NDJa",
    "MC8GCSqGSIb3DQEJBDEiBCAfZvKlKn/N25k1OqzzZ/G7oT3EJRbhiR45FkHtUjZi6DB5BgkqhkiG9w0BCQ8xbDBqMAsGCWCGSAFlAwQB",
    "KjALBglghkgBZQMEARYwCwYJYIZIAWUDBAECMAoGCCqGSIb3DQMHMA4GCCqGSIb3DQMCAgIAgDANBggqhkiG9w0DAgIBQDAHBgUrDgMC",
    "BzANBggqhkiG9w0DAgIBKDANBgkqhkiG9w0BAQEFAASCAQAP+wWKtwabXZ5Hdbb6Fx7qZvgCf9p0cfyMpvTrhinrn9mc4+w5vuaP5Xq2",
    "5zhCU/GviQJJ0G+vR6B5IPSl7VLV+WkLhxOHa/GATtDH34s7cvS89/ckuAWyhjyUyEZg/MpNgeOsz44TMOer9pnoRkcAxPNrBgAimtbe",
    "JyD6qUScCJCpXW1nlqH3y5znZwTvuiyeFXbu+fV18sVsnHZFxLhttLvCgS2EkpBiqwzT2EZXSYBDJTjNRaa12fykanNnwDN02KfdDopL",
    "Q8Kvk0S8M1pUViyZKFB6o+8US5c1RKY5RCLnFbbMrxxDcc7cEhsHMzsRD09kzLHw34y7j0ZUK1oO",
];

/**
 * A provisioning profile in the real shape: a CMS SignedData envelope around an
 * XML plist. It covers exactly `com.narraleaf.games.probe` under team
 * TEAM123456, lists one provisioned device, and expires in 2027.
 */
export function appleProvisioningProfile(): Buffer {
    return decode(APPLE_PROVISIONING_PROFILE);
}

export const APPLE_PROFILE_APP_ID = "TEAM123456.com.narraleaf.games.probe";
export const APPLE_PROFILE_BUNDLE_ID = "com.narraleaf.games.probe";
export const APPLE_PROFILE_TEAM = "TEAM123456";
export const APPLE_PROFILE_NAME = "NarraLeaf Probe Profile";
