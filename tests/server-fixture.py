"""Loopback-only Aurral API fixture for manual TV and Pocket-to-TV smoke tests."""
import argparse
import base64
import io
import json
import re
import secrets
import threading
import subprocess
from urllib.parse import urlsplit, parse_qs
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
    protocol_version = "HTTP/1.1"
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

    def transcode(self, params):
        if params.get("format") != ["mp3"] or params.get("maxBitRate") != ["320"]:
            self.send(400, {"error": "Expected MP3 at 320 kbps"})
            return
        try:
            offset = float(params.get("timeOffset", ["0"])[0])
            if not (0 <= offset < 40):
                raise ValueError()
        except ValueError:
            self.send(400, {"error": "Invalid time offset"})
            return
        self.send_response(200)
        self.send_header("Content-Type", "audio/mpeg")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        # Match Aurral's ffmpeg pipe rather than returning a rangeable test file.
        with subprocess.Popen(["ffmpeg", "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i",
                               "anullsrc=r=44100:cl=stereo", "-t", str(40 - offset),
                               "-c:a", "libmp3lame", "-b:a", "320k", "-f", "mp3", "pipe:1"],
                              stdout=subprocess.PIPE) as proc:
            try:
                while data := proc.stdout.read(16 * 1024):
                    self.wfile.write(f"{len(data):x}\r\n".encode() + data + b"\r\n")
                self.wfile.write(b"0\r\n\r\n")
            except (ConnectionResetError, BrokenPipeError):
                proc.terminate()
        print(f"GET {self.path} 200 audio/mpeg chunked", flush=True)

    def do_GET(self):
        if not self.allowed(tv):
            return
        url = urlsplit(self.path)
        if url.path == '/api/health/bootstrap':
            self.send(200, {'api': {'version': 2, 'features': ['streamTranscoding']}})
        elif url.path == '/api/auth/me':
            self.send(200, {'user': {'id': 1, 'username': 'fixture'}, 'expiresAt': 4000000000000})
        elif url.path == '/api/playlists/status':
            self.send(200, {'staticPlaylists': [{'id': 'mix', 'name': 'After Hours'}],
                            'flows': [{'id': 'flow', 'name': 'Weekly Flow'}]})
        elif self.path.startswith('/api/playlists/jobs/'):
            self.send(200, [{'id': 't1', 'trackName': 'Signal', 'artistName': 'Fixture', 'albumName': 'Test pressing', 'durationMs': 40000, 'streamFormat': 'flac', 'status': 'done'},
                            {'id': 't2', 'trackName': 'Night Drive', 'artistName': 'Fixture', 'status': 'done'},
                            {'id': 't3', 'trackName': 'Missing track', 'artistName': 'Fixture', 'status': 'saved'}])
        elif self.path.startswith('/api/playlists/artwork/'):
            self.send(200, cover, 'image/png')
        elif url.path.startswith(('/api/playlists/stream/', '/api/library/stream/')):
            if url.query:
                self.transcode(parse_qs(url.query))
                return
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
