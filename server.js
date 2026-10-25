#!/usr/bin/env node
/**
 * 随身 WiFi 仪表盘 — Node.js 版网关 (与 server.php 功能一致, 零依赖)
 *
 * 启动:
 *   WIFI_PASS=你的设备密码 node server.js            # 或创建 config.local.json
 *   PORT=8766 node server.js                          # 默认 8766
 *
 * 接口与页面同 PHP 版: /, /traffic, /devices, /api/status|traffic|devices|summary|
 * sim|band|wifi|traffic/quota|remote-traffic
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const core = require('./public/core.js');

/* ---------------- 配置 ---------------- */

function loadConfig() {
  let local = {};
  try { local = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.local.json'), 'utf8')); } catch {}
  return {
    host: process.env.WIFI_HOST || local.host || 'http://192.168.1.1',
    user: process.env.WIFI_USER || local.user || 'admin',
    pass: process.env.WIFI_PASS || local.pass || '',
    mgxCard: process.env.WIFI_MGX_CARD || local.mgx_card || '',
  };
}
const CFG = loadConfig();
const PORT = parseInt(process.env.PORT || '8766', 10);
const MGX_HOST = 'http://xmgxx.maigaoxun.com/kyhl-weixin-1.0';

/* ---------------- 设备 HTTP 传输层 ----------------
 * 设备的嵌入式 httpd 对连接/请求特征敏感 (Node 原生 http/fetch 直连会话会被静默拒绝),
 * 因此复用系统 curl 与 PHP 版保持完全一致的传输行为。
 */

function curlRequest(url, { method = 'GET', headers = {}, body = null, timeoutSec = 12 } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-s', '-m', String(timeoutSec), '-X', method, '-D', '-', '--max-redirs', '0'];
    for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
    if (body !== null) args.push('--data-binary', '@-');
    args.push(url);
    const child = execFile('curl', args, { timeout: (timeoutSec + 3) * 1000, maxBuffer: 16 * 1024 * 1024, encoding: 'buffer' },
      (err, stdout) => {
        if (err && !stdout.length) { reject(new Error('无法连接设备: ' + err.message)); return; }
        const raw = stdout.toString('utf8');
        const split = raw.indexOf('\r\n\r\n');
        const head = split >= 0 ? raw.slice(0, split) : '';
        const responseBody = split >= 0 ? raw.slice(split + 4) : '';
        const wwwAuth = (head.match(/^www-authenticate:\s*(.+)$/im) || [])[1] || '';
        const setCookie = (head.match(/^set-cookie:\s*(.+)$/im) || [])[1] || '';
        resolve({ body: responseBody, wwwAuth: wwwAuth.trim(), setCookie: setCookie.trim() });
      });
    if (body !== null) { child.stdin.end(body); } else { child.stdin.end(); }
  });
}

const rawGet = (url, authHeader, timeoutSec) => curlRequest(url, { headers: authHeader ? { Authorization: authHeader } : {}, timeoutSec });
const rawPost = (url, body, authHeader, timeoutSec) =>
  curlRequest(url, { method: 'POST', body, headers: authHeader ? { Authorization: authHeader } : {}, timeoutSec });

/* ---------------- 设备 Digest 会话 ---------------- */

const session = { realm: null, nonce: null, qop: 'auth', nc: 1 };

async function login() {
  if (!CFG.pass) throw new Error('未配置设备密码: 请设置环境变量 WIFI_PASS 或创建 config.local.json (见 README)');
  const r1 = await rawGet(CFG.host + '/login.cgi', null, 8);
  const ch = core.parseChallenge(r1.wwwAuth);
  if (!ch) throw new Error('设备未返回 Digest 质询, 请确认已连接到随身 WiFi');
  session.realm = ch.realm;
  session.nonce = ch.nonce;
  session.qop = ch.qop;
  session.nc = 1;
  await rawGet(CFG.host + core.loginUrl(CFG, ch), null, 8);
}

function authHeader(method) {
  const h = core.authHeader(CFG, session, method, session.nc);
  session.nc += 1;
  return h;
}

// 设备未登录/被踢/锁定时仍返回 <RGW> 骨架, 真实原因在 <login_status>;
// 只排除 UNAUTHORIZED 会把 KICKOFF 误判为成功(数据全空且不报错)。
const AUTH_FAIL = /<login_status>\s*(UNAUTHORIZED|KICKOFF|LOCK|NOTLOGIN)\s*<\/login_status>/i;
const authReason = (body) => {
  const m = String(body || '').match(AUTH_FAIL);
  return m ? m[1].toUpperCase() : '';
};
const authError = (why) => new Error(
  `设备拒绝登录(${why || 'NOAUTH'}): 账号或密码不正确, 请确认 WIFI_PASS / config.local.json`);
function xmlOk(body) {
  return body.includes('<RGW') && !AUTH_FAIL.test(body);
}

async function fetchXml(file) {
  if (!session.nonce) await login();
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await rawGet(
      `${CFG.host}/xml_action.cgi?method=get&module=duster&file=${file}&_=${Date.now()}`,
      authHeader('GET'), 12);
    if (xmlOk(r.body)) return r.body;
    if (attempt === 1) {
      const why = authReason(r.body);
      throw why ? authError(why) : new Error(`获取设备数据 ${file} 失败`);
    }
    await login();
  }
}

async function fetchXmlParallel(files) {
  if (!session.nonce) await login();
  const results = await Promise.allSettled(files.map(f =>
    rawGet(`${CFG.host}/xml_action.cgi?method=get&module=duster&file=${f}&_=${Date.now()}`, authHeader('GET'), 12)
      .then(r => (xmlOk(r.body) ? r.body : Promise.reject(new Error('auth'))))));
  const failed = files.filter((f, i) => results[i].status !== 'fulfilled');
  if (failed.length) {
    await login();
    const retry = await Promise.all(failed.map(f =>
      rawGet(`${CFG.host}/xml_action.cgi?method=get&module=duster&file=${f}&_=${Date.now()}`, authHeader('GET'), 12)));
    retry.forEach((r, i) => {
      if (!xmlOk(r.body)) {
        const why = authReason(r.body);
        throw why ? authError(why) : new Error(`获取设备数据 ${failed[i]} 失败`);
      }
      results[files.indexOf(failed[i])] = { status: 'fulfilled', value: r.body };
    });
  }
  const out = {};
  files.forEach((f, i) => { out[f] = results[i].value; });
  return out;
}

async function postXml(file, xml) {
  if (!session.nonce) await login();
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await rawPost(`${CFG.host}/xml_action.cgi?method=set&module=duster&file=${file}`, xml, authHeader('POST'));
    if (!r.body.includes('UNAUTHORIZED') && !r.body.includes('Error') && !r.wwwAuth) return r.body;
    if (attempt === 1) throw new Error(`设备拒绝了设置请求 (${file})`);
    await login();
  }
}

/* ---------------- 缓存 ---------------- */

const cache = new Map();   // file -> {xml, ts}
function cacheGet(file, ttlSec) {
  const e = cache.get(file);
  if (!e) return null;
  return (Date.now() - e.ts) / 1000 <= ttlSec ? e.xml : null;
}
function cacheAny(file) { return cache.get(file) || null; }
function cachePut(file, xml) { cache.set(file, { xml, ts: Date.now() }); }
function cacheClear(files) { files.forEach(f => cache.delete(f)); }

async function fetchSources(ttlMap) {
  const out = {}, pending = [];
  for (const [file, ttl] of Object.entries(ttlMap)) {
    const xml = cacheGet(file, ttl);
    if (xml !== null) out[file] = xml;
    else pending.push(file);
  }
  if (pending.length) {
    const got = await fetchXmlParallel(pending);
    for (const [file, xml] of Object.entries(got)) {
      out[file] = xml;
      cachePut(file, xml);
    }
  }
  return out;
}

/* ---------------- 业务接口 ---------------- */

const apiStatus = async () => core.buildStatus((await fetchSources({ status1: 4 })).status1);

const apiTraffic = async () => {
  const { statistics } = await fetchSources({ statistics: 20 });
  return core.buildTraffic(statistics, cacheGet('status1', 60));
};

const apiDevices = async () => core.buildDevices((await fetchSources({ device_management: 20 })).device_management);

const apiSummary = async () => {
  const x = await fetchSources({ status1: 4, statistics: 20, device_management: 20 });
  const st = core.buildStatus(x.status1);
  st.traffic = core.buildTraffic(x.statistics, x.status1);
  const dev = core.buildDevices(x.device_management);
  st.lan.connectedCount = dev.onlineCount;
  st.clients = dev.clients;
  return st;
};

const apiSimInfo = async () => {
  const x = await fetchSources({ esim: 5, deviceinfo: 600 });
  return core.buildSimInfo(x.esim, x.deviceinfo);
};

const apiBandInfo = async () => core.buildBandInfo((await fetchSources({ customconfig: 5 })).customconfig);

async function apiRemoteTraffic(refresh) {
  if (!CFG.mgxCard) throw new Error('未配置发卡平台设备号: 请在 config.local.json 增加 "mgx_card" 或设置环境变量 WIFI_MGX_CARD');
  if (!refresh) {
    const e = cacheAny('mgx_traffic');
    if (e && (Date.now() - e.ts) / 1000 <= 120) {
      return { ...JSON.parse(e.xml), cached: true };
    }
  }
  const loginRes = await fetch(`${MGX_HOST}/card/login.do?responseFunction=cb&iccidMark=${encodeURIComponent(CFG.mgxCard)}`,
    { signal: AbortSignal.timeout(15000) });
  const cookie = (loginRes.headers.get('set-cookie') || '').split(';')[0];
  const body = await loginRes.text();
  const loginJson = JSON.parse(body.slice(body.indexOf('{')));
  if (loginJson.code !== '0') throw new Error('发卡平台登录失败: ' + (loginJson.msg || '未知错误'));
  const infoRes = await fetch(`${MGX_HOST}/card/findCardInfo.do?iccidOrPhone=&responseFunction=cb&skipGift=true&rfm=${Math.random()}`,
    { headers: { Cookie: cookie }, signal: AbortSignal.timeout(15000) });
  const infoBody = await infoRes.text();
  const info = JSON.parse(infoBody.slice(infoBody.indexOf('{')));
  if (info.code !== '0') throw new Error('发卡平台查询失败: ' + (info.msg || '未知错误'));
  const out = core.buildRemoteTraffic(info, CFG.mgxCard);
  cachePut('mgx_traffic', JSON.stringify(out));
  return { ...out, cached: false };
}

/* ---------------- 写操作 ---------------- */

async function wifiAction(input) {
  switch (input.action) {
    case 'ssid': {
      const ssid = String(input.ssid || '').trim();
      if (!ssid || Buffer.byteLength(ssid, 'utf8') > 32) throw new Error('WiFi 名称需为 1-32 字节（1 个汉字占 3 字节）');
      const { file, xml } = core.buildSetXml('ssid', { ssid });
      await postXml(file, xml);
      cacheClear(['status1']);
      return { ok: true, message: 'WiFi 名称已更新，设备 WiFi 将短暂重启' };
    }
    case 'password': {
      const pwd = String(input.password || '');
      if (!/^[\x20-\x7e]{8,63}$/.test(pwd)) throw new Error('密码需为 8-63 位字符，且不含中文或空格');
      const cur = core.parseXml(await fetchXml('uapxb_wlan_security_settings')).RGW;
      const mode = String((cur.wlan_security || {}).mode || '').trim();
      if (!mode || mode === 'None') throw new Error('当前 WiFi 未启用加密，请先在设备后台设置加密方式');
      const { file, xml } = core.buildSetXml('password', { mode: mode.replace(/[^A-Za-z0-9-]/g, ''), password: pwd });
      await postXml(file, xml);
      return { ok: true, message: 'WiFi 密码已更新，请用新密码重新连接' };
    }
    case 'toggle': {
      const enable = input.enable === '1' ? '1' : '0';
      const { file, xml } = core.buildSetXml('toggle', { enable });
      await postXml(file, xml);
      cacheClear(['status1']);
      return { ok: true, message: enable === '1' ? 'WiFi 已开启' : 'WiFi 已关闭' };
    }
  }
  throw new Error('不支持的操作');
}

async function simAction(input) {
  const slot = parseInt(input.slot, 10);
  if (!(slot in core.SIM_SLOTS)) throw new Error('请选择有效的卡槽（卡1 / 卡2 / 卡3）');
  const info = await apiSimInfo();
  const pw = String(input.pw || '').trim();
  if (info.pwdRequired && (!pw || pw.length > 12)) throw new Error('请输入 SIM 切换密码（不超过 12 位）');
  const { file, xml } = core.buildSetXml('sim', { slot, pw: info.pwdRequired ? pw : '' });
  const resp = await postXml(file, xml);
  if (resp.includes('<cmd_status>pw</cmd_status>')) throw new Error('密码错误，请重试');
  cacheClear(['esim', 'status1', 'statistics', 'device_management']);
  return { ok: true, message: `SIM 卡槽已切换为 ${core.SIM_SLOTS[slot]}，网络将在几秒到几十秒内自动恢复` };
}

async function bandAction(input) {
  const info = await apiBandInfo();
  const sel = (input.bands || []).map(Number);
  if (!sel.length) throw new Error('请至少选择一个频段');
  const valid = info.bands.filter(b => sel.includes(b.band)).map(b => b.band);
  if (!valid.length) throw new Error('所选频段设备不支持');
  const { file, xml } = core.buildSetXml('band', { bands: valid });
  await postXml(file, xml);
  cacheClear(['customconfig']);
  return { ok: true, message: '频段设置已保存，设备将只在所选频段上驻网' };
}

async function quotaAction(input) {
  const gb = parseFloat(input.quotaGb);
  if (isNaN(gb) || gb < 0 || gb > 100000) throw new Error('流量总量需为 0 - 100000 GB（0 表示不限量）');
  const bytes = Math.floor(gb * 1073741824);
  const { file, xml } = core.buildSetXml('quota', { bytes });
  await postXml(file, xml);
  cacheClear(['statistics']);
  return { ok: true, message: bytes === 0 ? '已清除流量总量设置（不限量）' : `流量总量已设置为 ${gb} GB` };
}

/* ---------------- 页面与路由 ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};

function lanIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const it of ifaces || []) {
      if (it.family === 'IPv4' && !it.internal) return it.address;
    }
  }
  return '';
}

function pageOut(res, name, bootProvider) {
  let html;
  try { html = fs.readFileSync(path.join(__dirname, 'public', name), 'utf8'); } catch {
    res.writeHead(404); res.end('Not Found'); return;
  }
  if (bootProvider) {
    Promise.resolve()
      .then(bootProvider)
      .then(boot => {
        if (boot) html = html.replace('</head>',
          `<script>window.__BOOT__=${JSON.stringify(boot)};</script></head>`);
        const ip = lanIp();
        if (ip) html = html.replace('</head>', `<script>window.__LAN_IP__=${JSON.stringify(ip)};</script></head>`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(html);
      })
      .catch(() => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(html);
      });
  } else {
    const ip = lanIp();
    if (ip) html = html.replace('</head>', `<script>window.__LAN_IP__=${JSON.stringify(ip)};</script></head>`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  }
}

function jsonOut(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  let data = '';
  for await (const chunk of req) data += chunk;
  try { return JSON.parse(data); } catch { return null; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const uri = url.pathname;

  try {
    if (uri.startsWith('/api/')) {
      if (uri === '/api/status') return jsonOut(res, 200, await apiStatus());
      if (uri === '/api/traffic') return jsonOut(res, 200, await apiTraffic());
      if (uri === '/api/devices') return jsonOut(res, 200, await apiDevices());
      if (uri === '/api/summary') return jsonOut(res, 200, await apiSummary());
      if (uri === '/api/sim' && req.method === 'GET') return jsonOut(res, 200, await apiSimInfo());
      if (uri === '/api/band' && req.method === 'GET') return jsonOut(res, 200, await apiBandInfo());
      if (uri === '/api/remote-traffic') return jsonOut(res, 200, await apiRemoteTraffic(url.searchParams.get('refresh') === '1'));
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (!body) return jsonOut(res, 400, { ok: false, error: '请求格式错误' });
        if (uri === '/api/wifi') return jsonOut(res, 200, await wifiAction(body));
        if (uri === '/api/sim') return jsonOut(res, 200, await simAction(body));
        if (uri === '/api/band') return jsonOut(res, 200, await bandAction(body));
        if (uri === '/api/traffic/quota') return jsonOut(res, 200, await quotaAction(body));
      }
      return jsonOut(res, 404, { error: '接口不存在' });
    }

    if (uri === '/' || uri === '/index.html') {
      return pageOut(res, 'index.html', async () => {
        const xml = cacheGet('status1', 45);
        if (!xml) return null;
        const boot = core.buildStatus(xml);
        const stats = cacheGet('statistics', 300);
        if (stats) boot.trafficOverview = core.buildTraffic(stats, xml);
        const esim = cacheGet('esim', 300);
        if (esim) boot.simOverview = { current: core.buildSimInfo(esim).current };
        const band = cacheGet('customconfig', 300);
        if (band) boot.bandOverview = { current: core.bandCurrentFromXml(band) };
        return boot;
      });
    }
    if (uri === '/traffic' || uri === '/traffic.html') {
      return pageOut(res, 'traffic.html', async () => {
        const xml = cacheGet('statistics', 120);
        return xml ? core.buildTraffic(xml, cacheGet('status1', 60)) : null;
      });
    }
    if (uri === '/devices' || uri === '/devices.html') {
      return pageOut(res, 'devices.html', async () => {
        const xml = cacheGet('device_management', 60);
        return xml ? core.buildDevices(xml) : null;
      });
    }

    // 静态文件
    const file = path.normalize(uri).replace(/^(\.\.[/\\])+/, '');
    const full = path.join(__dirname, 'public', file);
    if (full.startsWith(path.join(__dirname, 'public')) && fs.existsSync(full) && fs.statSync(full).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
      fs.createReadStream(full).pipe(res);
      return;
    }
    res.writeHead(404); res.end('Not Found');
  } catch (e) {
    jsonOut(res, uri.startsWith('/api/') ? 502 : 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const ip = lanIp();
  console.log(`随身 WiFi 仪表盘 (Node) 已启动`);
  console.log(`  本机:   http://127.0.0.1:${PORT}`);
  if (ip) console.log(`  手机:   http://${ip}:${PORT}  (需连接同一 WiFi)`);
});
