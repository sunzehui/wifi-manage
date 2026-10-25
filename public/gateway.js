/* 随身 WiFi 仪表盘 — 浏览器直连网关 (APK WebView 内使用)
 *
 * 在无服务器的环境下(file:// 页面)直接与设备 192.168.1.1 和发卡平台通信,
 * 提供 get(path)/post(path, body), 形状与 server.php / server.js 的 HTTP 接口一致。
 * 依赖: core.js (先于本文件加载)
 * 配置: localStorage 读取 mifi_host/mifi_user/mifi_pass/mgx_card
 */
(function () {
  'use strict';
  if (!window.MifiCore) return;

  const LS = {
    get: (k, dft) => localStorage.getItem(k) || dft,
    set: (k, v) => localStorage.setItem(k, v),
  };

  function cfg() {
    return {
      // 设备请求经 App 内置本地代理转发 (设备会 KICKOFF 带 Accept-Encoding 的请求,
      // WebView fetch 无法去掉该头, 由 Java 代理 HttpURLConnection 转发)
      host: LS.get('mifi_proxy', 'http://127.0.0.1:8787'),
      devHost: LS.get('mifi_dev', 'http://192.168.1.1'),   // 仅供参考展示
      user: LS.get('mifi_user', 'admin'),
      pass: LS.get('mifi_pass', ''),
      mgxCard: LS.get('mgx_card', ''),
    };
  }
  window.MifiCfg = cfg;   // 设置界面读写用

  const C = window.MifiCore;
  const session = { realm: null, nonce: null, qop: 'auth', nc: 1 };
  const cache = new Map();   // file -> {xml, ts}

  async function httpGet(url, auth, timeoutMs = 12000) {
    const res = await fetch(url, {
      headers: auth ? { Authorization: auth } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { body: await res.text(), wwwAuth: res.headers.get('www-authenticate') || '' };
  }

  /* ---------------- 会话 (等价于 server.php 的 session 文件) ----------------
   * 设备 httpd 同一时刻只允许一个管理会话: 任何一次新的登录都会把既有会话踢掉,
   * 被踢的客户端此后一直收到 <login_status>KICKOFF</login_status>。所以必须像
   * server.php 那样把 realm/nonce/nc 持久化复用, 只在完全没有会话时登录一次。
   * 「失败就重登再重试」会把自己和设备一起踢死(实测: 连续登录后连电脑端也取不到
   * 数据, 只能等设备重启或会话超时)。这是 App 与 PHP 版表现不同的根本原因。
   */
  const SESSION_KEY = 'mifi_session';
  const SESSION_TTL = 30 * 60 * 1000;
  let loginBlockedUntil = 0;   // 登录失败指数退避
  let lastAuthReason = '';     // 设备最后一次给出的拒绝原因 (KICKOFF/UNAUTHORIZED/...)

  function saveSession() {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        realm: session.realm, nonce: session.nonce, qop: session.qop,
        nc: session.nc, ts: Date.now(),
      }));
    } catch (e) { /* 存储不可用时退化为内存会话 */ }
  }
  function loadSession() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (!s || !s.realm || !s.nonce) return false;
      if (Date.now() - (s.ts || 0) > SESSION_TTL) return false;
      session.realm = s.realm;
      session.nonce = s.nonce;
      session.qop = s.qop || 'auth';
      session.nc = s.nc || 1;
      return true;
    } catch (e) { return false; }
  }
  function invalidateSession() {
    session.nonce = null;
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { }
  }
  /** 有可用会话就直接复用(跨页面/跨重启), 避免多余登录把设备的唯一会话踢掉 */
  function ensureSession() {
    if (session.nonce && session.realm) return true;
    return loadSession();
  }

  async function login() {
    const cfg = cfgsafe();
    if (!cfg.pass) throw new Error('未配置设备密码: 点击右上角 ⚙ 设置');
    if (Date.now() < loginBlockedUntil) {
      throw authError(lastAuthReason, Math.ceil((loginBlockedUntil - Date.now()) / 1000));
    }
    const r1 = await httpGet(cfg.host + '/login.cgi');
    const ch = C.parseChallenge(r1.wwwAuth);
    if (!ch) throw new Error('设备未返回质询, 请确认手机已连接到随身 WiFi');
    session.realm = ch.realm;
    session.nonce = ch.nonce;
    session.qop = ch.qop;
    session.nc = 1;
    // 设备即使登录成功也会再回一次质询(实测), 不能据此判定失败;
    // 真正的判据是随后数据请求返回的 <login_status>。
    await httpGet(cfg.host + C.loginUrl(cfg, ch));
    saveSession();
  }
  function noteLoginResult(ok, reason) {
    loginBackoff = ok ? 0 : Math.min((loginBackoff || 30000) * 2, 600000);
    if (ok) { lastAuthReason = ''; return; }
    if (reason) lastAuthReason = reason;
    loginBlockedUntil = Date.now() + loginBackoff;
  }
  let loginBackoff = 0;
  function cfgsafe() { return cfg(); }

  function authHeader(method) {
    const h = C.authHeader(cfg(), session, method, session.nc);
    session.nc += 1;
    saveSession();
    return h;
  }

  // 设备在「未登录 / 会话被踢 / 登录锁定」时仍会返回 <RGW> 骨架,
  // 真实原因只在 <login_status> 里。旧逻辑仅排除 UNAUTHORIZED, 会把 KICKOFF
  // 误判成成功 → 页面所有字段为空且不报错(表现为「连不上后台」却没有任何提示)。
  const AUTH_FAIL = /<login_status>\s*(UNAUTHORIZED|KICKOFF|LOCK|NOTLOGIN)\s*<\/login_status>/i;
  const ok = (b) => b.includes('<RGW') && !AUTH_FAIL.test(b);
  const authReason = (b) => {
    const m = String(b || '').match(AUTH_FAIL);
    return m ? m[1].toUpperCase() : '';
  };
  const authError = (reason, retrySec) => {
    const wait = retrySec ? `, ${retrySec} 秒后自动重试` : '';
    if (reason === 'KICKOFF') {
      return new Error('设备把本机会话踢出了(同一台设备同一时间只允许一个管理会话, ' +
        '多半是电脑端仪表盘也在访问)' + wait);
    }
    if (reason === 'LOCK') {
      return new Error('设备登录已锁定(失败次数过多), 请稍后重试或重启随身 WiFi' + wait);
    }
    if (reason === 'NOTLOGIN' || reason === 'UNAUTHORIZED') {
      return new Error('设备拒绝登录: 账号或密码不正确, 请点击右上角 ⚙ 确认设备后台密码' + wait);
    }
    return new Error('无法获取设备数据' + (reason ? `(${reason})` : '') + wait);
  };

  /** 会话类失败(被踢/未登录)只退避, 绝不连环重登 —— 否则会互相踢死设备会话 */
  function failAuth(reason) {
    invalidateSession();
    noteLoginResult(false, reason);
    return authError(reason);
  }

  async function fetchXml(file) {
    if (!ensureSession()) await login();
    const url = `${cfg().host}/xml_action.cgi?method=get&module=duster&file=${file}&_=${Date.now()}`;
    const r = await httpGet(url, authHeader('GET'));
    if (ok(r.body)) { noteLoginResult(true); return r.body; }
    const why = authReason(r.body);
    if (why) throw failAuth(why);
    // 非鉴权类失败(网络抖动/超时): 重新登录一次后重试
    invalidateSession();
    await login();
    const r2 = await httpGet(url, authHeader('GET'));
    if (ok(r2.body)) { noteLoginResult(true); return r2.body; }
    const why2 = authReason(r2.body);
    throw why2 ? failAuth(why2) : new Error(`获取设备数据 ${file} 失败`);
  }

  async function fetchXmlParallel(files) {
    if (!ensureSession()) await login();
    const urlOf = f => `${cfg().host}/xml_action.cgi?method=get&module=duster&file=${f}&_=${Date.now()}`;
    const results = await Promise.allSettled(files.map(f => httpGet(urlOf(f), authHeader('GET'))));
    const out = {};
    const failed = [];
    let why = '';
    files.forEach((f, i) => {
      const r = results[i];
      if (r.status === 'fulfilled' && ok(r.value.body)) out[f] = r.value.body;
      else {
        failed.push(f);
        if (r.status === 'fulfilled') why = why || authReason(r.value.body);
      }
    });
    if (!failed.length) { noteLoginResult(true); return out; }
    if (why) throw failAuth(why);          // 被踢/未登录: 退避即可, 不要重登

    invalidateSession();                   // 网络类失败: 重登一次再试
    await login();
    for (const f of failed) {
      const r = await httpGet(urlOf(f), authHeader('GET'));
      if (!ok(r.body)) {
        const w = authReason(r.body);
        throw w ? failAuth(w) : new Error(`获取设备数据 ${f} 失败`);
      }
      out[f] = r.body;
    }
    noteLoginResult(true);
    return out;
  }

  async function postXml(file, xml) {
    if (!ensureSession()) await login();
    const send = () => fetch(`${cfg().host}/xml_action.cgi?method=set&module=duster&file=${file}`, {
      method: 'POST',
      headers: { Authorization: authHeader('POST') },
      body: xml,
      signal: AbortSignal.timeout(12000),
    }).then(res => res.text());

    let body = await send();
    let why = authReason(body);
    if (!why && !body.includes('UNAUTHORIZED') && !body.includes('Error')) { noteLoginResult(true); return body; }
    if (why) throw failAuth(why);
    invalidateSession();
    await login();
    body = await send();
    why = authReason(body);
    if (!why && !body.includes('UNAUTHORIZED') && !body.includes('Error')) { noteLoginResult(true); return body; }
    throw why ? failAuth(why) : new Error('设备拒绝了设置请求');
  }

  function cacheGet(file, ttlSec) {
    const e = cache.get(file);
    return e && (Date.now() - e.ts) / 1000 <= ttlSec ? e.xml : null;
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
    if (pending.length) Object.assign(out, await fetchXmlParallel(pending));
    for (const [file, xml] of Object.entries(out)) cachePut(file, xml);
    return out;
  }

  /* ---------------- 发卡平台 ---------------- */

  const MGX_TIMEOUT = 15000;

  /** 平台响应前面有几行空白, 直接 JSON.parse 会失败, 从第一个 { 开始截 */
  function parseLooseJson(text) {
    const i = text.indexOf('{');
    if (i < 0) return null;
    try { return JSON.parse(text.slice(i)); } catch (e) { return null; }
  }

  async function mgxGet(path) {
    const r = await fetch(cfgsafe().host + '/mgx' + path, {
      credentials: 'include',
      signal: AbortSignal.timeout(MGX_TIMEOUT),
    });
    const j = parseLooseJson(await r.text());
    if (!j) throw new Error('发卡平台返回异常(响应无法解析)');
    return j;
  }

  const mgxLoginPath = (card) =>
    '/card/login.do?responseFunction=cb&iccidMark=' + encodeURIComponent(card);

  async function remoteTraffic(refresh) {
    const cfg = cfgsafe();
    if (!cfg.mgxCard) throw new Error('未配置发卡平台设备号: 点击右上角 ⚙ 设置');
    if (!refresh) {
      const e = cacheAny('mgx_traffic');
      if (e && (Date.now() - e.ts) / 1000 <= 120) return { ...JSON.parse(e.xml), cached: true };
    }
    const login = await mgxGet(mgxLoginPath(cfg.mgxCard));
    if (login.code !== '0') throw new Error('发卡平台登录失败: ' + (login.msg || '设备号可能有误'));
    const infoPath = '/card/findCardInfo.do?iccidOrPhone=&responseFunction=cb&skipGift=true&rfm=' + Math.random();
    let info = await mgxGet(infoPath);
    // 会话失效(平台返回 "session过期"): 重新登录后再取一次
    if (info.code !== '0' && (String(info.system_result_key) === '7' ||
        String(info.returnurl || '').indexOf('login') >= 0)) {
      await mgxGet(mgxLoginPath(cfg.mgxCard));
      info = await mgxGet(infoPath);
    }
    if (info.code !== '0') {
      throw new Error('发卡平台查询失败: ' +
        (info.system_result_message_key || info.msg || '会话已过期, 请稍后重试'));
    }
    const out = C.buildRemoteTraffic(info, cfg.mgxCard);
    cachePut('mgx_traffic', JSON.stringify(out));
    return { ...out, cached: false };
  }

  /* ---------------- get / post (与 HTTP 接口同形状) ---------------- */

  const GET = {
    '/api/status': async () => C.buildStatus((await fetchSources({ status1: 4 })).status1),
    '/api/traffic': async () => C.buildTraffic((await fetchSources({ statistics: 20 })).statistics, cacheGet('status1', 60)),
    '/api/devices': async () => C.buildDevices((await fetchSources({ device_management: 20 })).device_management),
    '/api/sim': async () => {
      const x = await fetchSources({ esim: 5, deviceinfo: 600 });
      return C.buildSimInfo(x.esim, x.deviceinfo);
    },
    '/api/band': async () => C.buildBandInfo((await fetchSources({ customconfig: 5 })).customconfig),
  };

  async function post(path, body) {
    if (path === '/api/wifi') {
      if (body.action === 'ssid') {
        const v = String(body.ssid || '').trim();
        if (!v || new Blob([v]).size > 32) throw new Error('WiFi 名称需为 1-32 字节');
        const s = C.buildSetXml('ssid', { ssid: v });
        await postXml(s.file, s.xml);
        cacheClear(['status1']);
        return { ok: true, message: 'WiFi 名称已更新，设备 WiFi 将短暂重启' };
      }
      if (body.action === 'password') {
        const pwd = String(body.password || '');
        if (!/^[\x20-\x7e]{8,63}$/.test(pwd)) throw new Error('密码需为 8-63 位字符');
        const cur = C.parseXml(await fetchXml('uapxb_wlan_security_settings')).RGW;
        const mode = String((cur.wlan_security || {}).mode || '').trim();
        if (!mode || mode === 'None') throw new Error('当前 WiFi 未启用加密');
        const s = C.buildSetXml('password', { mode: mode.replace(/[^A-Za-z0-9-]/g, ''), password: pwd });
        await postXml(s.file, s.xml);
        return { ok: true, message: 'WiFi 密码已更新，请用新密码重新连接' };
      }
      if (body.action === 'toggle') {
        const s = C.buildSetXml('toggle', { enable: body.enable === '1' ? '1' : '0' });
        await postXml(s.file, s.xml);
        cacheClear(['status1']);
        return { ok: true, message: body.enable === '1' ? 'WiFi 已开启' : 'WiFi 已关闭' };
      }
      throw new Error('不支持的操作');
    }
    if (path === '/api/sim') {
      const slot = parseInt(body.slot, 10);
      if (!(slot in C.SIM_SLOTS)) throw new Error('请选择有效的卡槽');
      const info = await GET['/api/sim']();
      const pw = String(body.pw || '').trim();
      if (info.pwdRequired && !pw) throw new Error('请输入切换密码');
      const s = C.buildSetXml('sim', { slot, pw: info.pwdRequired ? pw : '' });
      const resp = await postXml(s.file, s.xml);
      if (resp.includes('<cmd_status>pw</cmd_status>')) throw new Error('密码错误，请重试');
      cacheClear(['esim', 'status1', 'statistics', 'device_management']);
      return { ok: true, message: `SIM 卡槽已切换为 ${C.SIM_SLOTS[slot]}` };
    }
    if (path === '/api/band') {
      const info = await GET['/api/band']();
      const sel = (body.bands || []).map(Number);
      const valid = info.bands.filter(b => sel.includes(b.band)).map(b => b.band);
      if (!valid.length) throw new Error('请至少选择一个有效频段');
      const s = C.buildSetXml('band', { bands: valid });
      await postXml(s.file, s.xml);
      cacheClear(['customconfig']);
      return { ok: true, message: '频段设置已保存' };
    }
    if (path === '/api/traffic/quota') {
      const gb = parseFloat(body.quotaGb);
      if (isNaN(gb) || gb < 0 || gb > 100000) throw new Error('流量总量需为 0 - 100000 GB');
      const s = C.buildSetXml('quota', { bytes: Math.floor(gb * 1073741824) });
      await postXml(s.file, s.xml);
      cacheClear(['statistics']);
      return { ok: true, message: gb === 0 ? '已清除流量总量设置' : `流量总量已设置为 ${gb} GB` };
    }
    throw new Error('接口不存在');
  }

  window.MifiGateway = {
    async get(path) {
      if (path.startsWith('/api/remote-traffic')) {
        return remoteTraffic(path.includes('refresh=1'));
      }
      const fn = GET[path.replace(/\?.*$/, '')];
      if (!fn) throw new Error('接口不存在: ' + path);
      return fn();
    },
    post,
    hasPass: () => !!cfg().pass,
  };
})();
