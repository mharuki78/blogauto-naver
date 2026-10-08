const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

function findChrome(platform = process.platform, env = process.env, exists = fs.existsSync) {
  if (!['win32', 'darwin'].includes(platform)) return '';
  const candidates = platform === 'darwin'
    ? ['/Applications/Google Chrome.app', path.posix.join(env.HOME || os.homedir(), 'Applications', 'Google Chrome.app')]
    : [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean)
      .map(root => path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  return candidates.find(exists) || '';
}

function launchSpec(root, account, platform = process.platform, chrome = findChrome(platform)) {
  if (!chrome) throw new Error('정식 Google Chrome을 설치해 주세요.');
  if (!account?.id || !/^[a-zA-Z0-9_-]{1,100}$/.test(account.blogId || '')) throw new Error('계정과 블로그 주소 ID를 확인하세요.');
  const key = crypto.createHash('sha256').update(account.id).digest('hex').slice(0, 24);
  // Separate from legacy automation profiles. Never copy cookies or touch Chrome Preferences.
  const dataDir = account.platform === 'tistory' ? '' : path.join(root, 'account-chrome', key);
  const url = account.platform === 'tistory'
    ? `https://${require('./tistoryTarget').normalizeTistoryBlogId(account.blogId)}.tistory.com/manage/post`
    : `https://blog.naver.com/${encodeURIComponent(account.blogId)}/postwrite`;
  return { chrome, dataDir, url, args: [...(dataDir ? [`--user-data-dir=${dataDir}`] : []), url], key, platform };
}

async function openAccountChrome(root, account, shell, options = {}) {
  const spec = launchSpec(root, account, options.platform, options.chrome);
  if(spec.dataDir)fs.mkdirSync(spec.dataDir, { recursive: true });
  const label = String(account.label || account.blogId).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 60);
  if (spec.platform === 'win32') {
    const shortcuts = path.join(root, 'chrome-shortcuts');
    fs.mkdirSync(shortcuts, { recursive: true });
    const shortcut = path.join(shortcuts, `${label}-${spec.key.slice(0, 6)}.lnk`);
    const ok = shell.writeShortcutLink(shortcut, 'create', {
      target: spec.chrome, args: spec.args.map(arg => `"${arg}"`).join(' '),
      description: `${account.label || account.blogId} · 사용자 Chrome`, icon: spec.chrome, iconIndex: 0
    });
    if (!ok) throw new Error('Chrome 바로가기를 만들지 못했습니다.');
    const error = await shell.openPath(shortcut);
    if (error) throw new Error(error);
    return { ...spec, shortcut };
  }
  if (spec.platform === 'darwin') {
    // Start with explicit launch arguments for both platforms. A bare `open -a`
    // URL can target an isolated Naver instance with the same bundle ID.
    // Chrome's profile singleton forwards to the matching running instance:
    // Naver uses its data directory; Tistory uses Chrome's default directory.
    const args = ['-n', '-a', spec.chrome, '--args', ...spec.args];
    await new Promise((resolve, reject) => {
      const child = (options.spawn || spawn)('/usr/bin/open', args, { stdio: 'ignore', windowsHide: true });
      child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('Chrome을 열지 못했습니다.')));
    });
    return spec;
  }
  throw new Error('현재 실행 도우미는 Windows와 macOS를 지원합니다.');
}
module.exports = { findChrome, launchSpec, openAccountChrome };
