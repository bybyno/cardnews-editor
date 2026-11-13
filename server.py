"""카드뉴스 편집기 로컬 서버

- 정적 파일(index.html 등) 제공
- /proxy?url=...  : 브라우저가 직접 못 가져오는(CORS) 검색 API 응답과 인터넷 이미지를 대신 받아 전달
- /api/ig-*      : 인스타 게시물 사진을 '받은 포스트' 폴더에 내려받고 캡션 저장
이 컴퓨터(127.0.0.1)에서만 접속할 수 있습니다.
"""
import base64
import http.cookiejar
import http.server
import io
import json
import threading
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get('PORT') or 5178)
MAX_BYTES = 30 * 1024 * 1024
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/130.0 Safari/537.36')


class Handler(http.server.SimpleHTTPRequestHandler):
    def _local_only(self):
        host = (self.headers.get('Host') or '').split(':')[0]
        origin = self.headers.get('Origin')
        if host not in ('127.0.0.1', 'localhost'):
            return False
        if origin and urllib.parse.urlsplit(origin).hostname not in ('127.0.0.1', 'localhost'):
            return False
        return True

    def end_headers(self):
        # 앱 파일을 고친 뒤 새로고침하면 항상 최신 파일을 받도록 (브라우저 캐시 방지)
        if not self.path.startswith('/proxy'):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def _send_index(self):
        # index.html 안의 js/css 주소 뒤에 파일 수정 시각(?v=...)을 붙여서
        # 파일이 바뀌면 브라우저가 무조건 새 파일을 받게 함 (예전 파일 캐시 문제 방지)
        with open('index.html', encoding='utf-8') as f:
            html = f.read()

        def add_ver(m):
            path = m.group(2)
            try:
                ver = int(os.path.getmtime(path))
            except OSError:
                return m.group(0)
            return f'{m.group(1)}="{path}?v={ver}"'
        html = re.sub(r'(src|href)="((?:js|css)/[^"?]+)"', add_ver, html)
        self._send(200, html.encode('utf-8'), 'text/html; charset=utf-8')

    def do_GET(self):
        if urllib.parse.urlsplit(self.path).path in ('/', '/index.html'):
            return self._send_index()
        if self.path == '/proxy-ping':
            return self._send(200, b'ok', 'text/plain')
        if self.path.startswith('/proxy?'):
            return self._proxy('GET')
        if self.path.startswith('/api/'):
            return self._api('GET')
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith('/proxy?'):
            return self._proxy('POST')
        if self.path.startswith('/api/'):
            return self._api('POST')
        self.send_error(405)

    def _send(self, status, data, ctype):
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def _proxy(self, method):
        if not self._local_only():
            return self.send_error(403)
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        url = query.get('url', [''])[0]
        if not url.startswith(('http://', 'https://')):
            return self.send_error(400, 'bad url')
        parts = urllib.parse.urlsplit(url)
        headers = {
            'User-Agent': UA,
            'Accept': self.headers.get('Accept') or '*/*',
            'Referer': f'{parts.scheme}://{parts.netloc}/',
        }
        if query.get('noref', [''])[0] == '1':
            headers.pop('Referer', None)
        if self.headers.get('Authorization'):
            headers['Authorization'] = self.headers['Authorization']
        # 'X-Fwd-이름' 헤더는 '이름'으로 바꿔서 그대로 전달 (핀터레스트 등)
        for k, v in self.headers.items():
            if k.lower().startswith('x-fwd-') and len(k) > 6:
                headers[k[6:]] = v
        body = None
        if method == 'POST':
            n = int(self.headers.get('Content-Length') or 0)
            body = self.rfile.read(n)
            if self.headers.get('Content-Type'):
                headers['Content-Type'] = self.headers['Content-Type']
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                data = r.read(MAX_BYTES + 1)
                status, ctype = r.status, r.headers.get('Content-Type', 'application/octet-stream')
        except urllib.error.HTTPError as e:
            data, status, ctype = e.read(MAX_BYTES + 1), e.code, e.headers.get('Content-Type', 'text/plain')
        except Exception as e:  # 네트워크 오류 등
            return self._send(502, f'proxy error: {e}'.encode('utf-8', 'replace'), 'text/plain; charset=utf-8')
        if len(data) > MAX_BYTES:
            return self._send(413, b'too large', 'text/plain')
        self._send(status, data, ctype)

    def log_message(self, fmt, *args):
        if '/proxy' not in (str(args[0]) if args else ''):
            super().log_message(fmt, *args)

    def _project_save(self, data):
        name = clean_project_name(data.get('name'))
        if not name:
            return self._json(400, {'error': '프로젝트 이름을 적어주세요'})
        path = project_path(name)
        if os.path.exists(path) and not data.get('overwrite'):
            return self._json(409, {'exists': True, 'name': name})
        os.makedirs(PROJECT_DIR, exist_ok=True)
        tmp = path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data.get('data') or {}, f, ensure_ascii=False)
        os.replace(tmp, path)   # 저장 도중 끊겨도 기존 파일이 깨지지 않게
        with open(path[:-len(PROJECT_EXT)] + '.thumb.txt', 'w', encoding='utf-8') as f:
            f.write(str(data.get('thumb') or ''))
        return self._json(200, {'name': name, 'path': os.path.abspath(path), 'folder': os.path.abspath(PROJECT_DIR)})

    # ----- 인스타그램 게시물 가져오기 -----
    def _read_json(self):
        n = int(self.headers.get('Content-Length') or 0)
        return json.loads(self.rfile.read(n).decode('utf-8') or '{}')

    def _json(self, status, obj):
        self._send(status, json.dumps(obj, ensure_ascii=False).encode('utf-8'), 'application/json; charset=utf-8')

    def _api(self, method):
        if not self._local_only():
            return self.send_error(403)
        route = urllib.parse.urlsplit(self.path).path
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        try:
            if route == '/api/ping':
                return self._json(200, {'version': SERVER_VERSION})
            if route == '/api/update-check' and method == 'GET':
                return self._json(200, update_check())
            if route == '/api/update-apply' and method == 'POST':
                res = update_apply()
                self._json(200, res)
                if res.get('restart'):
                    # start.bat 이 종료 코드 3을 보면 서버를 다시 켬 (새 server.py 로)
                    threading.Timer(0.8, lambda: os._exit(3)).start()
                return
            if route == '/api/ig-fetch' and method == 'GET':
                # 링크만으로 시도 (로그인 없이) — 인스타가 막으면 실패
                url = query.get('url', [''])[0]
                code = ig_shortcode(url)
                if not code:
                    return self._json(400, {'error': '인스타 게시물 링크가 아니에요 (instagram.com/p/... 형식)'})
                post = ig_public_post(code)
                return self._json(200, save_post(post))
            if route == '/api/ig-save' and method == 'POST':
                # 북마클릿이 (로그인된 인스타 화면에서) 읽어 보낸 게시물 정보를 받아 사진 저장
                return self._json(200, save_post(self._read_json()))
            if route == '/api/open-folder' and method == 'GET':
                absp = query.get('abs', [''])[0]
                if absp:   # 내보내기로 만든 폴더 열기
                    target = os.path.abspath(absp)
                    if not os.path.isdir(target):
                        return self._json(400, {'error': '폴더가 없어요'})
                    os.startfile(target)
                    return self._json(200, {'ok': True})
                rel = query.get('path', [''])[0]
                target = os.path.abspath(os.path.join(SAVE_ROOT, rel))
                if not target.startswith(os.path.abspath(SAVE_ROOT)) or not os.path.isdir(target):
                    return self._json(400, {'error': '폴더가 없어요'})
                os.startfile(target)
                return self._json(200, {'ok': True})
            if route == '/api/cutout' and method == 'POST':
                # 누끼 따기 (배경 제거) — 내 컴퓨터에서 AI 모델로 처리, 무료
                data = self._read_json()
                return self._json(200, {'image': cutout(data.get('image', ''), data.get('model') or 'birefnet-general')})
            if route == '/api/project-save' and method == 'POST':
                return self._project_save(self._read_json())
            if route == '/api/project-list' and method == 'GET':
                return self._json(200, project_list())
            if route == '/api/project-load' and method == 'GET':
                path = project_path(query.get('name', [''])[0])
                if not os.path.isfile(path):
                    return self._json(404, {'error': '프로젝트를 찾지 못했어요'})
                with open(path, 'rb') as f:
                    return self._send(200, f.read(), 'application/json; charset=utf-8')
            if route == '/api/make-share' and method == 'POST':
                # 다른 사람에게 줄 압축파일 만들기 (원하면 내 API 키를 넣은 설정 파일 포함)
                res = make_share(self._read_json())
                os.startfile(os.path.dirname(res['path']))
                return self._json(200, res)
            if route == '/api/save-export' and method == 'POST':
                # 완성된 카드 이미지를 '저장 폴더\오늘날짜(번호)\01.jpg …' 로 저장
                return self._json(200, save_export(self._read_json()))
        except IgError as e:
            return self._json(502, {'error': str(e)})
        except Exception as e:
            return self._json(500, {'error': f'처리 중 오류: {e}'})
        return self._json(404, {'error': 'unknown api'})


SERVER_VERSION = 9  # 편집기(js/search.js의 NEED_SERVER)와 맞춰서 올림 — 낮으면 편집기가 재시작 안내
SAVE_ROOT = '받은 포스트'   # 인스타에서 받은 사진·캡션 저장 폴더 (편집기 폴더 안)
IG_APP_ID = '936619743392459'
IMG_HOSTS = ('cdninstagram.com', 'fbcdn.net')


class IgError(Exception):
    pass


def ig_shortcode(url):
    m = re.search(r'instagram\.com/(?:[^/?#]+/)?(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)', url or '')
    return m.group(1) if m else None


def ig_public_post(code):
    """로그인 없이 게시물 정보 읽기. 인스타가 로그인을 요구하면 IgError."""
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    base = {'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9'}
    with op.open(urllib.request.Request(f'https://www.instagram.com/p/{code}/', headers={**base, 'Accept': 'text/html'}), timeout=30) as r:
        html = r.read().decode('utf-8', 'replace')
    csrf = next((c.value for c in cj if c.name == 'csrftoken'), '')
    lsd = re.search(r'"LSD",\[\],\{"token":"([^"]+)"', html)
    form = {'variables': json.dumps({'shortcode': code, 'fetch_tagged_user_count': None,
                                     'hoisted_comment_id': None, 'hoisted_reply_id': None}),
            'doc_id': '8845758582119845'}
    hdr = {**base, 'Accept': '*/*', 'X-IG-App-ID': IG_APP_ID, 'Content-Type': 'application/x-www-form-urlencoded',
           'X-FB-Friendly-Name': 'PolarisPostActionLoadPostQueryQuery', 'Origin': 'https://www.instagram.com',
           'Referer': f'https://www.instagram.com/p/{code}/', 'X-CSRFToken': csrf}
    if lsd:
        form['lsd'] = lsd.group(1)
        hdr['X-FB-LSD'] = lsd.group(1)
    req = urllib.request.Request('https://www.instagram.com/graphql/query', data=urllib.parse.urlencode(form).encode(), headers=hdr)
    try:
        with op.open(req, timeout=30) as r:
            data = json.loads(r.read().decode('utf-8', 'replace'))
    except urllib.error.HTTPError as e:
        raise IgError('인스타그램이 로그인 없이 읽는 걸 막았어요. "카드뉴스로 보내기" 북마크 버튼을 써주세요.') from e
    except ValueError as e:
        raise IgError('인스타그램 응답을 읽지 못했어요. 북마크 버튼을 써주세요.') from e
    m = (data.get('data') or {}).get('xdt_shortcode_media')
    if not m:
        raise IgError('게시물을 찾지 못했어요 (비공개이거나 인스타가 막음). 북마크 버튼을 써주세요.')
    kids = ((m.get('edge_sidecar_to_children') or {}).get('edges')) or [{'node': m}]
    cap = (m.get('edge_media_to_caption') or {}).get('edges') or []
    return {
        'code': code, 'user': (m.get('owner') or {}).get('username', ''),
        'caption': cap[0]['node']['text'] if cap else '',
        'link': f'https://www.instagram.com/p/{code}/',
        'media': [{'url': k['node']['display_url'], 'video': bool(k['node'].get('is_video'))} for k in kids],
    }


PROJECT_DIR = '프로젝트'   # 편집기 폴더 안: 이름 붙여 저장한 카드뉴스 프로젝트 모음
PROJECT_EXT = '.cardnews.json'


def clean_project_name(name):
    name = re.sub(r'[\\/:*?"<>|\r\n\t]', ' ', str(name or '')).strip().strip('.')
    return re.sub(r'\s+', ' ', name)[:80]


def project_path(name):
    return os.path.join(PROJECT_DIR, clean_project_name(name) + PROJECT_EXT)


def project_list():
    items = []
    if os.path.isdir(PROJECT_DIR):
        for fn in os.listdir(PROJECT_DIR):
            if not fn.endswith(PROJECT_EXT):
                continue
            p = os.path.join(PROJECT_DIR, fn)
            name = fn[:-len(PROJECT_EXT)]
            thumb = ''
            tp = os.path.join(PROJECT_DIR, name + '.thumb.txt')
            if os.path.isfile(tp):
                with open(tp, encoding='utf-8') as f:
                    thumb = f.read()
            items.append({'name': name, 'mtime': os.path.getmtime(p), 'size': os.path.getsize(p), 'thumb': thumb})
    items.sort(key=lambda x: x['mtime'], reverse=True)
    return {'folder': os.path.abspath(PROJECT_DIR), 'items': items}


CUTOUT_MODELS =('birefnet-general', 'birefnet-portrait', 'isnet-general-use')
_cutout_sessions = {}
_cutout_lock = threading.Lock()


def cutout(data_url, model):
    """사진 배경을 지워 투명 PNG(data URL)로 돌려줌. 모델은 처음 한 번 내려받고 메모리에 유지."""
    if model not in CUTOUT_MODELS:
        model = CUTOUT_MODELS[0]
    try:
        from rembg import new_session, remove   # 무거워서 처음 쓸 때만 불러옴
        from PIL import Image
    except ImportError as e:
        raise IgError('누끼 기능 설치가 필요해요: 명령 프롬프트에서  python -m pip install "rembg[cpu]"') from e
    _, _, b64 = str(data_url).partition(',')
    src = Image.open(io.BytesIO(base64.b64decode(b64)))
    src.load()
    with _cutout_lock:   # 한 번에 하나씩 (CPU를 많이 씀)
        if model not in _cutout_sessions:
            _cutout_sessions[model] = new_session(model)
        out = remove(src.convert('RGB'), session=_cutout_sessions[model])
    buf = io.BytesIO()
    out.save(buf, 'PNG', optimize=False)
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode('ascii')


# ----- 깃허브 자동 업데이트 -----
# update.json: {"repo": "계정/저장소", "branch": "main"} / version.json: {"version": "2026.11.10.1530"}
# 원본 폴더(.git 있음)는 업데이트하지 않음. 업데이트해도 키·프로젝트·받은 포스트는 건드리지 않음.
# start.bat/설치.bat 은 실행 중에 바꾸면 깨질 수 있어서 자동 업데이트에서 제외
UPDATE_KEEP = ('shared_config.json', 'hub_config.json', '공유함_구글스크립트.txt', '프로젝트/', '받은 포스트/', '.git/', '.claude/', 'start.bat', '설치.bat')


def _read_json_file(path, default=None):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _ver_tuple(v):
    return tuple(int(x) for x in re.findall(r'\d+', str(v or '0')))


def update_check():
    cfg = _read_json_file('update.json', {}) or {}
    cur = (_read_json_file('version.json', {}) or {}).get('version', '0')
    repo, branch = cfg.get('repo'), cfg.get('branch', 'main')
    out = {'current': cur, 'repo': repo, 'dev': os.path.isdir('.git')}
    if not repo:
        return {**out, 'available': False, 'error': '업데이트 저장소가 설정되지 않았어요'}
    url = f'https://raw.githubusercontent.com/{repo}/{branch}/version.json?t={int(datetime.now().timestamp())}'
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA, 'Cache-Control': 'no-cache'}), timeout=15) as r:
            remote = json.loads(r.read().decode('utf-8'))
    except Exception as e:
        return {**out, 'available': False, 'error': f'업데이트 확인 실패: {e}'}
    latest = remote.get('version', '0')
    return {**out, 'latest': latest, 'notes': remote.get('notes', ''),
            'available': not out['dev'] and _ver_tuple(latest) > _ver_tuple(cur)}


def update_apply():
    info = update_check()
    if info.get('dev'):
        raise IgError('원본(개발) 폴더는 자동 업데이트하지 않아요')
    if not info.get('available'):
        return {'updated': False, 'current': info.get('current'), 'message': '이미 최신 버전이에요'}
    cfg = _read_json_file('update.json', {})
    url = f"https://codeload.github.com/{cfg['repo']}/zip/refs/heads/{cfg.get('branch', 'main')}"
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=60) as r:
        data = r.read()
    root = os.path.abspath('.')
    changed = []
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for m in z.infolist():
            if m.is_dir():
                continue
            rel = m.filename.split('/', 1)[1] if '/' in m.filename else ''   # 맨 앞 '저장소-main/' 떼기
            if not rel or any(rel == k or rel.startswith(k) for k in UPDATE_KEEP):
                continue
            dest = os.path.abspath(os.path.join(root, rel))
            if not dest.startswith(root + os.sep):
                continue   # 폴더 밖으로 나가는 경로 방지
            new = z.read(m)
            if os.path.isfile(dest):
                with open(dest, 'rb') as f:
                    if f.read() == new:
                        continue
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest + '.tmp', 'wb') as f:
                f.write(new)
            os.replace(dest + '.tmp', dest)
            changed.append(rel)
    restart = 'server.py' in changed
    return {'updated': True, 'version': info['latest'], 'changed': len(changed), 'restart': restart}


def _default_export_root():
    # 자동 업로드 프로그램이 있으면 그 업로드폴더, 없으면 문서\카드뉴스 저장
    docs = os.path.join(os.path.expanduser('~'), 'Documents')
    uploader = os.path.join(docs, 'insta_auto_upload')
    return os.path.join(uploader, '업로드폴더') if os.path.isdir(uploader) else os.path.join(docs, '카드뉴스 저장')


DEFAULT_EXPORT_ROOT = _default_export_root()

SHARE_EXCLUDE_DIRS = {'받은 포스트', '프로젝트', '.claude', '__pycache__', '.git'}
SHARE_KEYS = ('apiKey', 'serpApiKey', 'tmdbKey', 'model', 'prompt')
# 공유 압축파일에 넣지 않는 파일 (내 키·관리자 코드)
SHARE_EXCLUDE_FILES = {'shared_config.json', 'hub_config.json', '공유함_구글스크립트.txt'}


def make_share(data):
    """편집기 폴더를 '카드뉴스편집기_공유_날짜.zip' 으로 (편집기 폴더 옆에). 받은 포스트·프로젝트는 제외."""
    root = os.path.abspath('.')
    out = os.path.join(os.path.dirname(root), f'카드뉴스편집기_공유_{datetime.now().strftime("%m%d_%H%M")}.zip')
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for dp, dns, fns in os.walk(root):
            dns[:] = [d for d in dns if d not in SHARE_EXCLUDE_DIRS]
            for fn in fns:
                if fn in SHARE_EXCLUDE_FILES or fn.endswith(('.tmp', '.zip', '.pyc')):
                    continue
                full = os.path.join(dp, fn)
                z.write(full, os.path.join('카드뉴스편집기', os.path.relpath(full, root)))
        cfg = {}
        if data.get('includeKeys'):
            cfg = {k: str(v) for k, v in (data.get('config') or {}).items() if k in SHARE_KEYS and v}
        # 구글 드라이브 공유함: 받은 사람도 📤 업로드 할 수 있게 주소와 '업로드 코드'만 (관리자 코드는 절대 안 넣음)
        hub = _read_json_file('hub_config.json', {}) or {}
        if hub.get('hubUrl') and hub.get('hubKey'):
            cfg['hubUrl'], cfg['hubKey'] = hub['hubUrl'], hub['hubKey']
        if cfg:
            z.writestr('카드뉴스편집기/shared_config.json', json.dumps(cfg, ensure_ascii=False, indent=2))
    return {'path': out, 'size': os.path.getsize(out)}


def save_export(data):
    """카드 이미지를 저장 폴더 안 '오늘날짜' 폴더에 01.jpg, 02.jpg … 로 저장.
    같은 날 또 저장하면 '10.21(2)', '10.21(3)' … (자동 업로드 프로그램의 완료·실패 폴더에 있는 이름도 피함)"""
    root = str(data.get('root') or DEFAULT_EXPORT_ROOT).strip().strip('"')
    if not os.path.isabs(root):
        raise IgError('저장 폴더는 C:\\… 처럼 전체 경로로 적어주세요')
    os.makedirs(root, exist_ok=True)
    taken = set()
    for d in (root, *(os.path.join(root, s) for s in ('완료', '실패', '예약취소'))):
        if os.path.isdir(d):
            taken.update(n.casefold() for n in os.listdir(d))
    base = datetime.now().strftime('%m.%d')
    name, n = base, 2
    while name.casefold() in taken:
        name, n = f'{base}({n})', n + 1
    path = os.path.join(root, name)
    os.makedirs(path)
    images = data.get('images') or []
    for i, durl in enumerate(images):
        header, _, b64 = str(durl).partition(',')
        ext = 'png' if 'image/png' in header else 'jpg'
        with open(os.path.join(path, f'{i + 1:02d}.{ext}'), 'wb') as f:
            f.write(base64.b64decode(b64))
    # 캡션은 맨 마지막에 (자동 업로드 프로그램은 캡션 메모장이 생기면 게시를 시작함)
    if data.get('withCaption') and str(data.get('caption') or '').strip():
        with open(os.path.join(path, 'caption.txt'), 'w', encoding='utf-8') as f:
            f.write(str(data['caption']).strip())
    return {'folder': name, 'path': os.path.abspath(path), 'count': len(images)}


def save_post(post):
    """게시물 사진을 '받은 포스트/계정_코드/' 폴더에 내려받고 캡션도 저장."""
    code = re.sub(r'[^A-Za-z0-9_-]', '', str(post.get('code') or 'post'))[:40] or 'post'
    user = re.sub(r'[^A-Za-z0-9._-]', '', str(post.get('user') or ''))[:40]
    folder = f'{user}_{code}' if user else code
    path = os.path.join(SAVE_ROOT, folder)
    os.makedirs(path, exist_ok=True)
    files = []
    last_err = None
    for i, m in enumerate(post.get('media') or []):
        url = str(m.get('url') or '')
        host = urllib.parse.urlsplit(url).hostname or ''
        if not url.startswith('https://') or not host.endswith(IMG_HOSTS):
            continue
        req = urllib.request.Request(url, headers={'User-Agent': UA, 'Referer': 'https://www.instagram.com/'})
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                data = r.read(MAX_BYTES + 1)
                ctype = r.headers.get('Content-Type', '')
        except Exception as e:   # 한 장 실패해도 나머지는 계속
            last_err = e
            continue
        ext = '.png' if 'png' in ctype else '.webp' if 'webp' in ctype else '.jpg'
        name = f'{i + 1:02d}{"_video_cover" if m.get("video") else ""}{ext}'
        with open(os.path.join(path, name), 'wb') as f:
            f.write(data)
        files.append(name)
    caption = str(post.get('caption') or '')
    with open(os.path.join(path, 'caption.txt'), 'w', encoding='utf-8') as f:
        f.write(caption + (f"\n\n출처: {post.get('link')}" if post.get('link') else ''))
    if not files:
        raise IgError('사진을 내려받지 못했어요' + (f' ({last_err})' if last_err else ' (게시물에 사진 주소가 없어요)'))
    return {
        'folder': folder, 'folderPath': os.path.abspath(path), 'caption': caption,
        'link': post.get('link', ''), 'user': user,
        'files': [f'/{urllib.parse.quote(SAVE_ROOT)}/{urllib.parse.quote(folder)}/{n}' for n in files],
    }


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    # 업데이트 후 재시작할 때 이전 서버가 포트를 놓을 때까지 잠깐 기다림
    for attempt in range(20):
        try:
            server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
            break
        except OSError:
            if attempt == 19:
                raise
            import time
            time.sleep(0.5)
    print(f'카드뉴스 편집기: http://127.0.0.1:{PORT}/  (이 창을 닫으면 종료됩니다)')
    server.serve_forever()
