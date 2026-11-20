import nacl from 'tweetnacl';
import base64 from 'base64-js';

function keyBytes(key: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid TV key');
  return Uint8Array.from(key.match(/../g)!, (hex) => parseInt(hex, 16));
}

export function sealRemote(value: object, key: string, random: (bytes: Uint8Array) => Uint8Array) {
  const nonce = random(new Uint8Array(nacl.secretbox.nonceLength));
  const contents = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = nacl.secretbox(contents, nonce, keyBytes(key));
  const bytes = new Uint8Array(nonce.length + encrypted.length);
  bytes.set(nonce);
  bytes.set(encrypted, nonce.length);
  const text = base64.fromByteArray(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (text.length > 131072) throw new Error('TV queue is too large');
  return text;
}

export function openRemote(text: string, key: string): unknown {
  if (
    typeof text !== 'string' ||
    text.length < 55 ||
    text.length > 131072 ||
    !/^[A-Za-z0-9_-]+$/.test(text)
  ) {
    throw new Error('Invalid TV message');
  }
  const bytes = base64.toByteArray(
    text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4),
  );
  const n = nacl.secretbox.nonceLength;
  const contents = nacl.secretbox.open(bytes.subarray(n), bytes.subarray(0, n), keyBytes(key));
  if (!contents) throw new Error('Invalid TV message');
  return JSON.parse(new TextDecoder().decode(contents));
}
