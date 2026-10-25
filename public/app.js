/* 随身 WiFi 公共脚本（三页共用）: 工具函数、头部状态、轮询、弹窗、Toast */
'use strict';
window.__errs = [];
window.addEventListener('error', e => window.__errs.push(String(e.message)));

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtBytes = b => {
  if (b == null || isNaN(b)) return '--';
  if (b >= 1 << 30) return (b / (1 << 30)).toFixed(2) + ' GB';
  if (b >= 1 << 20) return (b / (1 << 20)).toFixed(1) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
  return b + ' B';
};
const fmtRate = b => b >= 1 << 20 ? (b / (1 << 20)).toFixed(2) + ' MB/s'
                    : b >= 1024 ? (b / 1024).toFixed(1) + ' KB/s' : b + ' B/s';

/* ---------- 通俗化解释 ---------- */
const netTypeName = mode => mode === '17' ? '4G LTE' : mode === '41' || mode === '45' ? '5G' : mode || '--';
function signalLabel(rsrpDbm) {
  if (rsrpDbm == null) return '信号未知';
  if (rsrpDbm >= -85) return '信号极好';
  if (rsrpDbm >= -95) return '信号良好';
  if (rsrpDbm >= -105) return '信号一般';
  return '信号较差';
}
function signalTone(rsrpDbm) {
  if (rsrpDbm == null) return '';
  if (rsrpDbm >= -95) return '';
  if (rsrpDbm >= -105) return 'warn';
  return 'bad';
}
// 设备类型推断：基于设备上报的真实名称
function deviceType(name) {
  const n = String(name || '').toLowerCase();
  if (/iphone|vivo|huawei|xiaomi|redmi|oppo|honor|pixel|meizu|oneplus|手机/.test(n)) return ['手机', '📱'];
  if (/ipad|tablet|pad(?!e)|平板/.test(n)) return ['平板', '🖥'];
  if (/mac|book|pc|desktop|thinkpad|surface|air|imac/.test(n)) return ['电脑', '💻'];
  return ['未知', '❓'];
}

/* ---------- 头部联网状态 ---------- */
function renderNetPill(status) {
  const connected = status === 'connected';
  const pill = $('netPill');
  pill.className = 'pill ' + (connected ? 'good' : 'bad');
  $('netPillText').textContent = connected ? '已联网' : '未联网';
}

/* ---------- 弹层 / Toast ---------- */
function openModal(id) { $(id).classList.add('show'); }
function closeModals() { document.querySelectorAll('.overlay').forEach(o => o.classList.remove('show')); }
function bindModals() {
  document.querySelectorAll('.overlay').forEach(o => {
    o.addEventListener('click', e => { if (e.target === o) closeModals(); });
  });
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModals));
  document.querySelectorAll('[data-eye]').forEach(b => b.addEventListener('click', () => {
    const input = $(b.dataset.eye);
    input.type = input.type === 'password' ? 'text' : 'password';
  }));
}
let toastTimer = null;
function toast(msg, ok) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show ' + (ok ? 'ok' : 'err');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}
function showErrorBanner(msg) {
  const pill = $('netPill');
  pill.className = 'pill bad';
  $('netPillText').textContent = '设备不可达';
  const banner = $('banner');
  banner.textContent = '无法获取设备数据：' + msg + '。请确认电脑已连接到随身 WiFi 的网络。';
  banner.classList.add('show');
}
function hideErrorBanner() { $('banner').classList.remove('show'); }

/* ---------- 数据加载: intervalMs>0 自动轮询并返回手动刷新函数; intervalMs=0 仅加载一次 ---------- */
function startPolling(url, onOk, intervalMs) {
  let busy = false;
  async function tick() {
    if (busy) return;   // 上一次未完成(设备慢)时跳过本轮, 避免排队
    busy = true;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error((await r.json()).error || ('HTTP ' + r.status));
      onOk(await r.json());
      hideErrorBanner();
    } catch (e) {
      showErrorBanner(e.message);
    }
    busy = false;
  }
  tick();
  if (intervalMs > 0) setInterval(tick, intervalMs);
  return tick;
}
