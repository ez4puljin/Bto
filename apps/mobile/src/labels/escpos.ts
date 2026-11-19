// The ESC/POS bytes the server draws (`POST /price-labels/escpos`, base64) reach a Bluetooth
// printer in small pieces: a cheap printer's buffer is a few KB and drops what it cannot hold.

export const CHUNK_BYTES = 512;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** The bytes of a base64 text (no `atob`/`Buffer` needed: Hermes and Node differ); null if it is not base64. */
export function bytesOfBase64(base64: string): Uint8Array | null {
  const clean = base64.replace(/\s+/g, '').replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]*$/.test(clean) || clean.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let at = 0;
  for (const char of clean) {
    acc = (acc << 6) | ALPHABET.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at] = (acc >> bits) & 0xff;
      at += 1;
    }
  }
  return out;
}

/** The bytes cut into pieces of at most `size`, in order, none empty. */
export function chunksOf(bytes: Uint8Array, size = CHUNK_BYTES): Uint8Array[] {
  const pieces: Uint8Array[] = [];
  for (let from = 0; from < bytes.length; from += size) {
    pieces.push(bytes.subarray(from, from + size));
  }
  return pieces;
}

/** One byte per character (code 0–255), the form a native bridge takes as «binary». */
export function binaryString(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}
