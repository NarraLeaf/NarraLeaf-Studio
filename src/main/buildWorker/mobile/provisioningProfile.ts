import { parsePlistDictionary, type PlistDictionary, type PlistValue } from "./plist";

/**
 * Reads a `.mobileprovision` - the file Apple's developer portal hands out and
 * that has to be embedded in a signed `.ipa`.
 *
 * The file is a CMS SignedData envelope (Apple signs the profile) whose payload
 * is a plain XML property list. Only the payload matters here: the signature is
 * Apple's, over Apple's own document, and nothing Studio does can make it more
 * or less valid. So the CMS layer is unwrapped rather than verified, and the
 * plist inside is read with the reader in plist.ts.
 *
 * What callers want out of it is the app it is allowed to sign, which is the
 * `application-identifier` entitlement: `<team prefix>.<bundle id>`, where the
 * bundle id half may end in `*` for a wildcard profile. Checking that against
 * the bundle id a build is about to use is the whole point of the
 * `signing-ios-profile-mismatch` preflight - a profile that does not cover the
 * app produces an `.ipa` that installs nowhere, and the failure is otherwise
 * invisible until a device rejects it.
 *
 * Nothing here logs, and nothing here reads the filesystem.
 */

/* ---------------------------------------------------------------- CMS unwrap */

const OID_SIGNED_DATA = "1.2.840.113549.1.7.2";
const OID_DATA = "1.2.840.113549.1.7.1";

const TAG_OID = 0x06;
const TAG_OCTET_STRING = 0x04;
const TAG_SEQUENCE = 0x30;
const TAG_CONTEXT_0 = 0xa0;
/** Constructed (BER-segmented) OCTET STRING: 0x04 with the constructed bit set. */
const TAG_OCTET_STRING_CONSTRUCTED = 0x24;

export class ProvisioningProfileError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ProvisioningProfileError";
    }
}

const malformed = (detail: string): ProvisioningProfileError =>
    new ProvisioningProfileError(
        `This provisioning profile could not be read: ${detail}. `
        + "Download a fresh copy from the Apple Developer portal.",
    );

type Asn1 = { tag: number; content: Buffer; end: number };

function readAsn1(buffer: Buffer, offset: number): Asn1 {
    if (offset + 2 > buffer.length) {
        throw malformed("a value is cut short");
    }
    const tag = buffer[offset];
    let cursor = offset + 1;
    const first = buffer[cursor++];
    let length: number;
    if (first === 0x80) {
        throw malformed("it uses an encoding this reader does not implement");
    }
    if (first < 0x80) {
        length = first;
    } else {
        const count = first & 0x7f;
        if (count > 4 || cursor + count > buffer.length) {
            throw malformed("a length field is out of range");
        }
        length = 0;
        for (let i = 0; i < count; i++) {
            length = length * 256 + buffer[cursor++];
        }
    }
    const end = cursor + length;
    if (end > buffer.length) {
        throw malformed("a value runs past the end of the file");
    }
    return { tag, content: buffer.subarray(cursor, end), end };
}

function children(node: Asn1): Asn1[] {
    const out: Asn1[] = [];
    let offset = 0;
    while (offset < node.content.length) {
        const child = readAsn1(node.content, offset);
        out.push(child);
        offset = child.end;
    }
    return out;
}

function decodeOid(node: Asn1): string {
    if (node.tag !== TAG_OID || node.content.length === 0) {
        throw malformed("an identifier is malformed");
    }
    const bytes = node.content;
    const arcs: number[] = [Math.floor(bytes[0] / 40), bytes[0] % 40];
    let value = 0;
    for (let i = 1; i < bytes.length; i++) {
        value = value * 128 + (bytes[i] & 0x7f);
        if ((bytes[i] & 0x80) === 0) {
            arcs.push(value);
            value = 0;
        }
    }
    return arcs.join(".");
}

/** The bytes of an OCTET STRING, joining the segments of a constructed one. */
function octets(node: Asn1): Buffer {
    if (node.tag === TAG_OCTET_STRING) {
        return node.content;
    }
    if (node.tag === TAG_OCTET_STRING_CONSTRUCTED) {
        return Buffer.concat(children(node).map(octets));
    }
    throw malformed("the payload is not where a signed document keeps it");
}

/**
 * The XML property list inside a `.mobileprovision`.
 *
 * A bare plist (some tooling hands one out, and it is what a test fixture is
 * easiest to write) is passed through, so the caller need not know which of the
 * two shapes it has.
 */
export function extractProvisioningProfilePlist(file: Buffer): string {
    const head = file.subarray(0, 8).toString("latin1");
    if (head.startsWith("<?xml") || head.startsWith("<plist")) {
        return file.toString("utf8");
    }
    if (file[0] !== TAG_SEQUENCE) {
        throw malformed("it is neither a signed document nor a property list");
    }

    // ContentInfo ::= SEQUENCE { contentType OID, content [0] EXPLICIT ANY }
    const contentInfo = children(readAsn1(file, 0));
    if (contentInfo.length < 2 || decodeOid(contentInfo[0]) !== OID_SIGNED_DATA) {
        throw malformed("it is not a signed document");
    }
    if (contentInfo[1].tag !== TAG_CONTEXT_0) {
        throw malformed("the signed content is missing");
    }
    // SignedData ::= SEQUENCE { version, digestAlgorithms, encapContentInfo, … }
    const signedData = children(readAsn1(contentInfo[1].content, 0));
    const encapsulated = signedData[2];
    if (!encapsulated || encapsulated.tag !== TAG_SEQUENCE) {
        throw malformed("the signed content is missing");
    }
    // EncapsulatedContentInfo ::= SEQUENCE { eContentType OID, eContent [0] EXPLICIT OCTET STRING }
    const parts = children(encapsulated);
    if (parts.length < 2 || decodeOid(parts[0]) !== OID_DATA) {
        throw malformed("the signed content is not a plain document");
    }
    if (parts[1].tag !== TAG_CONTEXT_0) {
        throw malformed("the signed content is missing");
    }
    return octets(readAsn1(parts[1].content, 0)).toString("utf8");
}

/* ------------------------------------------------------------------- facts */

export type ProvisioningProfile = {
    /** The profile's own UUID; what iOS keys an installed profile on. */
    uuid: string;
    /** The name the author sees in the developer portal. */
    name: string;
    /** e.g. "TEAM123456" - taken from the entitlements, not the outer array. */
    teamIdentifier: string;
    /** The team's display name, when the profile carries one. */
    teamName?: string;
    /** The `application-identifier` entitlement: "<team>.<bundle id or pattern>". */
    applicationIdentifier: string;
    /** The bundle-id half of the above; ends in "*" for a wildcard profile. */
    bundleIdPattern: string;
    /** After this the profile signs nothing, whatever the certificate says. */
    expiresAt: Date;
    createdAt?: Date;
    /**
     * UDIDs the profile is limited to. A development or ad-hoc profile lists
     * them; an App Store distribution profile has none, and installs anywhere.
     */
    provisionedDevices: string[];
    /**
     * `get-task-allow` - true on a development profile (the debugger may attach),
     * false on a distribution one.
     */
    allowsDebugging: boolean;
    /** The entitlements dictionary verbatim; zsign derives the signature's from it. */
    entitlements: PlistDictionary;
};

function requireString(source: PlistDictionary, key: string): string {
    const value = source[key];
    if (typeof value !== "string" || value === "") {
        throw malformed(`it has no "${key}"`);
    }
    return value;
}

function optionalString(source: PlistDictionary, key: string): string | undefined {
    const value = source[key];
    return typeof value === "string" ? value : undefined;
}

function stringArray(source: PlistDictionary, key: string): string[] {
    const value = source[key];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function dictionary(value: PlistValue | undefined, what: string): PlistDictionary {
    if (typeof value !== "object" || value === null || Array.isArray(value)
        || value instanceof Date || Buffer.isBuffer(value)) {
        throw malformed(`its ${what} are missing`);
    }
    return value;
}

/** Parse a `.mobileprovision` (or the bare plist inside one) into its facts. */
export function parseProvisioningProfile(file: Buffer): ProvisioningProfile {
    const root = parsePlistDictionary(extractProvisioningProfilePlist(file));
    const entitlements = dictionary(root.Entitlements, "entitlements");
    const applicationIdentifier = requireString(entitlements, "application-identifier");

    // "<team prefix>.<bundle id>". The prefix is usually the team identifier but
    // is not required to be (older accounts differ), so split on the first dot
    // rather than assuming.
    const dot = applicationIdentifier.indexOf(".");
    if (dot <= 0 || dot === applicationIdentifier.length - 1) {
        throw malformed(`its application identifier "${applicationIdentifier}" has no bundle id`);
    }

    const expiration = root.ExpirationDate;
    if (!(expiration instanceof Date)) {
        throw malformed("it has no expiry date");
    }

    return {
        uuid: requireString(root, "UUID"),
        name: requireString(root, "Name"),
        teamIdentifier: optionalString(entitlements, "com.apple.developer.team-identifier")
            ?? stringArray(root, "TeamIdentifier")[0]
            ?? applicationIdentifier.slice(0, dot),
        teamName: optionalString(root, "TeamName"),
        applicationIdentifier,
        bundleIdPattern: applicationIdentifier.slice(dot + 1),
        expiresAt: expiration,
        createdAt: root.CreationDate instanceof Date ? root.CreationDate : undefined,
        provisionedDevices: stringArray(root, "ProvisionedDevices"),
        allowsDebugging: entitlements["get-task-allow"] === true,
        entitlements,
    };
}

/* --------------------------------------------------------------- the check */

export type ProfileBundleIdCheck =
    | { matches: true }
    | {
        matches: false;
        /** Ready for the `signing-ios-profile-mismatch` preflight entry. */
        message: string;
    };

/**
 * Does this profile cover this bundle id?
 *
 * Apple's rule: the pattern either equals the bundle id, or ends in `*` and the
 * bundle id starts with everything before it. `*` alone matches anything, which
 * is what a team's catch-all wildcard profile is.
 */
export function profileCoversBundleId(
    profile: Pick<ProvisioningProfile, "bundleIdPattern" | "name" | "applicationIdentifier">,
    bundleId: string,
): ProfileBundleIdCheck {
    const pattern = profile.bundleIdPattern;
    const covered = pattern.endsWith("*")
        ? bundleId.startsWith(pattern.slice(0, -1))
        : pattern === bundleId;
    if (covered) {
        return { matches: true };
    }
    return {
        matches: false,
        message:
            `The provisioning profile "${profile.name}" is for ${profile.applicationIdentifier}, `
            + `which does not cover the bundle id this build uses (${bundleId}). `
            + "Either change the project's bundle id to match the profile, or use a profile issued for this app.",
    };
}

/** Has the profile expired as of `now`? Kept separate so preflight can warn early. */
export function profileHasExpired(profile: Pick<ProvisioningProfile, "expiresAt">, now = new Date()): boolean {
    return profile.expiresAt.getTime() <= now.getTime();
}
