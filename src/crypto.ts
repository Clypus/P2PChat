/**
 * E2E Encryption utilities using Web Crypto API
 * - ECDH for key exchange (P-256 curve)
 * - AES-256-GCM for message encryption/decryption
 */

// Generate an ECDH key pair for this session
export async function generateKeyPair(): Promise<CryptoKeyPair> {
    return crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true, // extractable (so we can export the public key)
        ['deriveKey', 'deriveBits']
    );
}

// Export public key to a transferable JWK format
export async function exportPublicKey(key: CryptoKey): Promise<JsonWebKey> {
    return crypto.subtle.exportKey('jwk', key);
}

// Import a peer's public key from JWK
export async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        []
    );
}

// Derive a shared AES-GCM key from our private key + peer's public key
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

// Encrypt a message string with AES-256-GCM
export async function encryptMessage(
    sharedKey: CryptoKey,
    plaintext: string
): Promise<{ iv: string; ciphertext: string }> {
    const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV
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

// Decrypt a message with AES-256-GCM
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

// --- Helper functions ---
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
