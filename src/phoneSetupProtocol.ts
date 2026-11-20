import nacl from 'tweetnacl';
import base64 from 'base64-js';
import { proxyHeaders, serverAddress, type Setup } from './connection.ts';

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

export function phoneSetupKeys(random: (bytes: Uint8Array) => Uint8Array) {
  const secret = random(new Uint8Array(nacl.box.secretKeyLength));
  const { publicKey, secretKey } = nacl.box.keyPair.fromSecretKey(secret);
  secret.fill(0);
  const id = hex(random(new Uint8Array(16)));
  const fingerprint = hex(nacl.hash(publicKey).slice(0, 6)).toUpperCase().match(/.{4}/g)!.join('-');
  return { id, privateKey: secretKey, publicKey, fingerprint };
}
type Keys = ReturnType<typeof phoneSetupKeys>;

export function phoneSetupLink(keys: Keys, address: string, port: number) {
  const encodedKey = base64.fromByteArray(keys.publicKey).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `aurralpocket://tv-pair?v=1&address=${address}&port=${port}&id=${keys.id}&key=${encodedKey}`;
}

export function openPhoneSetup(body: string, keys: Keys): Setup {
  if (body.length > 24 * 1024 || body.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/.test(body)) {
    throw new Error('Invalid envelope');
  }
  const bytes = base64.toByteArray(body.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - body.length % 4) % 4));
  const keyEnd = nacl.box.publicKeyLength;
  const nonceEnd = keyEnd + nacl.box.nonceLength;
  if (bytes.length <= nonceEnd + nacl.box.overheadLength) throw new Error('Invalid envelope');
  const peer = bytes.subarray(0, keyEnd);
  const shared = nacl.scalarMult(keys.privateKey, peer);
  const validPeer = shared.some(byte => byte !== 0);
  shared.fill(0);
  if (!validPeer) throw new Error('Invalid sender key');
  const plaintext = nacl.box.open(bytes.subarray(nonceEnd), bytes.subarray(keyEnd, nonceEnd), peer, keys.privateKey);
  if (!plaintext) throw new Error('Invalid envelope');
  try {
    const data = JSON.parse(new TextDecoder().decode(plaintext));
    if (data?.v !== 1 || data.id !== keys.id || typeof data.serverUrl !== 'string' ||
        typeof data.code !== 'string' || !/^[0-9A-HJKMNP-TV-Z]{10}$/.test(data.code)) {
      throw new Error('Invalid setup');
    }
    if (data.remoteKey !== undefined && (typeof data.remoteKey !== "string" || !/^[a-f0-9]{64}$/.test(data.remoteKey))) throw new Error("Invalid remote pairing");
    return { ...(data.remoteKey && {remoteKey: data.remoteKey}), serverUrl: serverAddress(data.serverUrl), code: data.code, customHeaders: proxyHeaders(data.customHeaders) };
  } finally {
    plaintext.fill(0);
  }
}
