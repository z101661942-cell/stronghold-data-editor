/**
 * 数据编辑器的小服务：把 tools/bond-editor.html 用 http://localhost:<port>/ 提供出去。
 *
 * 为什么需要它：编辑器的「保存到 data/」用的是 File System Access API（showDirectoryPicker）。
 * Chrome 只在安全上下文里给这个 API —— https 或 http://localhost 可以，file:// 不行。
 * 走 file:// 打开时编辑器会退化成「手动导入 JSON、改完下载回去」，多一步手工覆盖。
 *
 * 用法：node tools/editor-server.cjs [--port 3001] [--no-open]
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = __dirname;                                  // <repo>/tools
const EDITOR = path.join(ROOT, 'bond-editor.html');

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const PORT = Number(argOf('--port', process.env.SP_EDITOR_PORT || 3001));
const OPEN = !argv.includes('--no-open');

if (!fs.existsSync(EDITOR)) {
  console.error('找不到编辑器：' + EDITOR);
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/bond-editor.html';
  const file = path.resolve(ROOT, '.' + rel);
  // 只允许读 tools/ 里面的文件
  if (file !== EDITOR && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(buf);
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    const url = 'http://localhost:' + PORT + '/';
    console.log('端口 ' + PORT + ' 已经在用（编辑器可能已经开着）：' + url);
    if (OPEN) openBrowser(url);
    process.exit(0);
  }
  console.error('启动失败：' + e.message);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  const url = 'http://localhost:' + PORT + '/';
  console.log('数据编辑器已就绪：' + url);
  console.log('（编辑器里「选择 data 目录」要指向你本地 Stronghold-Protocol 仓库的 data 文件夹；关掉这个窗口即停止。Ctrl+C 退出。）');
  if (OPEN) openBrowser(url);
});

/** 用 Chrome/Edge 打开（系统默认 .html 关联可能是不支持该 API 的浏览器）。 */
function openBrowser(url) {
  const candidates = [
    process.env['PROGRAMFILES'] + '\\Google\\Chrome\\Application\\chrome.exe',
    process.env['PROGRAMFILES(X86)'] + '\\Google\\Chrome\\Application\\chrome.exe',
    process.env['LOCALAPPDATA'] + '\\Google\\Chrome\\Application\\chrome.exe',
    process.env['PROGRAMFILES(X86)'] + '\\Microsoft\\Edge\\Application\\msedge.exe',
    process.env['PROGRAMFILES'] + '\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  for (const exe of candidates) {
    if (!fs.existsSync(exe)) continue;
    try {
      spawn(exe, ['--new-window', url], { detached: true, stdio: 'ignore' }).unref();
      return;
    } catch { /* 试下一个 */ }
  }
  // 没有 Chrome/Edge 就交给系统默认浏览器
  try { spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref(); } catch { }
}
