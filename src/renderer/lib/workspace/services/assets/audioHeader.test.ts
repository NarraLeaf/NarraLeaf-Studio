import { describe, expect, it } from "vitest";
import { readAudioHeader } from "./audioHeader";

const bytes = (...parts: (number[] | string)[]): Uint8Array =>
    new Uint8Array(parts.flatMap(part => (typeof part === "string" ? [...part].map(char => char.charCodeAt(0)) : part)));
const u16 = (value: number) => [value & 0xff, (value >> 8) & 0xff];
const u32 = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];

describe("readAudioHeader", () => {
    it("reads a WAV's fmt chunk, wherever it sits", () => {
        const wav = bytes("RIFF", u32(0), "WAVE", "LIST", u32(4), "abcd", "fmt ", u32(16), u16(1), u16(1), u32(22_050), u32(0), u16(0), u16(16));
        expect(readAudioHeader(wav)).toEqual({ sampleRate: 22_050, channels: 1 });
    });

    it("reads the first MPEG frame after an ID3 tag", () => {
        // MPEG-1 Layer III, 128 kbit/s, 48 kHz, stereo - behind a 4-byte ID3v2 tag.
        const mp3 = bytes("ID3", [4, 0, 0, 0, 0, 0, 4], [0, 0, 0, 0], [0xff, 0xfb, 0x94, 0x00]);
        expect(readAudioHeader(mp3)).toEqual({ sampleRate: 48_000, channels: 2 });
        // Same frame, mono, no tag.
        expect(readAudioHeader(bytes([0xff, 0xfb, 0x94, 0xc0]))).toEqual({ sampleRate: 48_000, channels: 1 });
    });

    it("reads FLAC's STREAMINFO", () => {
        // 44100 Hz (0x0AC44), two channels, 16 bits.
        const flac = bytes("fLaC", [0, 0, 0, 34], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0x0a, 0xc4, 0x42], [0xf0, 0, 0, 0, 0]);
        expect(readAudioHeader(flac)).toEqual({ sampleRate: 44_100, channels: 2 });
    });

    it("reads Ogg Vorbis, and answers 48 kHz for Opus", () => {
        const vorbis = bytes("OggS", new Array(24).fill(0), "\u0001vorbis", u32(0), [2], u32(32_000));
        expect(readAudioHeader(vorbis)).toEqual({ sampleRate: 32_000, channels: 2 });
        const opus = bytes("OggS", new Array(24).fill(0), "OpusHead", [1, 2], u16(0), u32(44_100));
        expect(readAudioHeader(opus)).toEqual({ sampleRate: 48_000, channels: 2 });
    });

    it("has no answer for a container it does not read", () => {
        expect(readAudioHeader(bytes("\u0000\u0000\u0000 ftypM4A "))).toBeNull();
        expect(readAudioHeader(new Uint8Array(0))).toBeNull();
    });
});
