"""배포: version.json 을 지금 시각으로 올리고 깃허브에 올림 (배포.bat 에서 실행).
받은 사람 편집기는 켤 때 이 버전을 보고 '업데이트 하기' 버튼을 띄움."""
import json
import os
import subprocess
import sys
from datetime import datetime

os.chdir(os.path.dirname(os.path.abspath(__file__)))
notes = ' '.join(sys.argv[1:]).strip()
version = datetime.now().strftime('%Y.%m.%d.%H%M')
with open('version.json', 'w', encoding='utf-8') as f:
    json.dump({'version': version, 'notes': notes}, f, ensure_ascii=False, indent=2)


def git(*args):
    print('> git', *args)
    return subprocess.run(['git', *args]).returncode


git('add', '-A')
# 키·개인 파일이 실수로 올라가지 않는지 마지막 확인 (.gitignore 가 지워졌을 때 대비)
staged = subprocess.run(['git', '-c', 'core.quotepath=false', 'ls-files'], capture_output=True, text=True, encoding='utf-8').stdout.splitlines()
bad = [p for p in staged if p.startswith(('프로젝트/', '받은 포스트/', '.claude/')) or p.endswith('shared_config.json')]
if bad:
    print('[중단] 올리면 안 되는 파일이 들어갔어요:', bad)
    subprocess.run(['git', 'reset', '-q'])
    sys.exit(1)
if git('commit', '-m', f'업데이트 {version}' + (f' - {notes}' if notes else '')) != 0:
    print('바뀐 내용이 없어요 (version.json 만 갱신됨)')
sys.exit(git('push'))
