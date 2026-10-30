/* 随身 WiFi 仪表盘 — 共享核心 (浏览器/Node 双端)
 * 提供: MD5、Digest 登录计算、设备 XML 解析、数据组装(buildStatus/traffic/devices 等)
 * 被 server.js (Node 网关) 与 public/gateway.js (APK 内直连网关) 共用。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MifiCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ===================== MD5 =====================
 * Paul Johnston 的经典 RFC 1321 实现 (BSD), 取自设备原厂 js/library/md5.js,
 * 版权与许可声明见下方。接口: md5(str) -> hex
 */
/*Copyright (c) 1998 - 2009, Paul Johnston & Contributors
*  All rights reserved.
*
*  Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
*
*  Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
*  Redistributions in binary form must reproduce the above copyright notice,
*  this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
*
*  Neither the name of the author nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.
*
*  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES,
*  INCLUDING, BUT NOT LIMITED TO,THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
*  IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
*  OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
*  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT,
*  STRICT LIABILITY,OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

/*
 * A JavaScript implementation of the RSA Data Security, Inc. MD5 Message
 * Digest Algorithm, as defined in RFC 1321.
 * Version 2.1 Copyright (C) Paul Johnston 1999 - 2002.
 * Other contributors: Greg Holt, Andrew Kepert, Ydnar, Lostinet
 * Distributed under the BSD License
 * See http://pajhome.org.uk/crypt/md5 for more info.
 */

/*
 * Configurable variables. You may need to tweak these to be compatible with
 * the server-side, but the defaults work in most cases.
 */
var hexcase = 0;  /* hex output format. 0 - lowercase; 1 - uppercase        */
var b64pad  = ""; /* base-64 pad character. "=" for strict RFC compliance   */
var chrsz   = 8;  /* bits per input character. 8 - ASCII; 16 - Unicode      */

/*
 * These are the functions you'll usually want to call
 * They take string arguments and return either hex or base-64 encoded strings
 */
function hex_md5(s){ return binl2hex(core_md5(str2binl(s), s.length * chrsz));}
function b64_md5(s){ return binl2b64(core_md5(str2binl(s), s.length * chrsz));}
function str_md5(s){ return binl2str(core_md5(str2binl(s), s.length * chrsz));}
function hex_hmac_md5(key, data) { return binl2hex(core_hmac_md5(key, data)); }
function b64_hmac_md5(key, data) { return binl2b64(core_hmac_md5(key, data)); }
function str_hmac_md5(key, data) { return binl2str(core_hmac_md5(key, data)); }

/* 
 * Perform a simple self-test to see if the VM is working 
 */
function md5_vm_test()
{
  return hex_md5("abc") == "900150983cd24fb0d6963f7d28e17f72";
}

/*
 * Calculate the MD5 of an array of little-endian words, and a bit length
 */
function core_md5(x, len)
{
  /* append padding */
  x[len >> 5] |= 0x80 << ((len) % 32);
  x[(((len + 64) >>> 9) << 4) + 14] = len;

  var a =  1732584193;
  var b = -271733879;
  var c = -1732584194;
  var d =  271733878;

  for(var i = 0; i < x.length; i += 16)
  {
    var olda = a;
    var oldb = b;
    var oldc = c;
    var oldd = d;

    a = md5_ff(a, b, c, d, x[i+ 0], 7 , -680876936);
    d = md5_ff(d, a, b, c, x[i+ 1], 12, -389564586);
    c = md5_ff(c, d, a, b, x[i+ 2], 17,  606105819);
    b = md5_ff(b, c, d, a, x[i+ 3], 22, -1044525330);
    a = md5_ff(a, b, c, d, x[i+ 4], 7 , -176418897);
    d = md5_ff(d, a, b, c, x[i+ 5], 12,  1200080426);
    c = md5_ff(c, d, a, b, x[i+ 6], 17, -1473231341);
    b = md5_ff(b, c, d, a, x[i+ 7], 22, -45705983);
    a = md5_ff(a, b, c, d, x[i+ 8], 7 ,  1770035416);
    d = md5_ff(d, a, b, c, x[i+ 9], 12, -1958414417);
    c = md5_ff(c, d, a, b, x[i+10], 17, -42063);
    b = md5_ff(b, c, d, a, x[i+11], 22, -1990404162);
    a = md5_ff(a, b, c, d, x[i+12], 7 ,  1804603682);
    d = md5_ff(d, a, b, c, x[i+13], 12, -40341101);
    c = md5_ff(c, d, a, b, x[i+14], 17, -1502002290);
    b = md5_ff(b, c, d, a, x[i+15], 22,  1236535329);

    a = md5_gg(a, b, c, d, x[i+ 1], 5 , -165796510);
    d = md5_gg(d, a, b, c, x[i+ 6], 9 , -1069501632);
    c = md5_gg(c, d, a, b, x[i+11], 14,  643717713);
    b = md5_gg(b, c, d, a, x[i+ 0], 20, -373897302);
    a = md5_gg(a, b, c, d, x[i+ 5], 5 , -701558691);
    d = md5_gg(d, a, b, c, x[i+10], 9 ,  38016083);
    c = md5_gg(c, d, a, b, x[i+15], 14, -660478335);
    b = md5_gg(b, c, d, a, x[i+ 4], 20, -405537848);
    a = md5_gg(a, b, c, d, x[i+ 9], 5 ,  568446438);
    d = md5_gg(d, a, b, c, x[i+14], 9 , -1019803690);
    c = md5_gg(c, d, a, b, x[i+ 3], 14, -187363961);
    b = md5_gg(b, c, d, a, x[i+ 8], 20,  1163531501);
    a = md5_gg(a, b, c, d, x[i+13], 5 , -1444681467);
    d = md5_gg(d, a, b, c, x[i+ 2], 9 , -51403784);
    c = md5_gg(c, d, a, b, x[i+ 7], 14,  1735328473);
    b = md5_gg(b, c, d, a, x[i+12], 20, -1926607734);

    a = md5_hh(a, b, c, d, x[i+ 5], 4 , -378558);
    d = md5_hh(d, a, b, c, x[i+ 8], 11, -2022574463);
    c = md5_hh(c, d, a, b, x[i+11], 16,  1839030562);
    b = md5_hh(b, c, d, a, x[i+14], 23, -35309556);
    a = md5_hh(a, b, c, d, x[i+ 1], 4 , -1530992060);
    d = md5_hh(d, a, b, c, x[i+ 4], 11,  1272893353);
    c = md5_hh(c, d, a, b, x[i+ 7], 16, -155497632);
    b = md5_hh(b, c, d, a, x[i+10], 23, -1094730640);
    a = md5_hh(a, b, c, d, x[i+13], 4 ,  681279174);
    d = md5_hh(d, a, b, c, x[i+ 0], 11, -358537222);
    c = md5_hh(c, d, a, b, x[i+ 3], 16, -722521979);
    b = md5_hh(b, c, d, a, x[i+ 6], 23,  76029189);
    a = md5_hh(a, b, c, d, x[i+ 9], 4 , -640364487);
    d = md5_hh(d, a, b, c, x[i+12], 11, -421815835);
    c = md5_hh(c, d, a, b, x[i+15], 16,  530742520);
    b = md5_hh(b, c, d, a, x[i+ 2], 23, -995338651);

    a = md5_ii(a, b, c, d, x[i+ 0], 6 , -198630844);
    d = md5_ii(d, a, b, c, x[i+ 7], 10,  1126891415);
    c = md5_ii(c, d, a, b, x[i+14], 15, -1416354905);
    b = md5_ii(b, c, d, a, x[i+ 5], 21, -57434055);
    a = md5_ii(a, b, c, d, x[i+12], 6 ,  1700485571);
    d = md5_ii(d, a, b, c, x[i+ 3], 10, -1894986606);
    c = md5_ii(c, d, a, b, x[i+10], 15, -1051523);
    b = md5_ii(b, c, d, a, x[i+ 1], 21, -2054922799);
    a = md5_ii(a, b, c, d, x[i+ 8], 6 ,  1873313359);
    d = md5_ii(d, a, b, c, x[i+15], 10, -30611744);
    c = md5_ii(c, d, a, b, x[i+ 6], 15, -1560198380);
    b = md5_ii(b, c, d, a, x[i+13], 21,  1309151649);
    a = md5_ii(a, b, c, d, x[i+ 4], 6 , -145523070);
    d = md5_ii(d, a, b, c, x[i+11], 10, -1120210379);
    c = md5_ii(c, d, a, b, x[i+ 2], 15,  718787259);
    b = md5_ii(b, c, d, a, x[i+ 9], 21, -343485551);

    a = safe_add(a, olda);
    b = safe_add(b, oldb);
    c = safe_add(c, oldc);
    d = safe_add(d, oldd);
  }
  return Array(a, b, c, d);

}

/*
 * These functions implement the four basic operations the algorithm uses.
 */
function md5_cmn(q, a, b, x, s, t)
{
  return safe_add(bit_rol(safe_add(safe_add(a, q), safe_add(x, t)), s),b);
}
function md5_ff(a, b, c, d, x, s, t)
{
  return md5_cmn((b & c) | ((~b) & d), a, b, x, s, t);
}
function md5_gg(a, b, c, d, x, s, t)
{
  return md5_cmn((b & d) | (c & (~d)), a, b, x, s, t);
}
function md5_hh(a, b, c, d, x, s, t)
{
  return md5_cmn(b ^ c ^ d, a, b, x, s, t);
}
function md5_ii(a, b, c, d, x, s, t)
{
  return md5_cmn(c ^ (b | (~d)), a, b, x, s, t);
}

/*
 * Calculate the HMAC-MD5, of a key and some data
 */
function core_hmac_md5(key, data)
{
  var bkey = str2binl(key);
  if(bkey.length > 16) bkey = core_md5(bkey, key.length * chrsz);

  var ipad = Array(16), opad = Array(16);
  for(var i = 0; i < 16; i++) 
  {
    ipad[i] = bkey[i] ^ 0x36363636;
    opad[i] = bkey[i] ^ 0x5C5C5C5C;
  }

  var hash = core_md5(ipad.concat(str2binl(data)), 512 + data.length * chrsz);
  return core_md5(opad.concat(hash), 512 + 128);
}

/*
 * Add integers, wrapping at 2^32. This uses 16-bit operations internally
 * to work around bugs in some JS interpreters.
 */
function safe_add(x, y)
{
  var lsw = (x & 0xFFFF) + (y & 0xFFFF);
  var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
  return (msw << 16) | (lsw & 0xFFFF);
}

/*
 * Bitwise rotate a 32-bit number to the left.
 */
function bit_rol(num, cnt)
{
  return (num << cnt) | (num >>> (32 - cnt));
}

/*
 * Convert a string to an array of little-endian words
 * If chrsz is ASCII, characters >255 have their hi-byte silently ignored.
 */
function str2binl(str)
{
  var bin = Array();
  var mask = (1 << chrsz) - 1;
  for(var i = 0; i < str.length * chrsz; i += chrsz)
    bin[i>>5] |= (str.charCodeAt(i / chrsz) & mask) << (i%32);
  return bin;
}

/*
 * Convert an array of little-endian words to a string
 */
function binl2str(bin)
{
  var str = "";
  var mask = (1 << chrsz) - 1;
  for(var i = 0; i < bin.length * 32; i += chrsz)
    str += String.fromCharCode((bin[i>>5] >>> (i % 32)) & mask);
  return str;
}

/*
 * Convert an array of little-endian words to a hex string.
 */
function binl2hex(binarray)
{
  var hex_tab = hexcase ? "0123456789ABCDEF" : "0123456789abcdef";
  var str = "";
  for(var i = 0; i < binarray.length * 4; i++)
  {
    str += hex_tab.charAt((binarray[i>>2] >> ((i%4)*8+4)) & 0xF) +
           hex_tab.charAt((binarray[i>>2] >> ((i%4)*8  )) & 0xF);
  }
  return str;
}

/*
 * Convert an array of little-endian words to a base-64 string
 */
function binl2b64(binarray)
{
  var tab = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var str = "";
  for(var i = 0; i < binarray.length * 4; i += 3)
  {
    var triplet = (((binarray[i   >> 2] >> 8 * ( i   %4)) & 0xFF) << 16)
                | (((binarray[i+1 >> 2] >> 8 * ((i+1)%4)) & 0xFF) << 8 )
                |  ((binarray[i+2 >> 2] >> 8 * ((i+2)%4)) & 0xFF);
    for(var j = 0; j < 4; j++)
    {
      if(i * 8 + j * 6 > binarray.length * 32) str += b64pad;
      else str += tab.charAt((triplet >> 6*(3-j)) & 0x3F);
    }
  }
  return str;
}
const md5 = hex_md5;

/* ===================== Digest 会话 (与原厂前端算法一致) ===================== */

  function parseChallenge(header) {
    if (!header || !/^Digest/i.test(header)) return null;
    const pick = (k) => (header.match(new RegExp(k + '="([^"]+)"', 'i')) || [])[1] || null;
    const realm = pick('realm'), nonce = pick('nonce');
    if (!realm || !nonce) return null;
    return { realm, nonce, qop: pick('qop') || 'auth' };
  }

  /**
   * 登录请求 (与原厂 doLogin + authentication() 逐项一致)。
   *
   * 查询串里 response 的 HA2 是 /cgi/protected.cgi, 同时还必须带一个 HA2 为
   * /cgi/xml_action.cgi 的 Authorization 头 —— 设备是靠这个头才真正登记管理会话的。
   * 只发查询串时设备回 200 + 一次新质询、不建会话, 之后所有数据请求都是
   * <login_status>UNAUTHORIZED</login_status>; 此时用浏览器登录一次设备后台,
   * 任何携带合法 Digest 的请求就又都能读数据了(会话是设备侧的开关, 与哪次登录无关)。
   * 两处共用一个 cnonce (原厂 doLogin 的 AuthCnonce)。
   */
  function loginRequest(cfg, challenge) {
    const ha1 = md5([cfg.user, challenge.realm, cfg.pass].join(':'));
    const nc = '00000001';
    const cnonce = md5(String(Date.now()) + Math.random()).slice(0, 16);
    const resp = md5([ha1, challenge.nonce, nc, cnonce, challenge.qop,
      md5('GET:/cgi/protected.cgi')].join(':'));
    const authResp = md5([ha1, challenge.nonce, nc, cnonce, challenge.qop,
      md5('GET:/cgi/xml_action.cgi')].join(':'));
    return {
      path: '/login.cgi?Action=Digest&username=' + encodeURIComponent(cfg.user)
        + '&realm=' + encodeURIComponent(challenge.realm)
        + '&nonce=' + encodeURIComponent(challenge.nonce)
        + '&response=' + resp + '&qop=' + challenge.qop
        + '&cnonce=' + cnonce + '&temp=asr',
      auth: 'Digest username="' + cfg.user + '", realm="' + challenge.realm + '"'
        + ', nonce="' + challenge.nonce + '", uri="/cgi/xml_action.cgi"'
        + ', response="' + authResp + '", qop=' + challenge.qop
        + ', nc=' + nc + ', cnonce="' + cnonce + '"',
    };
  }

  /** 数据请求的 Authorization 头 (uri 固定 /cgi/xml_action.cgi, nc 递增) */
  function authHeader(cfg, sess, method, nc) {
    const ha1 = md5([cfg.user, sess.realm, cfg.pass].join(':'));
    const ha2 = md5(method + ':/cgi/xml_action.cgi');
    const ncStr = String(nc).padStart(8, '0');
    const cnonce = md5(String(Date.now()) + Math.random()).slice(0, 16);
    const resp = md5([ha1, sess.nonce, ncStr, cnonce, sess.qop, ha2].join(':'));
    return 'Digest username="' + cfg.user + '", realm="' + sess.realm + '"'
      + ', nonce="' + sess.nonce + '", uri="/cgi/xml_action.cgi"'
      + ', response="' + resp + '", qop=' + sess.qop
      + ', nc=' + ncStr + ', cnonce="' + cnonce + '"';
  }

  /* ===================== 设备 XML 解析 (简单结构, Item 收入数组) ===================== */

  function decodeXmlEsc(s) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
      .replace(/&amp;/g, '&');
  }

  function parseXml(xml) {
    const s = String(xml).replace(/<\?[\s\S]*?\?>/g, '').trim();
    function parseFragment(str) {
      let p = 0;
      function parseOne() {
        const gt = str.indexOf('>', p);
        const tag = str.slice(p + 1, gt);
        p = gt + 1;
        const name = tag.split(/[\s/]/)[0];
        if (tag.endsWith('/')) return { name, value: '' };
        const close = '</' + name + '>';
        const ci = str.indexOf(close, p);
        const inner = str.slice(p, ci);
        p = ci + close.length;
        const t = inner.trim();
        return { name, value: t.startsWith('<') ? parseFragment(t) : decodeXmlEsc(t) };
      }
      const node = {};
      while (p < str.length) {
        if (str[p] !== '<') { p++; continue; }
        const gt = str.indexOf('>', p);
        const tag = str.slice(p + 1, gt);
        if (tag.startsWith('/') || tag.startsWith('!')) { p = gt + 1; continue; }
        const { name, value } = parseOne();
        if (name === 'Item') (node.items = node.items || []).push(value);
        else node[name] = value;
      }
      return node;
    }
    const parsed = parseFragment(s);
    return { RGW: parsed.RGW || {} };
  }

  /* ===================== 字段整理 (与 PHP 版一一对应) ===================== */

  const txt = (node, path, dft = '') => {
    let cur = node;
    for (const seg of path.split('/')) {
      if (cur == null || cur[seg] == null) return dft;
      cur = cur[seg];
    }
    return String(cur).trim();
  };

  const uniDecode = (hex) => {
    if (!/^(?:[0-9a-fA-F]{4})+$/.test(hex || '')) return hex || '';
    let out = '';
    for (let i = 0; i < hex.length; i += 4) out += String.fromCharCode(parseInt(hex.substr(i, 4), 16));
    return out;
  };

  // 设备返回的 ssid 是大写十六进制 (如 005700490046...), 这里跟着大写, 与固件自己的写法一致
  const uniEncode = (s) => Array.from(s).map(c =>
    (c.codePointAt(0) & 0xffff).toString(16).padStart(4, '0')).join('').toUpperCase();

  function sec2hms(sec) {
    let s = Math.max(0, parseInt(sec || '0', 10) || 0);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    s = s % 60;
    return h > 0 ? `${h}时${m}分${s}秒` : m > 0 ? `${m}分${s}秒` : `${s}秒`;
  }

  function signalBars(sysMode, rsrpRaw, rscpRaw) {
    if (sysMode === 5) {
      const c = parseInt(rscpRaw, 10) || 0;
      if (c > 30 && c <= 96) return 4;
      if (c > 26 && c <= 30) return 3;
      if (c > 21 && c <= 26) return 2;
      return c > 0 && c <= 21 ? 1 : 0;
    }
    if (sysMode === 17) {
      const r = parseInt(rsrpRaw, 10) || 0;
      if (r > 54 && r <= 97) return 4;
      if (r > 42 && r <= 54) return 3;
      if (r > 33 && r <= 42) return 2;
      return r > 0 && r <= 33 ? 1 : 0;
    }
    return 0;
  }

  const NET_MODES = { 2: 'GPRS', 3: 'EDGE', 5: 'HSDPA', 6: 'HSUPA', 7: 'HSPA', 15: 'TD-SCDMA', 17: 'LTE' };
  const nowIso = () => new Date().toISOString();

  function buildStatus(statusXml) {
    const x = parseXml(statusXml).RGW;
    const w = x.wan || {};
    const cell = w.cellular || {};
    const pdp = ((cell.pdp_context_list || {}).items || []).find(i => i.default === '1')
      || ((cell.pdp_context_list || {}).items || [])[0] || {};
    const apnItem = (((cell.pdp_auto_list || {}).items || [])[0]) || null;
    const sysMode = parseInt(txt(w, 'sys_mode'), 10) || 0;
    const rsrpRaw = parseInt(txt(w, 'rsrp'), 10);
    const rsrqRaw = parseInt(txt(w, 'rsrq'), 10);
    const rssiRaw = parseInt(txt(w, 'rssi'), 10);
    const charging = txt(w, 'Battery_charging') === '1';
    const batteryState = txt(w, 'Battery_connect') !== '1' ? '无电池'
      : !charging ? '未充电'
      : txt(w, 'Battery_charge') === '2' ? '已充满'
      : txt(w, 'Battery_charge') === '1' ? '充电中' : '已插电';
    const dns = [pdp.v4dns1, pdp.v4dns2].filter(Boolean).map(String);
    return {
      time: nowIso(),
      device: {
        model: txt(x.sysinfo, 'model_name', 'MiFi'),
        firmware: txt(x.sysinfo, 'version_num'),
        sn: txt(w, 'SN'), imei: txt(w, 'IMEI'), iccid: txt(w, 'ICCID'),
      },
      network: {
        status: txt(w, 'wan_conn_status', '--'),
        operator: txt(w, 'network_name', txt(w, 'ISP_name', '--')),
        roaming: txt(cell, 'roaming') === '1',
        mode: NET_MODES[txt(w, 'sys_submode')] || NET_MODES[sysMode] || '--',
        signalBars: signalBars(sysMode, txt(w, 'rsrp'), txt(w, 'rscp')),
        rsrpDbm: rsrpRaw >= 0 && rsrpRaw <= 97 ? -140 + rsrpRaw : null,
        rsrqDb: rsrqRaw >= 0 && rsrqRaw <= 34 ? Math.round((-19.5 + rsrqRaw / 2) * 10) / 10 : null,
        rssiDbm: rssiRaw >= 0 && rssiRaw <= 63 ? -110 + rssiRaw : null,
        sinr: txt(w, 'sinr') !== '' ? parseInt(txt(w, 'sinr'), 10) : null,
        pci: txt(w, 'pci') !== '' ? parseInt(txt(w, 'pci'), 10) : null,
        cellId: txt(w, 'cellid'),
        ipv4: pdp.ipv4 || '',
        gateway: pdp.v4gateway || '',
        dns,
        apn: apnItem ? String(apnItem.apn) : '',
        curConnTime: sec2hms(pdp.curconntime),
        totalConnTime: sec2hms(pdp.totalconntime),
      },
      battery: {
        present: txt(w, 'Battery_connect') === '1',
        percent: txt(w, 'Battery_connect') === '1' ? parseInt(txt(w, 'Battery_voltage'), 10) : null,
        charging,
        state: batteryState,
      },
      rate: {
        txRate: parseInt(txt(w, 'tx_rate'), 10) || 0,
        rxRate: parseInt(txt(w, 'rx_rate'), 10) || 0,
      },
      wifi: {
        enabled: txt(x.wlan_settings, 'wlan_enable') === '1',
        ssid: uniDecode(txt(x.wlan_security, 'ssid')),
        security: txt(x.wlan_security, 'mode'),
        channel: txt(x.wlan_settings, 'channel') === '0' ? '自动' : txt(x.wlan_settings, 'channel'),
      },
      lan: {
        ip: txt(x.lan, 'ip'), mac: txt(x.lan, 'mac'),
        uptime: `${txt(x.lan, 'run_days') ? txt(x.lan, 'run_days') + '天 ' : ''}${txt(x.lan, 'run_hours') || 0}时${txt(x.lan, 'run_minutes') || 0}分${txt(x.lan, 'run_seconds') || 0}秒`,
        connectedCount: parseInt(txt(x.device_management, 'nr_connected_dev'), 10) || 0,
      },
    };
  }

  /** 无线基础配置 (uapxb_wlan_basic_settings): 目前只取「无客户端自动关闭」
   *  字段 wifi_sleep_time: '0' = 关闭该功能, 10~60 = 空闲多少分钟后自动关闭无线
   *  status1 里没有这个字段, 必须单独读这个文件 (与原厂无线设置页同源) */
  function buildWlanBasic(xml) {
    const ws = (parseXml(xml).RGW || {}).wlan_settings || {};
    const raw = txt(ws, 'wifi_sleep_time');
    const n = raw === '' ? NaN : parseInt(raw, 10);
    const known = Number.isFinite(n);
    return {
      autoOff: { minutes: known ? n : null, enabled: known ? n > 0 : null },
    };
  }

  function buildTraffic(statsXml, freshStatusXml) {
    const x = parseXml(statsXml).RGW;
    const ws = (x.statistics || {}).WanStatistics || {};
    const cur = freshStatusXml ? parseXml(freshStatusXml).RGW : null;
    const cell = cur && cur.wan ? cur.wan.cellular : null;
    const pdp = cell && cell.pdp_context_list && cell.pdp_context_list.items ? cell.pdp_context_list.items[0] : null;
    return {
      time: nowIso(),
      monthUsedBytes: parseInt(txt(ws, 'total_used_month'), 10) || 0,
      totalUsedBytes: parseInt(txt(ws, 'total_used_unlimit'), 10) || 0,
      quotaBytes: parseInt(txt(ws, 'total_available_month') || '0', 10) || 0,
      curConnTime: pdp ? sec2hms(pdp.curconntime) : null,
      totalConnTime: pdp ? sec2hms(pdp.totalconntime) : null,
    };
  }

  function buildDevices(devicesXml) {
    const x = parseXml(devicesXml).RGW;
    const items = (((x.device_management || {}).client_list || {}).items) || [];
    const clients = items.map(c => ({
      name: String(c.name), mac: String(c.mac),
      ip: String(c.ip_address) === 'NA' ? '--' : String(c.ip_address),
      connected: String(c.status) === '1',
      rxBytes: parseInt(c.rx_data_used, 10) || 0,
      txBytes: parseInt(c.tx_data_used, 10) || 0,
      rxMonthly: parseInt(c.rx_data_used_monthly, 10) || 0,
      txMonthly: parseInt(c.tx_data_used_monthly, 10) || 0,
      since: String(c.conn_time_at || ''),
    }));
    clients.sort((a, b) => (b.connected - a.connected) || (b.rxBytes - a.rxBytes));
    return { time: nowIso(), onlineCount: clients.filter(c => c.connected).length, total: clients.length, clients };
  }

  const SIM_SLOTS = { 0: '卡1', 1: '卡2', 2: '卡3' };

  function buildSimInfo(esimXml, deviceinfoXml) {
    const e = parseXml(esimXml).RGW;
    const d = deviceinfoXml ? parseXml(deviceinfoXml).RGW : {};
    return {
      time: nowIso(),
      current: parseInt(txt(e.esim, 'simid', '-1'), 10),
      pwdRequired: txt(d.sysinfo, 'simmuxpwd', '0') === '1',
      slots: Object.entries(SIM_SLOTS).map(([v, label]) => ({ value: +v, label })),
    };
  }

  function bandCurrentFromXml(xml) {
    const cc = parseXml(xml).RGW.customconfig || {};
    const cur = parseInt(cc.band_current || '0', 10) || 0;
    const act = parseInt(cc.act_current || '0', 10) || 0;
    if (act === 7 && cur > 0) return (cur >= 33 && cur <= 64 ? 'TDD' : 'FDD') + ' B' + cur;
    if ([2, 4, 5, 6, 8].includes(act) && cur > 1) return 'UMTS B' + (cur - 1);
    return null;
  }

  function buildBandInfo(xml) {
    const cc = parseXml(xml).RGW.customconfig || {};
    const parts = String(cc.band_factory || '').split(',');
    const supH = parseInt(parts[3] || 0, 10) || 0;
    const supL = parseInt(parts[4] || 0, 10) || 0;
    const supE = parseInt(parts[8] || 0, 10) || 0;
    const setH = parseInt(cc.ltebandh || '0', 10) || 0;
    const setL = parseInt(cc.ltebandl || '0', 10) || 0;
    const setE = parseInt(cc.ltebandext || '0', 10) || 0;
    const bands = [];
    for (let i = 0; i < 32; i++) {
      if (supL & (1 << i)) bands.push({ band: 1 + i, type: 'FDD', enabled: !!(setL & (1 << i)) });
      if (supH & (1 << i)) bands.push({ band: 33 + i, type: 'TDD', enabled: !!(setH & (1 << i)) });
      if (supE & (1 << i)) bands.push({ band: 65 + i, type: 'FDD', enabled: !!(setE & (1 << i)) });
    }
    bands.sort((a, b) => a.band - b.band);
    return { time: nowIso(), bands, masks: { h: setH, l: setL, ext: setE }, current: bandCurrentFromXml(xml) };
  }

  const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /** 各类 set 命令的 XML 构造 (与原厂一致, 含声明头) */
  const SET_DECL = '<?xml version="1.0" encoding="US-ASCII"?> ';
  function buildSetXml(kind, payload) {
    switch (kind) {
      case 'ssid':
        return { file: 'uapxb_wlan_security_settings', xml: SET_DECL + `<RGW><wlan_security><ssid>${uniEncode(payload.ssid)}</ssid></wlan_security></RGW>` };
      case 'password':
        return { file: 'uapxb_wlan_security_settings', xml: SET_DECL + `<RGW><wlan_security><${payload.mode}><key>${xmlEsc(payload.password)}</key></${payload.mode}></wlan_security></RGW>` };
      case 'security': {
        // 名称 + 密码一次写完: 同一个文件、同一个请求, 设备只重启一次无线。
        // 三个字段一起发(ssid / mode / 当前模式的 key): 设备里 wlan_security 是分模式存密码的,
        // 只发 <ssid> 有可能把密码块冲掉 —— 改名时把原密码一起回填, 档案才是完整的。
        if (!payload.ssid) throw new Error('security 需要 ssid');
        const parts = [`<ssid>${uniEncode(payload.ssid)}</ssid>`];
        if (payload.mode && payload.password)
          parts.push(`<mode>${payload.mode}</mode>`, `<${payload.mode}><key>${xmlEsc(payload.password)}</key></${payload.mode}>`);
        return { file: 'uapxb_wlan_security_settings', xml: SET_DECL + `<RGW><wlan_security>${parts.join('')}</wlan_security></RGW>` };
      }
      case 'toggle':
        // 必须显式给 '0' 或 '1'。这里不做"取反", 也不把真值/空值当默认值 ——
        // 之前 UI 用 wifi.enabled 反推, status 缺失时会"想关反而开了", 而这个开关一旦关掉就无法远程回滚。
        if (payload.enable !== '0' && payload.enable !== '1')
          throw new Error('toggle 需要显式 enable="0"（关闭）或 "1"（开启）');
        return { file: 'uapxb_wlan_basic_settings', xml: SET_DECL + `<RGW><wlan_settings><wlan_enable>${payload.enable}</wlan_enable></wlan_settings></RGW>` };
      case 'autooff':
        // 原厂 js/panel/wireless/wireless_settings.js#SetWifiSleepTime: 两个字段一起发,
        // wifi_sleep_action=1 是设备要求的"立即生效"标志, 少发它写入不生效
        return { file: 'uapxb_wlan_basic_settings', xml: SET_DECL + `<RGW><wlan_settings><wifi_sleep_time>${payload.minutes}</wifi_sleep_time><wifi_sleep_action>1</wifi_sleep_action></wlan_settings></RGW>` };
      case 'sim':
        return { file: 'esim', xml: SET_DECL + `<RGW><esim><simmode>${payload.slot}</simmode>${payload.pw ? `<pw>${xmlEsc(payload.pw)}</pw>` : ''}</esim></RGW>` };
      case 'band': {
        let h = 0, l = 0, e = 0;
        for (const b of payload.bands) {
          if (b <= 32) l |= 1 << (b - 1);
          else if (b <= 64) h |= 1 << (b - 33);
          else e |= 1 << (b - 65);
        }
        return { file: 'customconfig', xml: SET_DECL + `<RGW><customconfig><ltebandh>${h}</ltebandh><ltebandl>${l}</ltebandl><ltebandext>${e}</ltebandext></customconfig></RGW>` };
      }
      case 'quota':
        return { file: 'statistics', xml: SET_DECL + `<RGW><statistics><WanStatistics><total_available_month>${payload.bytes}</total_available_month></WanStatistics></statistics></RGW>` };
    }
    throw new Error('不支持的设置类型');
  }

  /** 整机动作 (重启 / 关机) —— 和上面的 set 写字段不是一套机制。
   *
   *  原厂 js/panel/router/poweroff_router.js 与 reboot_router.js 里, 点「确定」后执行的是
   *      getData(xmlName)   // xmlName 来自菜单配置: power_off / reset
   *  即一个 **method=get 的文件请求**, 不带任何 XML body —— 取到这个文件就等于触发动作。
   *  这是整份固件里唯一"用 get 当按钮"的写法 (其余所有写操作都是 method=set + body),
   *  所以单独建模, 不要塞进 buildSetXml。
   *
   *  没有可回填的响应体, 调用方只能按 认证是否通过 判断成功与否:
   *  设备执行到一半断开连接是预期现象, 不能当失败。
   */
  const DEVICE_ACTIONS = {
    reboot: { file: 'reset', label: '重启设备' },
    poweroff: { file: 'power_off', label: '关闭设备' },
  };

  function buildDeviceAction(kind) {
    const a = DEVICE_ACTIONS[String(kind || '')];
    if (!a) throw new Error('不支持的操作');
    return { file: a.file, label: a.label };
  }

  /** 发卡平台响应解析 (单位 MB) */
  function buildRemoteTraffic(info, card) {
    const entity = info.entity || {};
    const lives = info.cardLiftList || [];
    let totalMb = parseFloat(entity.flowSize || 0) || 0;
    const packages = [];
    if (lives.length) {
      totalMb = 0;
      for (const life of lives) {
        const size = parseFloat(life.flowSize || 0) || 0;
        totalMb += size;
        packages.push({ name: String(life.mealName || '套餐'), sizeGB: Math.round(size / 1024 * 100) / 100 });
      }
    }
    const usedMb = parseFloat(entity.totalBytesCnt || 0) || 0;
    return {
      time: nowIso(), card,
      package: String(entity.cardPackage || ''),
      status: String(entity.statusStr || ''),
      expireDate: String(entity.expireDate || ''),
      totalBytes: Math.round(totalMb * 1048576),
      usedBytes: Math.round(usedMb * 1048576),
      leftBytes: Math.round(Math.max(0, totalMb - usedMb) * 1048576),
      unlimited: totalMb <= 0,
      packages,
    };
  }

  return {
    md5, parseChallenge, loginRequest, authHeader, parseXml, txt,
    uniDecode, uniEncode, xmlEsc, sec2hms, signalBars, NET_MODES,
    buildStatus, buildTraffic, buildDevices, buildSimInfo, buildBandInfo, bandCurrentFromXml, buildWlanBasic,
    buildSetXml, buildDeviceAction, DEVICE_ACTIONS, buildRemoteTraffic, SIM_SLOTS,
  };
});
