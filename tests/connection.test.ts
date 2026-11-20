import assert from 'node:assert/strict';
import {test} from 'node:test';
import {proxyHeaders, serverAddress, serverResource} from '../src/connection.ts';

const session = {serverUrl: 'https://host.example:8443/aurral/', token: 'fixture', customHeaders: {'X-API-Key': 'fixture-secret'}};
test('authenticated URLs preserve the configured server, port and proxy prefix', () => {
  assert.deepEqual(serverResource(session, '/api/playlists/jobs/mix'), {
    uri:'https://host.example:8443/aurral/api/playlists/jobs/mix',
    headers: {'X-API-Key':'fixture-secret', Authorization:'Bearer fixture'},
  });
  for (const route of ['https://other.example/song', '//other.example/song', '/api/../outside', '/api/x?redirect=abc']) {
    assert.throws(() => serverResource(session, route));
  }
});
test('connection settings reject malformed origins and conflicting HTTP credentials', () => {
  for (const value of ['example.test', 'file:///music', 'https://name:password@example.test', 'https://host/?token=s']) {
    assert.throws(() => serverAddress(value));
  }
  for (const headers of [{authorization:'custom'}, {foo:'hello\r\nother: payload'}, {'X-A':'1','x-a':'2'}]) {
    assert.throws(() => proxyHeaders(headers));
  }
});
