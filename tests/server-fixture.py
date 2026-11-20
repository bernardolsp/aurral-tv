"""Loopback-only Aurral API fixture for manual TV and Pocket-to-TV smoke tests."""
import argparse
import base64
import io
import json
import re
import secrets
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, default=0)
args = parser.parse_args()
proxy_headers = {'X-Aurral-Test-ID': 'tv-demo', 'X-Aurral-Test-Secret': 'fixture-only'}
mobile = 'Bearer fixture-mobile'
tv = 'Bearer fixture-tv'
codes = set()
lock = threading.Lock()
pcm = io.BytesIO()
with wave.open(pcm, 'wb') as out:
    out.setparams((1, 2, 16000, 0, 'NONE', ''))
    out.writeframes(bytes(16000 * 2 * 40))
audio = pcm.getvalue()
cover = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jOJkAAAAASUVORK5CYII=')


class Fixture(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def send(self, status, content, mime='application/json', extra=None):
        data = content if isinstance(content, bytes) else json.dumps(content).encode()
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        for name, value in (extra or {}).items():
            self.send_header(name, value)
        self.end_headers()
        try:
            self.wfile.write(data)
        except (ConnectionResetError, BrokenPipeError):
            pass
        print(f'{self.command} {self.path} {status}', flush=True)

    def allowed(self, auth):
        if any(self.headers.get(k) != v for k, v in proxy_headers.items()):
            self.send(403, {'error': 'Missing fixture proxy headers'})
            return False
        if self.headers.get('Authorization') != auth:
            self.send(401, {'error': 'Unexpected fixture session'})
            return False
        return True

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0'))) or '{}')
        if self.path == '/api/auth/pairing-codes' and self.allowed(mobile):
            code = secrets.token_hex(5).upper()
            with lock:
                codes.add(code)
            self.send(201, {'code': code, 'expiresAt': 4000000000000})
        elif self.path == '/api/auth/pair' and self.allowed(None):
            with lock:
                valid = body.get('code') in codes
                codes.discard(body.get('code'))
            self.send(200 if valid else 401, {'token': 'fixture-tv'} if valid else {'error': 'Code expired'})
        elif self.path == '/api/auth/logout' and self.allowed(tv):
            self.send(200, {'success': True})

    def do_GET(self):
        if not self.allowed(tv):
            return
        if self.path == '/api/playlists/status':
            self.send(200, {'staticPlaylists': [{'id': 'mix', 'name': 'After Hours'}],
                            'flows': [{'id': 'flow', 'name': 'Weekly Flow'}]})
        elif self.path.startswith('/api/playlists/jobs/'):
            self.send(200, [{'id': 't1', 'trackName': 'Signal', 'artistName': 'Fixture', 'status': 'done'},
                            {'id': 't2', 'trackName': 'Night Drive', 'artistName': 'Fixture', 'status': 'done'},
                            {'id': 't3', 'trackName': 'Missing track', 'artistName': 'Fixture', 'status': 'saved'}])
        elif self.path.startswith('/api/playlists/artwork/'):
            self.send(200, cover, 'image/png')
        elif self.path.startswith('/api/playlists/stream/'):
            match = re.fullmatch(r'bytes=(\d+)-', self.headers.get('Range', ''))
            if match:
                offset = int(match[1])
                if offset >= len(audio):
                    self.send(416, b'', 'audio/wav')
                    return
                self.send(206, audio[offset:], 'audio/wav', {'Content-Range': f'bytes {offset}-{len(audio)-1}/{len(audio)}'})
            else:
                self.send(200, audio, 'audio/wav')
        else:
            self.send(404, {})


server = ThreadingHTTPServer(('127.0.0.1', args.port), Fixture)
print(f'Fixture listening on 127.0.0.1:{server.server_port}', flush=True)
server.serve_forever()
