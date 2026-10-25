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

  async function login() {
    const cfg = cfgsafe();
    if (!cfg.pass) throw new Error('未配置设备密码: 点击右上角 ⚙ 设置');
    const r1 = await httpGet(cfg.host + '/login.cgi');
    const ch = C.parseChallenge(r1.wwwAuth);
    if (!ch) throw new Error('设备未返回质询, 请确认手机已连接到随身 WiFi');
    session.realm = ch.realm;
    session.nonce = ch.nonce;
    session.qop = ch.qop;
    session.nc = 1;
    await httpGet(cfg.host + C.loginUrl(cfg, ch));
  }
  function cfgsafe() { return cfg(); }

  function authHeader(method) {
    const h = C.authHeader(cfg(), session, method, session.nc);
    session.nc += 1;
    return h;
  }

  const ok = (b) => b.includes('<RGW') && !b.includes('UNAUTHORIZED');

  async function fetchXml(file) {
    if (!session.nonce) await login();
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await httpGet(`${cfg().host}/xml_action.cgi?method=get&module=duster&file=${file}&_=${Date.now()}`, authHeader('GET'));
      if (ok(r.body)) return r.body;
      if (attempt === 1) throw new Error(`获取设备数据 ${file} 失败`);
      await login();
    }
  }

  async function fetchXmlParallel(files) {
    if (!session.nonce) await login();
    const results = await Promise.allSettled(files.map(f =>
      httpGet(`${cfg().host}/xml_action.cgi?method=get&module=duster&file=${f}&_=${Date.now()}`, authHeader('GET'))));
    const out = {};
    const failed = [];
    files.forEach((f, i) => {
      if (results[i].status === 'fulfilled' && ok(results[i].value.body)) out[f] = results[i].value.body;
      else failed.push(f);
    });
    if (failed.length) {
      await login();
      for (const f of failed) {
        const r = await httpGet(`${cfg().host}/xml_action.cgi?method=get&module=duster&file=${f}&_=${Date.now()}`, authHeader('GET'));
        if (!ok(r.body)) throw new Error(`获取设备数据 ${f} 失败`);
        out[f] = r.body;
      }
    }
    return out;
  }

  async function postXml(file, xml) {
    if (!session.nonce) await login();
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`${cfg().host}/xml_action.cgi?method=set&module=duster&file=${file}`, {
        method: 'POST',
        headers: { Authorization: authHeader('POST') },
        body: xml,
        signal: AbortSignal.timeout(12000),
      });
      const body = await res.text();
      if (!body.includes('UNAUTHORIZED') && !body.includes('Error')) return body;
      if (attempt === 1) throw new Error('设备拒绝了设置请求');
      await login();
    }
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

  async function remoteTraffic(refresh) {
    const cfg = cfgsafe();
    if (!cfg.mgxCard) throw new Error('未配置发卡平台设备号: 点击右上角 ⚙ 设置');
    if (!refresh) {
      const e = cacheAny('mgx_traffic');
      if (e && (Date.now() - e.ts) / 1000 <= 120) return { ...JSON.parse(e.xml), cached: true };
    }
    const lr = await fetch(`${cfg().host}/mgx/card/login.do?responseFunction=cb&iccidMark=${encodeURIComponent(cfg.mgxCard)}`,
      { signal: AbortSignal.timeout(15000) });
    const cookie = (lr.headers.get('set-cookie') || '').split(';')[0];
    const lb = await lr.text();
    const lj = JSON.parse(lb.slice(lb.indexOf('{')));
    if (lj.code !== '0') throw new Error('发卡平台登录失败');
    const ir = await fetch(`${cfg().host}/mgx/card/findCardInfo.do?iccidOrPhone=&responseFunction=cb&skipGift=true&rfm=${Math.random()}`,
      { headers: { Cookie: cookie }, signal: AbortSignal.timeout(15000) });
    const ib = await ir.text();
    const info = JSON.parse(ib.slice(ib.indexOf('{')));
    if (info.code !== '0') throw new Error('发卡平台查询失败');
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
