
export async function generateKeyPair(): Promise<CryptoKeyPair> {
    return crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true, 
        ['deriveKey', 'deriveBits']
    );
}

export async function exportPublicKey(key: CryptoKey): Promise<JsonWebKey> {
    return crypto.subtle.exportKey('jwk', key);
}

export async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        []
    );
}

export async function deriveSharedKey(
    privateKey: CryptoKey,
    peerPublicKey: CryptoKey
): Promise<CryptoKey> {
    return crypto.subtle.deriveKey(
        { name: 'ECDH', public: peerPublicKey },
        privateKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

export async function encryptMessage(
    sharedKey: CryptoKey,
    plaintext: string
): Promise<{ iv: string; ciphertext: string }> {
    const iv = crypto.getRandomValues(new Uint8Array(12)); 
    const encoded = new TextEncoder().encode(plaintext);

    const ciphertextBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        sharedKey,
        encoded
    );

    return {
        iv: bufferToBase64(iv),
        ciphertext: bufferToBase64(new Uint8Array(ciphertextBuffer))
    };
}

export async function decryptMessage(
    sharedKey: CryptoKey,
    iv: string,
    ciphertext: string
): Promise<string> {
    const ivBuffer = base64ToBuffer(iv);
    const ciphertextBuffer = base64ToBuffer(ciphertext);

    const decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBuffer as BufferSource },
        sharedKey,
        ciphertextBuffer as BufferSource
    );

    return new TextDecoder().decode(decryptedBuffer);
}

function bufferToBase64(buffer: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < buffer.byteLength; i++) {
        binary += String.fromCharCode(buffer[i]);
    }
    return btoa(binary);
}

function base64ToBuffer(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

// ---------------------------------------------------------------- identity

import { metaGet, metaSet } from './utils/db';

const IDENTITY_KEY = 'identity_keypair_v1';

/**
 * The long-term identity key.
 *
 * Key pairs used to be generated fresh on every launch, which meant there was
 * nothing stable to verify: a peer could not tell "same person as yesterday"
 * from "someone new on the same id". The pair is now generated once and kept in
 * IndexedDB, which can store CryptoKey objects directly, so the private key
 * never has to be serialised. It is created non-extractable, so even this app
 * cannot read it back out.
 */
export async function loadOrCreateIdentityKeyPair(): Promise<CryptoKeyPair> {
    const existing = await metaGet<CryptoKeyPair>(IDENTITY_KEY);
    if (existing && existing.privateKey && existing.publicKey) return existing;

    const pair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        // For a key pair this flag applies to the private key; the public key is
        // always extractable, which is all we need to publish.
        false,
        ['deriveKey', 'deriveBits']
    ) as CryptoKeyPair;

    await metaSet(IDENTITY_KEY, pair);
    return pair;
}

const toHex = (bytes: Uint8Array): string =>
    [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');

/** Canonical byte form of a public key, used for every fingerprint below. */
async function rawPublicKey(key: CryptoKey): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.exportKey('raw', key));
}

const groupHex = (hex: string, groups: number, size: number): string => {
    const out: string[] = [];
    for (let i = 0; i < groups; i++) out.push(hex.slice(i * size, (i + 1) * size).toUpperCase());
    return out.join(' ');
};

/**
 * A short digest of one public key. Used for trust-on-first-use: if a peer's
 * fingerprint changes, either they reinstalled or someone is impersonating them.
 */
export async function keyFingerprint(key: CryptoKey): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', await rawPublicKey(key) as BufferSource);
    return toHex(new Uint8Array(digest));
}

/**
 * The number both sides read aloud to confirm nobody is in the middle. Derived
 * from both public keys, sorted so each side computes the same value.
 */
export async function safetyNumber(a: CryptoKey, b: CryptoKey): Promise<string> {
    const [rawA, rawB] = await Promise.all([rawPublicKey(a), rawPublicKey(b)]);
    const hexA = toHex(rawA);
    const hexB = toHex(rawB);
    const combined = hexA < hexB ? hexA + hexB : hexB + hexA;
    const encoded = new TextEncoder().encode(combined);
    const digest = await crypto.subtle.digest('SHA-256', encoded as BufferSource);
    return groupHex(toHex(new Uint8Array(digest)), 8, 4);
}
