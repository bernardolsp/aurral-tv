import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import nacl from 'tweetnacl';
import { openPhoneSetup, phoneSetupKeys, phoneSetupLink } from '../src/phoneSetupProtocol.ts';

const keys = () => phoneSetupKeys(bytes => { bytes.set(randomBytes(bytes.length)); return bytes; });
type Keys = ReturnType<typeof keys>;
const setup = { serverUrl: 'https://aurral.example/music', code: 'ABCDEFGHJK', customHeaders: { 'X-API-Key': 'test proxy credential', Cookie: 'proxy_session=test' } };
function envelope(tv: Keys, fields: object = {}) {
  const sender = nacl.box.keyPair.fromSecretKey(randomBytes(32));
  const nonce = randomBytes(24);
  const clear = Buffer.from(JSON.stringify({ v: 1, id: tv.id, ...setup, ...fields }));
  return Buffer.concat([sender.publicKey, nonce, nacl.box(clear, nonce, tv.publicKey, sender.secretKey)]).toString('base64url');
}

test('the QR has only public invitation data and a fingerprint matching standard SHA-512', () => {
  const tv = keys();
  const url = new URL(phoneSetupLink(tv, '192.168.1.8', 14000));
  assert.equal(url.protocol, 'aurralpocket:');
  assert.equal(url.host, 'tv-pair');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['address','id','key','port','v']);
  assert.equal(url.searchParams.get('key'), Buffer.from(tv.publicKey).toString('base64url'));
  const short = createHash('sha512').update(tv.publicKey).digest('hex').slice(0,12).toUpperCase();
  assert.equal(tv.fingerprint, short.match(/.{4}/g)!.join('-'));
  const sealed = envelope(tv);
  assert.deepEqual(JSON.parse(JSON.stringify(openPhoneSetup(sealed, tv))), setup);
  assert.throws(() => openPhoneSetup(sealed, keys()));
  assert.throws(() => openPhoneSetup(envelope(tv, {id: keys().id}), tv));
  const changed = Buffer.from(sealed, 'base64url');
  changed[changed.length - 1] ^= 5;
  assert.throws(() => openPhoneSetup(changed.toString('base64url'), tv));
  changed.fill(0, 0, 32);
  assert.throws(() => openPhoneSetup(changed.toString('base64url'), tv));
});

test('the TV rejects malformed or oversized setup data', () => {
  const tv = keys();
  for (const fields of [{ v: 2 }, { code: 'short' }, { serverUrl: 'https://name:pass@server.test' },
    { customHeaders: { test: 'bad\nvalue' } }, { customHeaders: { Authorization: 'protected' } }]) {
    assert.throws(() => openPhoneSetup(envelope(tv, fields), tv));
  }
  assert.throws(() => openPhoneSetup('Z'.repeat(24577), tv));
});

test('native HTTP inbox acknowledges a decrypted transfer once, rejects unrelated requests, and expires', { timeout: 25000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'aurral-inbox-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const javaBin = (tool: string) => process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', tool) : tool;
  if (spawnSync(javaBin('javac'), ['-version']).status !== 0) {
    t.skip('Set JAVA_HOME to a JDK to run the native socket test.');
    return;
  }
  execFileSync(javaBin('javac'), ['-d', dir, 'modules/phone-setup/android/src/main/java/com/aurral/tv/setup/LanInbox.java', 'tests/fixtures/InboxFixture.java']);
  async function launch(tv: Keys, timeout = 5000) {
    const child = spawn(javaBin('java'), ['-cp', dir, 'com.aurral.tv.setup.InboxFixture', tv.id, String(timeout)]);
    let diagnostic = '';
    child.stderr.on('data', chunk => { diagnostic += chunk.toString(); });
    const done = once(child, 'exit');
    t.after(() => child.kill());
    const lines = createInterface({input: child.stdout})[Symbol.asyncIterator]();
    const port = (await lines.next()).value;
    assert.match(String(port), /^\d+$/, diagnostic);
    const url = `http://127.0.0.1:${port}/v1/setup/${tv.id}`;
    const post = (body: string, path = url, type = 'application/octet-stream') =>
      fetch(path, {method: 'POST', headers: {'Content-Type': type}, body});
    return { child, lines, done, url, post };
  }
  const tv = keys();
  const listener = await launch(tv);
  const sealed = envelope(tv);
  assert.equal((await listener.post(sealed, listener.url + '/other')).status, 400);
  assert.equal((await listener.post(sealed, listener.url, 'text/plain')).status, 400);
  const wrongKey = listener.post(envelope(keys()));
  const wrongBody = (await listener.lines.next()).value!;
  assert.throws(() => openPhoneSetup(wrongBody, tv));
  listener.child.stdin.write('rejected\n');
  assert.equal((await wrongKey).status, 400);
  const accepted = listener.post(sealed);
  const received = (await listener.lines.next()).value!;
  assert.deepEqual(JSON.parse(JSON.stringify(openPhoneSetup(received, tv))), setup);
  listener.child.stdin.write('accepted\n');
  assert.equal((await accepted).status, 204);
  assert.equal((await listener.done)[0], 0);
  await assert.rejects(listener.post(sealed));

  const limited = await launch(keys());
  for (let n = 0; n < 8; n++) assert.equal((await limited.post('bad')).status, 400);
  assert.equal((await limited.done)[0], 0);
  await assert.rejects(limited.post(sealed));
  const expired = await launch(keys(), 100);
  assert.equal((await expired.done)[0], 0);
  await assert.rejects(expired.post(sealed));
});
