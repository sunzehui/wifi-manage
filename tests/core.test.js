'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../public/core.js');

// 测试用的假凭据: 不要写入真实设备口令, 本仓库是公开的
const CFG = { user: 'admin', pass: 'testpass', host: 'http://192.168.1.1' };
const CHALLENGE = { realm: 'Highwmg', nonce: '6028365', qop: 'auth' };

test('md5 与 PHP 侧一致', () => {
  assert.equal(C.md5('admin:Highwmg:testpass'), 'bfda623baa0a7c65c953803e117b3763');
  assert.equal(C.md5('GET:/cgi/protected.cgi'), '202fe3ae6688ea0a29cec56f47556821');
  assert.equal(C.md5('GET:/cgi/xml_action.cgi'), '905231dd8a834adf460e748aa0b216e3');
});

test('loginRequest: 查询串与 Authorization 头各用各的 HA2，但共用 nc/cnonce', () => {
  const { path, auth } = C.loginRequest(CFG, CHALLENGE);
  const q = new URLSearchParams(path.split('?')[1]);
  const cnonce = q.get('cnonce');
  const nc = (auth.match(/nc=([0-9a-f]+)/i) || [])[1];

  assert.ok(cnonce && cnonce.length === 16);
  assert.equal(nc, '00000001');
  assert.equal(q.get('qop'), 'auth');
  assert.equal(q.get('temp'), 'asr');
  assert.match(auth, /uri="\/cgi\/xml_action\.cgi"/);
  assert.ok(auth.includes(`cnonce="${cnonce}"`), '登录查询串与 Authorization 头必须共用 cnonce');

  const ha1 = C.md5('admin:Highwmg:testpass');
  const expectQuery = C.md5([ha1, CHALLENGE.nonce, nc, cnonce, CHALLENGE.qop, C.md5('GET:/cgi/protected.cgi')].join(':'));
  const expectAuth = C.md5([ha1, CHALLENGE.nonce, nc, cnonce, CHALLENGE.qop, C.md5('GET:/cgi/xml_action.cgi')].join(':'));
  assert.equal(q.get('response'), expectQuery, '查询串的 response 必须基于 /cgi/protected.cgi');
  assert.ok(auth.includes(`response="${expectAuth}"`), 'Authorization 头的 response 必须基于 /cgi/xml_action.cgi');
});

test('固定向量: 与 tests/digest_vectors.php 的期望值相同', () => {
  const ha1 = C.md5('admin:Highwmg:testpass');
  const cnonce = '0123456789abcdef';
  assert.equal(
    C.md5([ha1, '6028365', '00000001', cnonce, 'auth', C.md5('GET:/cgi/protected.cgi')].join(':')),
    'bc91a0a5a0013b9d05fdbe6a8eb1c7bb'
  );
  assert.equal(
    C.md5([ha1, '6028365', '00000001', cnonce, 'auth', C.md5('GET:/cgi/xml_action.cgi')].join(':')),
    '23192d08056d3589140da39c89c238a8'
  );
});

test('buildWlanBasic: wifi_sleep_time 0=关闭, 10~60=分钟, 缺字段=未知', () => {
  const on = C.buildWlanBasic('<RGW><wlan_settings><wlan_enable>1</wlan_enable><wifi_sleep_time>30</wifi_sleep_time></wlan_settings></RGW>');
  assert.deepEqual(on.autoOff, { minutes: 30, enabled: true });

  const off = C.buildWlanBasic('<RGW><wlan_settings><wifi_sleep_time>0</wifi_sleep_time></wlan_settings></RGW>');
  assert.deepEqual(off.autoOff, { minutes: 0, enabled: false });

  const unknown = C.buildWlanBasic('<RGW><wlan_settings></wlan_settings></RGW>');
  assert.deepEqual(unknown.autoOff, { minutes: null, enabled: null });
});

test('buildSetXml(autooff): 与原厂 SetWifiSleepTime 同款, 必须带 wifi_sleep_action', () => {
  const { file, xml } = C.buildSetXml('autooff', { minutes: 20 });
  assert.equal(file, 'uapxb_wlan_basic_settings');
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="US-ASCII"?> '), '缺声明头设备会报 CGI parse error');
  assert.ok(xml.includes('<wifi_sleep_time>20</wifi_sleep_time>'));
  assert.ok(xml.includes('<wifi_sleep_action>1</wifi_sleep_action>'));

  const off = C.buildSetXml('autooff', { minutes: 0 });
  assert.ok(off.xml.includes('<wifi_sleep_time>0</wifi_sleep_time>'));
});

test('buildDeviceAction: 重启/关机对应原厂 reset / power_off, 非法值直接拒', () => {
  assert.deepEqual(C.buildDeviceAction('reboot'), { file: 'reset', label: '重启设备' });
  assert.deepEqual(C.buildDeviceAction('poweroff'), { file: 'power_off', label: '关闭设备' });

  // 不能把这两个动作混进 buildSetXml: 它们是 method=get 的文件请求, 不是写字段
  assert.throws(() => C.buildSetXml('reboot', {}), /不支持的设置类型/);
  for (const bad of ['', 'reset', 'shutdown', null, undefined]) {
    assert.throws(() => C.buildDeviceAction(bad), /不支持的操作/);
  }
});

test('buildDevices: 在线优先、按下载量降序、NA 归零', () => {
  const xml = `<RGW><device_management><client_list>
    <Item index="1"><name>off</name><mac>AA:AA:AA:AA:AA:AA</mac><ip_address>NA</ip_address><status>0</status><rx_data_used>100</rx_data_used><tx_data_used>10</tx_data_used><rx_data_used_monthly>5</rx_data_used_monthly><tx_data_used_monthly>6</tx_data_used_monthly><conn_time_at>10/24/2026 19:45:24</conn_time_at></Item>
    <Item index="2"><name>small</name><mac>BB:BB:BB:BB:BB:BB</mac><ip_address>192.168.1.2</ip_address><status>1</status><rx_data_used>200</rx_data_used><tx_data_used>20</tx_data_used><rx_data_used_monthly>7</rx_data_used_monthly><tx_data_used_monthly>8</tx_data_used_monthly><conn_time_at>10/24/2026 19:46:10</conn_time_at></Item>
    <Item index="3"><name>big</name><mac>CC:CC:CC:CC:CC:CC</mac><ip_address>192.168.1.3</ip_address><status>1</status><rx_data_used>300</rx_data_used><tx_data_used>30</tx_data_used><rx_data_used_monthly>9</rx_data_used_monthly><tx_data_used_monthly>10</tx_data_used_monthly><conn_time_at>10/24/2026 19:58:46</conn_time_at></Item>
  </client_list></device_management></RGW>`;

  const d = C.buildDevices(xml);
  assert.equal(d.onlineCount, 2);
  assert.equal(d.total, 3);
  assert.deepEqual(d.clients.map(c => c.name), ['big', 'small', 'off']);
  assert.equal(d.clients[0].rxBytes, 300);
  assert.equal(d.clients[0].rxMonthly, 9);
  assert.equal(d.clients[1].connected, true);
  assert.equal(d.clients[2].connected, false);
  assert.equal(d.clients[2].ip, '--');
});

test('buildSetXml toggle: 只接受显式 "0"/"1"，不会把真值或缺失当成关闭', () => {
  assert.match(C.buildSetXml('toggle', { enable: '1' }).xml, /<wlan_enable>1<\/wlan_enable>/);
  assert.match(C.buildSetXml('toggle', { enable: '0' }).xml, /<wlan_enable>0<\/wlan_enable>/);
  // 这些以前都会被 === '1' 三段式悄悄折成 '0'，即"想关/想开"都由调用方猜
  for (const bad of [undefined, null, '', 'true', 'on', true, false, 1, 0]) {
    assert.throws(() => C.buildSetXml('toggle', { enable: bad }), /显式 enable/, `应拒绝 ${JSON.stringify(bad)}`);
  }
});

test('buildSetXml security: 名称与密码同一条请求，改名时也带上原密码', () => {
  const a = C.buildSetXml('security', { ssid: 'MyHomeWiFi', mode: 'WPA2-PSK', password: 'abcd1234' });
  assert.equal(a.file, 'uapxb_wlan_security_settings');
  // 设备自己返回的 ssid 是大写十六进制，写回去也用大写
  assert.match(a.xml, /<ssid>004D00790048006F006D00650057006900460069<\/ssid>/);
  assert.match(a.xml, /<mode>WPA2-PSK<\/mode><WPA2-PSK><key>abcd1234<\/key><\/WPA2-PSK>/);
  // 只改名 + 回填原密码：请求里必须仍然带着 key，否则设备可能把密码块冲掉
  const b = C.buildSetXml('security', { ssid: 'X', mode: 'WPA2-PSK', password: 'keepme12' });
  assert.match(b.xml, /<key>keepme12<\/key>/);
  assert.equal((b.xml.match(/<RGW>/g) || []).length, 1);        // 一条请求，不是拼接两条
  assert.throws(() => C.buildSetXml('security', {}), /需要 ssid/);
});
