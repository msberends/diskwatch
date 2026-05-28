'use strict';

// ============================================================
// Utilities
// ============================================================

function formatBytes(n) {
  if (n == null) return '—';
  const units = ['B','KB','MB','GB','TB','PB'];
  const mults = [1,1e3,1e6,1e9,1e12,1e15];
  let i = 0;
  const abs = Math.abs(n);
  while (i < mults.length - 1 && abs >= mults[i+1]) i++;
  const v = abs / mults[i];
  return (n < 0 ? '-' : '') + v.toFixed(2).replace(/\.?0+$/, m => m === '.' ? '' : m) + ' ' + units[i];
}

function formatBytesShort(n) {
  if (n == null) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e15) return sign + (abs/1e15).toFixed(1) + ' PB';
  if (abs >= 1e12) return sign + (abs/1e12).toFixed(1) + ' TB';
  if (abs >= 1e9)  return sign + (abs/1e9).toFixed(1)  + ' GB';
  if (abs >= 1e6)  return sign + (abs/1e6).toFixed(1)  + ' MB';
  if (abs >= 1e3)  return sign + (abs/1e3).toFixed(1)  + ' KB';
  return sign + abs + ' B';
}

function parseSize(str) {
  if (!str) return NaN;
  const m = str.trim().match(/^([\d.]+)\s*(tb|gb|mb|kb|b)?$/i);
  if (!m) return NaN;
  const num = parseFloat(m[1]);
  const mult = { b:1, kb:1e3, mb:1e6, gb:1e9, tb:1e12 };
  return Math.round(num * (mult[(m[2]||'b').toLowerCase()] ?? 1));
}

function bytesToHuman(n) {
  if (!n) return '';
  const units = ['TB','GB','MB','KB','B'];
  const mults = [1e12,1e9,1e6,1e3,1];
  for (let i = 0; i < units.length; i++) {
    if (n >= mults[i]) {
      const v = n / mults[i];
      return (Number.isInteger(v) ? v : v.toFixed(1)) + ' ' + units[i];
    }
  }
  return n + ' B';
}

function formatTs(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString(undefined, {
    day:'numeric', month:'short', year:'numeric',
    hour:'2-digit', minute:'2-digit',
  });
}

function relativeTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 5)   return 'just now';
  if (secs < 60)  return secs + 's ago';
  if (secs < 3600) return Math.floor(secs/60) + 'm ago';
  if (secs < 86400) return Math.floor(secs/3600) + 'h ago';
  return Math.floor(secs/86400) + 'd ago';
}

function formatDuration(secs) {
  if (secs == null) return '—';
  const s = Math.round(secs);
  if (s < 60) return s + 's';
  const m = Math.floor(s/60);
  return m + 'm ' + (s%60) + 's';
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function spinner() {
  return '<div class="dw-spinner-overlay"><div class="dw-spinner"></div></div>';
}

function tableSpinner(cols) {
  return `<tr><td colspan="${cols}" class="text-center py-4">${spinner()}</td></tr>`;
}

function growthBadge(bytes) {
  if (bytes == null) return '<span class="dw-dir-delta flat">—</span>';
  if (bytes === 0)   return '<span class="dw-dir-delta flat">±0</span>';
  const cls  = bytes > 0 ? 'up' : 'down';
  const icon = bytes > 0 ? '▲' : '▼';
  return `<span class="dw-dir-delta ${cls}">${icon} ${formatBytesShort(Math.abs(bytes))}</span>`;
}

// ============================================================
// SVG gauge
// ============================================================

function makeSvgGauge(pct) {
  const r = 36, cx = 44, cy = 44;
  const circ = 2 * Math.PI * r;
  const targetOffset = circ * (1 - Math.min(pct, 100) / 100);
  const strokeColor = pct >= 85
    ? 'var(--dw-crit)'
    : pct >= 70
      ? 'var(--dw-warn)'
      : 'var(--dw-ok)';
  return `<svg class="dw-gauge-svg" width="88" height="88" viewBox="0 0 88 88" fill="none">
    <circle cx="${cx}" cy="${cy}" r="${r}" stroke="var(--dw-surface3)" stroke-width="7"/>
    <circle class="dw-gauge-arc" cx="${cx}" cy="${cy}" r="${r}"
      stroke="${strokeColor}" stroke-width="7"
      stroke-dasharray="${circ.toFixed(2)} ${circ.toFixed(2)}"
      stroke-dashoffset="${circ.toFixed(2)}"
      data-offset="${targetOffset.toFixed(2)}"
      stroke-linecap="round"
      transform="rotate(-90 ${cx} ${cy})"/>
    <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"
      font-family="var(--font-mono)" font-size="14" font-weight="600" fill="currentColor">${pct.toFixed(0)}%</text>
  </svg>`;
}

// ============================================================
// API layer
// ============================================================

async function api(method, path, body) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  if (res.status === 401) { checkAuth(); throw new Error('Not authenticated'); }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.detail ? (typeof j.detail === 'object' ? JSON.stringify(j.detail) : j.detail) : msg;
    } catch (_) {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

const GET  = (p)    => api('GET',  p);
const POST = (p, b) => api('POST', p, b);
const PUT  = (p, b) => api('PUT',  p, b);

// ============================================================
// Toast
// ============================================================

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const id = 'toast-' + Date.now();
  const bg = type === 'success' ? 'bg-success' : type === 'danger' ? 'bg-danger' : 'bg-secondary';
  container.insertAdjacentHTML('beforeend', `
    <div id="${id}" class="toast align-items-center text-white ${bg} border-0" role="alert" aria-atomic="true">
      <div class="d-flex">
        <div class="toast-body">${esc(message)}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    </div>`);
  const el = document.getElementById(id);
  const t = new bootstrap.Toast(el, { delay: 4000 });
  t.show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}

// ============================================================
// Theme
// ============================================================

function applyTheme(theme) {
  document.documentElement.setAttribute('data-bs-theme', theme === 'light' ? 'light' : 'dark');
  const cls = theme === 'light' ? 'bi-moon-fill' : 'bi-sun-fill';
  ['themeIcon','themeIconMobile'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.className = 'bi ' + cls;
  });
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-bs-theme') || 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  GET('/api/settings').then(cfg => {
    cfg.display = cfg.display || {};
    cfg.display.theme = next;
    PUT('/api/settings', cfg).catch(() => {});
  }).catch(() => {});
}

// ============================================================
// Auth
// ============================================================

let _authenticated = false;

async function checkAuth() {
  try {
    const status = await GET('/api/auth/status');
    if (status.authenticated) {
      _authenticated = true;
      showApp();
    } else if (status.needs_setup) {
      showSetupForm();
    } else {
      showLoginForm();
    }
  } catch (_) {
    showLoginForm();
  }
}

function showLoginForm() {
  _authenticated = false;
  document.getElementById('loginPage').classList.remove('d-none');
  document.getElementById('loginForm').classList.remove('d-none');
  document.getElementById('setupForm').classList.add('d-none');
}

function showSetupForm() {
  _authenticated = false;
  document.getElementById('loginPage').classList.remove('d-none');
  document.getElementById('loginForm').classList.add('d-none');
  document.getElementById('setupForm').classList.remove('d-none');
}

function showApp() {
  document.getElementById('loginPage').classList.add('d-none');
  updateBadges();
  updateLastScan();
  route();
}

async function doLogin() {
  const pw = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.classList.add('d-none');
  try {
    await POST('/api/login', { password: pw });
    _authenticated = true;
    document.getElementById('loginPassword').value = '';
    showApp();
  } catch (e) {
    errEl.textContent = e.message || 'Login failed';
    errEl.classList.remove('d-none');
  }
}

async function doSetup() {
  const pw  = document.getElementById('setupPassword').value;
  const pw2 = document.getElementById('setupPasswordConfirm').value;
  const errEl = document.getElementById('setupError');
  errEl.classList.add('d-none');
  if (pw !== pw2) { errEl.textContent = 'Passwords do not match.'; errEl.classList.remove('d-none'); return; }
  if (pw.length < 8) { errEl.textContent = 'Password must be at least 8 characters.'; errEl.classList.remove('d-none'); return; }
  try {
    await POST('/api/setup', { password: pw });
    _authenticated = true;
    showApp();
  } catch (e) {
    errEl.textContent = e.message || 'Setup failed';
    errEl.classList.remove('d-none');
  }
}

async function doLogout() {
  try { await POST('/api/logout'); } catch (_) {}
  _authenticated = false;
  showLoginForm();
}

// ============================================================
// Sidebar badges + last scan + health status
// ============================================================

async function updateBadges() {
  try {
    const [ac, al] = await Promise.all([
      GET('/api/anomalies/count?acknowledged=false'),
      GET('/api/alerts/count?acknowledged=false'),
    ]);
    const ba = document.getElementById('badgeGrowthSpikes');
    const bl = document.getElementById('badgeAlerts');
    if (ba) { if (ac.count > 0) { ba.textContent = ac.count; ba.style.display = ''; } else ba.style.display = 'none'; }
    if (bl) { if (al.count > 0) { bl.textContent = al.count; bl.style.display = ''; } else bl.style.display = 'none'; }
  } catch (_) {}
}

async function updateLastScan() {
  try {
    const info = await GET('/api/scan-info');
    const latest = info.reduce((best, r) => (!r.latest_scan ? best : (!best || r.latest_scan > best) ? r.latest_scan : best), null);
    const el = document.getElementById('lastScanTime');
    if (el) el.textContent = latest ? relativeTime(latest) : 'Never';
  } catch (_) {}
}

function updateTopbarHealth(health, alertCount, anomalyCount) {
  const el = document.getElementById('topbarHealth');
  const txt = document.getElementById('topbarHealthText');
  if (!el || !txt) return;
  el.className = 'dw-topbar-health ' + health;
  txt.textContent = health === 'ok'
    ? 'System Healthy'
    : health === 'critical'
      ? (alertCount > 0 ? `${alertCount} Active Alert${alertCount !== 1 ? 's' : ''}` : 'Critical Usage')
      : 'Usage Elevated';

  const st = document.getElementById('sidebarStatusDot');
  const stxt = document.getElementById('sidebarStatusText');
  const ssub = document.getElementById('sidebarStatusSub');
  if (st) {
    st.className = 'dw-status-dot-row ' + (health === 'ok' ? '' : health === 'critical' ? 'crit' : 'warn');
    if (stxt) stxt.textContent = health === 'ok' ? 'All systems nominal' : txt.textContent;
    if (ssub && alertCount > 0) ssub.textContent = `${alertCount} unacknowledged alert${alertCount !== 1 ? 's' : ''}`;
    else if (ssub && anomalyCount > 0) ssub.textContent = `${anomalyCount} growth spike${anomalyCount !== 1 ? 's' : ''}`;
    else if (ssub) ssub.textContent = '';
  }
}

// ============================================================
// Router
// ============================================================

function setActiveNav(view) {
  document.querySelectorAll('.dw-nav-link[data-view]').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });
}

function route() {
  const hash = location.hash || '#/dashboard';
  const parts = hash.replace(/^#\//, '').split('/');
  const view = parts[0] || 'dashboard';
  setActiveNav(view);
  const container = document.getElementById('viewContainer');
  switch (view) {
    case 'dashboard':    renderDashboard(container); break;
    case 'browse':       renderBrowse(container, parts.slice(1).join('/')); break;
    case 'growth-spikes': renderAnomalies(container); break;
    case 'alerts':       renderAlerts(container); break;
    case 'scans':        renderScans(container); break;
    case 'settings':     renderSettings(container); break;
    default:             renderDashboard(container);
  }
}

// ============================================================
// View: Dashboard
// ============================================================

async function renderDashboard(container) {
  container.innerHTML = spinner();
  try {
    const data = await GET('/api/dashboard');
    const { partitions, scan_info, top_dirs, growers, anomaly_count, alert_count, recent_alerts } = data;

    const totalSize  = scan_info.reduce((s, r) => s + (r.total_size_bytes || 0), 0);
    const totalDirs  = scan_info.reduce((s, r) => s + (r.directories_counted || 0), 0);
    const totalScans = scan_info.reduce((s, r) => s + (r.total_scans || 0), 0);
    const topGrower  = growers[0];

    const maxPct = partitions.reduce((m, p) => Math.max(m, p.used_percent || 0), 0);
    const health = (maxPct >= 85 || alert_count > 0) ? 'critical'
                 : (maxPct >= 70 || anomaly_count > 0) ? 'warning'
                 : 'ok';

    updateTopbarHealth(health, alert_count, anomaly_count);

    // --- Health banner ---
    const banner = health !== 'ok' ? `
      <div class="dw-health-banner dw-health-banner--${health}">
        <i class="bi bi-${health === 'critical' ? 'exclamation-octagon-fill' : 'exclamation-triangle-fill'}"></i>
        <span>${health === 'critical'
          ? (alert_count > 0 ? `${alert_count} active alert${alert_count !== 1 ? 's' : ''} — attention required` : `Disk usage critical — ${maxPct.toFixed(0)}% used`)
          : (anomaly_count > 0 ? `${anomaly_count} growth spike${anomaly_count !== 1 ? 's' : ''} detected` : `Disk usage elevated — ${maxPct.toFixed(0)}% used`)
        }</span>
        ${alert_count > 0 ? '<a href="#/alerts" class="ms-2 fw-semibold">View alerts →</a>' : ''}
        ${anomaly_count > 0 && alert_count === 0 ? '<a href="#/growth-spikes" class="ms-2 fw-semibold">Review →</a>' : ''}
      </div>` : '';

    // --- Partition cards ---
    const partitionCards = partitions.length === 0
      ? '<div class="text-muted small">No partitions configured.</div>'
      : partitions.map(p => {
          const pct = p.used_percent || 0;
          const cls = pct >= 85 ? 'crit' : pct >= 70 ? 'warn' : '';
          const top3html = (p.top_dirs || []).map(d =>
            `<div class="dw-partition-topdir" title="${esc(d.path)}">${esc(d.path.split('/').pop() || d.path)} — ${formatBytesShort(d.size_bytes)}</div>`
          ).join('');
          return `
            <div class="dw-partition-card ${cls}">
              ${makeSvgGauge(pct)}
              <div class="dw-partition-info">
                <div class="dw-partition-label">${esc(p.label)}</div>
                <div class="dw-partition-path">${esc(p.root_path)}</div>
                <div class="dw-partition-sizes">${formatBytesShort(p.used_bytes)} / ${formatBytesShort(p.total_bytes)}</div>
                <div class="dw-partition-free">${formatBytesShort(p.free_bytes)} free</div>
                ${top3html}
              </div>
            </div>`;
        }).join('');

    // --- KPI cards ---
    const kpiCards = `
      <div class="dw-kpi-card">
        <div class="dw-kpi-label">Total Tracked</div>
        <div class="dw-kpi-value">${formatBytesShort(totalSize)}</div>
        <div class="dw-kpi-sub">${totalScans} scan${totalScans !== 1 ? 's' : ''} · ${partitions.length} root${partitions.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="dw-kpi-card">
        <div class="dw-kpi-label">Directories</div>
        <div class="dw-kpi-value">${totalDirs > 0 ? totalDirs.toLocaleString() : '—'}</div>
        <div class="dw-kpi-sub">currently tracked</div>
      </div>
      <div class="dw-kpi-card${topGrower ? ' dw-kpi-card--warn' : ''}">
        <div class="dw-kpi-label">Biggest Grower (7d)</div>
        <div class="dw-kpi-value${topGrower ? ' up' : ''}">${topGrower ? '+' + formatBytesShort(topGrower.growth_bytes) : '—'}</div>
        <div class="dw-kpi-sub dw-mono text-truncate" title="${esc(topGrower?.path)}">${esc(topGrower?.path || 'No growth data')}</div>
      </div>
      <div class="dw-kpi-card${alert_count > 0 ? ' dw-kpi-card--crit' : anomaly_count > 0 ? ' dw-kpi-card--warn' : ''}">
        <div class="dw-kpi-label">Active Issues</div>
        <div class="dw-kpi-value${alert_count > 0 ? ' crit' : anomaly_count > 0 ? ' warn' : ''}">${alert_count + anomaly_count > 0 ? alert_count + anomaly_count : '—'}</div>
        <div class="dw-kpi-sub">${alert_count > 0 ? `${alert_count} alert${alert_count !== 1 ? 's' : ''}` + (anomaly_count > 0 ? ` · ${anomaly_count} spike${anomaly_count !== 1 ? 's' : ''}` : '') : anomaly_count > 0 ? `${anomaly_count} growth spike${anomaly_count !== 1 ? 's' : ''}` : 'All clear'}</div>
      </div>`;

    // --- Bar list: top dirs ---
    const maxSize = top_dirs[0]?.size_bytes || 1;
    const topDirsHtml = top_dirs.length === 0
      ? '<div class="dw-empty">No data yet</div>'
      : top_dirs.slice(0, 12).map(d => {
          const pct = (d.size_bytes / maxSize * 100).toFixed(1);
          const name = d.path.split('/').filter(Boolean).slice(-2).join('/') || d.path;
          return `
            <div class="dw-barlist-item" data-path="${esc(d.path)}">
              <div class="dw-barlist-meta">
                <span class="dw-barlist-name" title="${esc(d.path)}">${esc(name)}</span>
                <span class="dw-barlist-val">${formatBytesShort(d.size_bytes)}</span>
              </div>
              <div class="dw-barlist-track">
                <div class="dw-barlist-fill" data-w="${pct}%"></div>
              </div>
            </div>`;
        }).join('');

    // --- Bar list: growers ---
    const maxGrowth = growers[0]?.growth_bytes || 1;
    const growersHtml = growers.length === 0
      ? '<div class="dw-empty">No growth data for the past 7 days</div>'
      : growers.slice(0, 10).map(g => {
          const pct = (g.growth_bytes / maxGrowth * 100).toFixed(1);
          const name = g.path.split('/').filter(Boolean).slice(-2).join('/') || g.path;
          return `
            <div class="dw-barlist-item" data-path="${esc(g.path)}">
              <div class="dw-barlist-meta">
                <span class="dw-barlist-name" title="${esc(g.path)}">${esc(name)}</span>
                <span class="dw-barlist-val up">+${formatBytesShort(g.growth_bytes)}</span>
              </div>
              <div class="dw-barlist-track">
                <div class="dw-barlist-fill up" data-w="${pct}%"></div>
              </div>
            </div>`;
        }).join('');

    // --- Recent alerts ---
    const alertsHtml = recent_alerts.length === 0 ? '' : `
      <div class="dw-panel mt-4">
        <div class="dw-panel-header">
          <span class="dw-panel-title"><i class="bi bi-bell me-1 text-danger"></i> Active Alerts</span>
          <a href="#/alerts" class="dw-panel-link">View all →</a>
        </div>
        ${recent_alerts.map(a => `
          <div class="dw-alert-row">
            <i class="bi bi-exclamation-circle flex-shrink-0" style="color:var(--dw-crit)"></i>
            <div class="flex-grow-1 overflow-hidden">
              <div class="dw-alert-row-path">${esc(a.path)}</div>
              <div class="dw-alert-row-msg">${esc(a.rule_name)} — ${esc(a.message)}</div>
            </div>
            <span class="dw-time-ago">${relativeTime(a.timestamp)}</span>
          </div>`).join('')}
      </div>`;

    container.innerHTML = `
      ${banner}
      <div class="dw-section-label">Storage Health</div>
      <div class="dw-partition-row">${partitionCards}</div>

      <div class="dw-kpi-row">${kpiCards}</div>

      <div class="dw-charts-row">
        <div class="dw-panel">
          <div class="dw-panel-header">
            <span class="dw-panel-title">Largest Directories</span>
            <a href="#/browse" class="dw-panel-link">Browse →</a>
          </div>
          <div class="dw-panel-body"><div class="dw-barlist">${topDirsHtml}</div></div>
        </div>
        <div class="dw-panel">
          <div class="dw-panel-header">
            <span class="dw-panel-title">Biggest Growers — 7 days</span>
            <a href="#/growth-spikes" class="dw-panel-link">Details →</a>
          </div>
          <div class="dw-panel-body"><div class="dw-barlist">${growersHtml}</div></div>
        </div>
      </div>
      ${alertsHtml}`;

    // Animate bars and gauges after paint
    requestAnimationFrame(() => requestAnimationFrame(() => {
      container.querySelectorAll('.dw-barlist-fill[data-w]').forEach(el => {
        el.style.width = el.dataset.w;
      });
      container.querySelectorAll('.dw-gauge-arc[data-offset]').forEach(el => {
        el.style.strokeDashoffset = el.dataset.offset;
      });
    }));

    // Make bar items navigable
    container.querySelectorAll('.dw-barlist-item[data-path]').forEach(el => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => {
        const p = el.dataset.path;
        location.hash = '#/browse' + (p.startsWith('/') ? p : '/' + p);
      });
    });

  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load dashboard: ${esc(e.message)}</div>`;
  }
}

function anomalyDetail(type, details) {
  if (type === 'growth_spike') {
    return `${formatBytesShort(details.previous_size)} → ${formatBytesShort(details.current_size)} (+${details.growth_percent}%)`;
  }
  return JSON.stringify(details);
}

// ============================================================
// View: Browse
// ============================================================

let _browseSort     = 'size';
let _browseTrendDays = 90;
let _browseDirs     = [];
let _browseSelected = null;
let _trendReqId     = 0;

async function renderBrowse(container, pathFromHash) {
  const targetPath = pathFromHash ? '/' + pathFromHash : '/';
  container.innerHTML = spinner();

  let roots = [];
  try {
    const [settings, partitions] = await Promise.all([GET('/api/settings'), GET('/api/partitions')]);
    _browseTrendDays = settings.display?.default_time_range_days || 90;
    roots = partitions || [];
  } catch (_) {}

  if (targetPath === '/' && roots.length > 0 && !roots.find(r => r.root_path === '/')) {
    location.hash = '#/browse' + roots[0].root_path;
    return;
  }

  const sortedRoots = [...roots].sort((a, b) => b.root_path.length - a.root_path.length);
  const currentRoot = sortedRoots.find(r => {
    const rp = r.root_path;
    return targetPath === rp || targetPath.startsWith(rp === '/' ? '/' : rp + '/');
  }) || roots[0] || { root_path: '/', label: '/' };

  const rootPickerHtml = roots.length > 1 ? `
    <div class="dw-root-picker">
      <label>Root:</label>
      <select class="form-select form-select-sm dw-mono" id="browseRootPicker" style="width:auto;max-width:280px">
        ${roots.map(r => `<option value="${esc(r.root_path)}"${r.root_path === currentRoot.root_path ? ' selected' : ''}>${esc(r.label || r.root_path)}</option>`).join('')}
      </select>
    </div>` : '';

  container.innerHTML = `
    ${rootPickerHtml}
    <div id="browseBreadcrumb" class="dw-breadcrumb"></div>
    <div class="dw-browse-grid">
      <div class="dw-panel" style="overflow:hidden">
        <div class="dw-sort-row">
          <span class="dw-sort-label">Sort by:</span>
          <button class="dw-sort-btn ${_browseSort==='size'?'active':''}" id="sortBySize">Size</button>
          <button class="dw-sort-btn ${_browseSort==='name'?'active':''}" id="sortByName">Name</button>
        </div>
        <div id="browseDirList" style="max-height:70vh;overflow-y:auto">${spinner()}</div>
      </div>
      <div class="dw-panel">
        <div class="dw-panel-header">
          <span class="dw-panel-title" id="browseTrendTitle">Select a directory to view trend</span>
          <div class="dw-range-group" id="trendRangeGroup">
            <button class="dw-range-btn" data-days="7">7d</button>
            <button class="dw-range-btn" data-days="30">30d</button>
            <button class="dw-range-btn ${_browseTrendDays===90?'active':''}" data-days="90">90d</button>
            <button class="dw-range-btn" data-days="365">1y</button>
            <button class="dw-range-btn" data-days="3650">All</button>
          </div>
        </div>
        <div class="dw-panel-body">
          <div id="browseTrendChart" class="dw-chart-container">
            <div class="dw-chart-placeholder">
              <span>Click <i class="bi bi-graph-up"></i> on a directory to see its trend</span>
            </div>
          </div>
          <div id="browseTrendSummary" class="text-center small mt-1" style="color:var(--dw-text2)"></div>
        </div>
      </div>
    </div>`;

  buildBreadcrumb(targetPath, currentRoot);

  if (roots.length > 1) {
    document.getElementById('browseRootPicker').addEventListener('change', e => {
      const rp = e.target.value;
      location.hash = '#/browse' + (rp === '/' ? '' : rp);
    });
  }

  document.getElementById('sortBySize').addEventListener('click', () => {
    _browseSort = 'size';
    document.getElementById('sortBySize').classList.add('active');
    document.getElementById('sortByName').classList.remove('active');
    renderDirList(targetPath);
  });
  document.getElementById('sortByName').addEventListener('click', () => {
    _browseSort = 'name';
    document.getElementById('sortByName').classList.add('active');
    document.getElementById('sortBySize').classList.remove('active');
    renderDirList(targetPath);
  });
  document.getElementById('trendRangeGroup').addEventListener('click', e => {
    const btn = e.target.closest('[data-days]');
    if (!btn) return;
    _browseTrendDays = parseInt(btn.dataset.days);
    document.querySelectorAll('#trendRangeGroup .dw-range-btn').forEach(b => b.classList.toggle('active', b === btn));
    if (_browseSelected) renderTrendChart(_browseSelected);
  });

  await renderDirList(targetPath);
  renderTrendChart(targetPath);
}

function buildBreadcrumb(path, currentRoot) {
  const el = document.getElementById('browseBreadcrumb');
  if (!el) return;
  const rp = currentRoot.root_path;
  const rootLabel = currentRoot.label || rp;
  const rootHash = '#/browse' + (rp === '/' ? '' : rp);

  let rel = path;
  if (rp !== '/' && path.startsWith(rp)) rel = path.slice(rp.length);
  const parts = rel.split('/').filter(Boolean);

  let html = `<div class="dw-bc-seg"><a class="dw-bc-link" href="${rootHash}">${esc(rootLabel)}</a></div>`;
  let cum = rp === '/' ? '' : rp;
  for (let i = 0; i < parts.length; i++) {
    cum += '/' + parts[i];
    html += `<span class="dw-bc-sep">›</span>`;
    if (i === parts.length - 1) {
      html += `<div class="dw-bc-seg"><span class="dw-bc-current">${esc(parts[i])}</span></div>`;
    } else {
      html += `<div class="dw-bc-seg"><a class="dw-bc-link" href="#/browse${cum}">${esc(parts[i])}</a></div>`;
    }
  }
  el.innerHTML = html;
}

async function renderDirList(path) {
  const listEl = document.getElementById('browseDirList');
  if (!listEl) return;
  listEl.innerHTML = spinner();
  _browseSelected = null;

  try {
    let dirs = await GET('/api/tree?path=' + encodeURIComponent(path));
    if (_browseSort === 'name') dirs.sort((a, b) => a.name.localeCompare(b.name));

    if (dirs.length === 0) {
      listEl.innerHTML = '<div class="dw-dir-empty"><i class="bi bi-folder2 d-block mb-2" style="font-size:1.5rem;opacity:.4"></i>No subdirectories found</div>';
      return;
    }

    _browseDirs = dirs;
    const maxBytes = dirs[0]?.size_bytes || 1;

    const html = `<div class="dw-dir-list" id="dirListInner">` +
      dirs.map((d, i) => {
        const pct = ((d.size_bytes / maxBytes) * 100).toFixed(1);
        const delta = d.change_7d;
        const deltaCls = delta == null ? 'flat' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
        const deltaStr = delta == null ? '—' : delta === 0 ? '±0' : (delta > 0 ? '▲ ' : '▼ ') + formatBytesShort(Math.abs(delta));
        return `<div class="dw-dir-row" data-path="${esc(d.path)}" data-idx="${i}" tabindex="0" role="button" aria-label="${esc(d.name)}">
          <i class="bi bi-folder-fill dw-folder-icon"></i>
          <div class="dw-dir-name-col">
            <span class="dw-dir-name" title="${esc(d.path)}">${esc(d.name)}</span>
            <div class="dw-dir-bar-track"><div class="dw-dir-bar-fill" data-w="${pct}%"></div></div>
          </div>
          <span class="dw-dir-size">${formatBytesShort(d.size_bytes)}</span>
          <span class="dw-dir-delta ${deltaCls}">${deltaStr}</span>
          <button class="dw-btn-icon dw-trend-btn" title="View trend" tabindex="-1"><i class="bi bi-graph-up"></i></button>
        </div>`;
      }).join('') + '</div>';

    listEl.innerHTML = html;

    // Animate bars
    requestAnimationFrame(() => requestAnimationFrame(() => {
      listEl.querySelectorAll('.dw-dir-bar-fill[data-w]').forEach(el => {
        el.style.width = el.dataset.w;
      });
    }));

    // Keyboard + click navigation
    let selectedIdx = -1;
    const rows = () => [...listEl.querySelectorAll('.dw-dir-row')];

    function selectRow(idx) {
      const all = rows();
      all.forEach(r => r.classList.remove('selected'));
      if (idx >= 0 && idx < all.length) {
        all[idx].classList.add('selected');
        all[idx].scrollIntoView({ block: 'nearest' });
        selectedIdx = idx;
        _browseSelected = all[idx].dataset.path;
        renderTrendChart(_browseSelected);
      }
    }

    listEl.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); selectRow(Math.min(selectedIdx + 1, rows().length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); selectRow(Math.max(selectedIdx - 1, 0)); }
      else if (e.key === 'Enter' && selectedIdx >= 0) {
        const p = rows()[selectedIdx]?.dataset.path;
        if (p) { const hp = p.startsWith('/') ? p.slice(1) : p; location.hash = '#/browse/' + hp; }
      } else if (e.key === 'Backspace') {
        const parentPath = path.split('/').slice(0, -1).join('/') || '/';
        const hp = parentPath.startsWith('/') ? parentPath.slice(1) : parentPath;
        location.hash = '#/browse' + (hp ? '/' + hp : '');
      }
    });

    rows().forEach((el, i) => {
      el.addEventListener('click', () => {
        const p = el.dataset.path;
        const hp = p.startsWith('/') ? p.slice(1) : p;
        location.hash = '#/browse/' + hp;
      });
      el.querySelector('.dw-trend-btn').addEventListener('click', e => {
        e.stopPropagation();
        selectRow(i);
      });
      el.addEventListener('focus', () => {
        selectRow(i);
      });
    });

  } catch (e) {
    listEl.innerHTML = `<div class="alert alert-danger m-3 small">${esc(e.message)}</div>`;
  }
}

async function renderTrendChart(path) {
  // Stamp this request so stale in-flight fetches are discarded
  const reqId = ++_trendReqId;

  // Show spinner on the current element before fetch starts
  const initialEl = document.getElementById('browseTrendChart');
  if (!initialEl) return;
  const titleEl = document.getElementById('browseTrendTitle');
  if (titleEl) titleEl.textContent = path.split('/').filter(Boolean).slice(-1)[0] || '/';
  initialEl.innerHTML = spinner();

  let data;
  try {
    data = await GET(`/api/trend?path=${encodeURIComponent(path)}&days=${_browseTrendDays}`);
  } catch (e) {
    if (reqId !== _trendReqId) return; // stale
    const chartEl = document.getElementById('browseTrendChart');
    if (chartEl) chartEl.innerHTML = `<div class="alert alert-danger m-2 small">${esc(e.message)}</div>`;
    return;
  }

  // Discard if a newer request was issued while we were awaiting
  if (reqId !== _trendReqId) return;

  // Re-query DOM — browse view may have been rebuilt since the fetch started
  const chartEl = document.getElementById('browseTrendChart');
  const summaryEl = document.getElementById('browseTrendSummary');
  if (!chartEl) return;

  if (!data || data.length === 0) {
    try { Plotly.purge(chartEl); } catch (_) {}
    chartEl.innerHTML = '<div class="dw-chart-placeholder">No trend data for this directory</div>';
    if (summaryEl) summaryEl.textContent = '';
    return;
  }

  const isDark = document.documentElement.getAttribute('data-bs-theme') !== 'light';
  const plotBg  = isDark ? '#0e1c2f' : '#ffffff';
  const gridClr = isDark ? '#1a2d45' : '#e2e8f0';
  const fontClr = isDark ? '#7d97b8' : '#475569';
  const lineClr = isDark ? '#38bdf8' : '#0284c7';

  const xs = data.map(d => d.date);
  const ys = data.map(d => d.size_bytes);

  const traces = [{
    type: 'scatter', mode: 'lines+markers',
    x: xs, y: ys,
    line: { color: lineClr, width: 2 },
    marker: { color: lineClr, size: 4 },
    text: ys.map(v => formatBytesShort(v)),
    hovertemplate: '<b>%{text}</b><br>%{x}<extra></extra>',
    fill: 'tozeroy',
    fillcolor: isDark ? 'rgba(56,189,248,0.06)' : 'rgba(2,132,199,0.06)',
  }];

  const layout = {
    paper_bgcolor: plotBg, plot_bgcolor: plotBg,
    font: { color: fontClr, family: 'DM Sans, system-ui, sans-serif', size: 11 },
    margin: { l: 60, r: 16, t: 10, b: 40 },
    xaxis: { gridcolor: gridClr, zeroline: false, linecolor: gridClr },
    yaxis: { gridcolor: gridClr, tickformat: '.2s', zeroline: false, linecolor: gridClr },
  };

  // Always purge then newPlot — avoids mixing Plotly state with innerHTML content
  try { Plotly.purge(chartEl); } catch (_) {}
  chartEl.innerHTML = '';
  Plotly.newPlot(chartEl, traces, layout, { responsive: true, displayModeBar: false });

  if (summaryEl && data.length >= 2) {
    const first = data[0].size_bytes, last = data[data.length-1].size_bytes;
    const delta = last - first;
    const pct   = first > 0 ? (delta / first * 100).toFixed(1) : null;
    const sign  = delta >= 0 ? '+' : '';
    const cls   = delta > 0 ? 'dw-growth-up' : delta < 0 ? 'dw-growth-down' : '';
    summaryEl.innerHTML = `Over period: <span class="${cls}">${sign}${formatBytesShort(delta)}${pct != null ? ` (${sign}${pct}%)` : ''}</span>`;
  } else if (summaryEl) {
    summaryEl.textContent = '';
  }
}

// ============================================================
// View: Anomalies (Growth Spikes)
// ============================================================

let _anomalyFilter   = { acknowledged: 'false' };
let _anomalySelected = new Set();

async function renderAnomalies(container) {
  container.innerHTML = `
    <div class="d-flex align-items-center gap-3 mb-3 flex-wrap">
      <div class="dw-section-label mb-0">Growth Spikes</div>
      <select class="form-select form-select-sm" id="filterAnomalyAck" style="max-width:170px">
        <option value="false">Unacknowledged</option>
        <option value="true">Acknowledged</option>
        <option value="">All</option>
      </select>
      <button class="btn btn-sm btn-outline-warning ms-auto" id="btnBulkAck">Acknowledge selected</button>
    </div>
    <div class="dw-panel">
      <table class="table dw-table mb-0">
        <thead><tr>
          <th><input type="checkbox" id="ackSelectAll"></th>
          <th>Date</th><th>Path</th><th>Details</th><th>Status</th><th></th>
        </tr></thead>
        <tbody id="anomalyListBody">${tableSpinner(6)}</tbody>
      </table>
    </div>`;

  document.getElementById('filterAnomalyAck').value = _anomalyFilter.acknowledged;
  document.getElementById('filterAnomalyAck').addEventListener('change', e => { _anomalyFilter.acknowledged = e.target.value; loadAnomalyList(); });
  document.getElementById('ackSelectAll').addEventListener('change', e => {
    document.querySelectorAll('.anomaly-row-check').forEach(cb => { cb.checked = e.target.checked; });
    _anomalySelected = e.target.checked
      ? new Set([...document.querySelectorAll('.anomaly-row-check')].map(cb => cb.dataset.id))
      : new Set();
  });
  document.getElementById('btnBulkAck').addEventListener('click', bulkAckAnomalies);
  await loadAnomalyList();
}

async function loadAnomalyList() {
  const tbody = document.getElementById('anomalyListBody');
  if (!tbody) return;
  tbody.innerHTML = tableSpinner(6);
  _anomalySelected = new Set();
  let url = '/api/anomalies?limit=200';
  if (_anomalyFilter.acknowledged !== '') url += `&acknowledged=${_anomalyFilter.acknowledged}`;
  try {
    const rows = await GET(url);
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4" style="color:var(--dw-text2)">No growth spikes found</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(a => {
      const details = (() => { try { return JSON.parse(a.details || '{}'); } catch (_) { return {}; } })();
      return `<tr>
        <td><input type="checkbox" class="anomaly-row-check" data-id="${a.id}" ${_anomalySelected.has(String(a.id)) ? 'checked' : ''}></td>
        <td class="small dw-mono">${relativeTime(a.timestamp)}</td>
        <td class="dw-path dw-mono"><a href="#/browse${esc(a.path)}" class="text-accent text-decoration-none">${esc(a.path)}</a></td>
        <td class="small">${esc(anomalyDetail(a.type, details))}</td>
        <td>${a.acknowledged ? '<span class="badge bg-secondary">acked</span>' : '<span class="badge bg-warning text-dark">new</span>'}</td>
        <td>${a.acknowledged ? '' : `<button class="btn btn-sm btn-outline-secondary" onclick="ackAnomaly(${a.id}, this)">Ack</button>`}</td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('.anomaly-row-check').forEach(cb => {
      cb.addEventListener('change', e => {
        if (e.target.checked) _anomalySelected.add(e.target.dataset.id);
        else _anomalySelected.delete(e.target.dataset.id);
      });
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="alert alert-danger m-2">${esc(e.message)}</div></td></tr>`;
  }
}

async function ackAnomaly(id, btn) {
  btn.disabled = true;
  try {
    await POST(`/api/anomalies/${id}/acknowledge`);
    btn.closest('tr').remove();
    updateBadges();
  } catch (e) {
    showToast('Failed: ' + e.message, 'danger');
    btn.disabled = false;
  }
}

async function bulkAckAnomalies() {
  if (_anomalySelected.size === 0) { showToast('Select rows first', 'secondary'); return; }
  const ids = [..._anomalySelected];
  try {
    await Promise.all(ids.map(id => POST(`/api/anomalies/${id}/acknowledge`)));
    showToast(`Acknowledged ${ids.length} growth spike${ids.length !== 1 ? 's' : ''}`);
    updateBadges();
    await loadAnomalyList();
  } catch (e) {
    showToast('Error: ' + e.message, 'danger');
  }
}

// ============================================================
// View: Alerts
// ============================================================

let _alertFilter = { acknowledged: 'false' };

async function renderAlerts(container) {
  container.innerHTML = `
    <div class="d-flex align-items-center gap-3 mb-3 flex-wrap">
      <div class="dw-section-label mb-0">Alerts</div>
      <select class="form-select form-select-sm" id="filterAlertAck" style="max-width:170px">
        <option value="false">Unacknowledged</option>
        <option value="true">Acknowledged</option>
        <option value="">All</option>
      </select>
    </div>
    <div class="dw-panel">
      <table class="table dw-table mb-0">
        <thead><tr>
          <th>Date</th><th>Rule</th><th>Path</th><th>Message</th><th>Channels</th><th>Status</th><th></th>
        </tr></thead>
        <tbody id="alertListBody">${tableSpinner(7)}</tbody>
      </table>
    </div>`;

  document.getElementById('filterAlertAck').value = _alertFilter.acknowledged;
  document.getElementById('filterAlertAck').addEventListener('change', e => { _alertFilter.acknowledged = e.target.value; loadAlertList(); });
  await loadAlertList();
}

async function loadAlertList() {
  const tbody = document.getElementById('alertListBody');
  if (!tbody) return;
  tbody.innerHTML = tableSpinner(7);
  let url = '/api/alerts?limit=200';
  if (_alertFilter.acknowledged !== '') url += `&acknowledged=${_alertFilter.acknowledged}`;
  try {
    const rows = await GET(url);
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4" style="color:var(--dw-text2)">No alerts found</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(a => {
      const channels = (() => { try { return JSON.parse(a.notification_channels || '[]'); } catch (_) { return []; } })();
      return `<tr>
        <td class="small dw-mono">${relativeTime(a.timestamp)}</td>
        <td><span class="badge bg-primary">${esc(a.rule_name)}</span></td>
        <td class="dw-path dw-mono"><a href="#/browse${esc(a.path)}" class="text-accent text-decoration-none">${esc(a.path)}</a></td>
        <td class="small">${esc(a.message)}</td>
        <td>${channels.map(c => `<span class="badge bg-secondary me-1">${esc(c)}</span>`).join('') || '<span style="color:var(--dw-text3)">—</span>'}</td>
        <td>${a.acknowledged ? '<span class="badge bg-secondary">acked</span>' : '<span class="badge bg-danger">active</span>'}</td>
        <td>${a.acknowledged ? '' : `<button class="btn btn-sm btn-outline-secondary" onclick="ackAlert(${a.id}, this)">Ack</button>`}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="alert alert-danger m-2">${esc(e.message)}</div></td></tr>`;
  }
}

async function ackAlert(id, btn) {
  btn.disabled = true;
  try {
    await POST(`/api/alerts/${id}/acknowledge`);
    btn.closest('tr').querySelector('td:nth-last-child(2)').innerHTML = '<span class="badge bg-secondary">acked</span>';
    btn.remove();
    updateBadges();
  } catch (e) {
    showToast('Failed: ' + e.message, 'danger');
    btn.disabled = false;
  }
}

// ============================================================
// View: Scan History
// ============================================================

let _scanOffset   = 0;
const _scanPageSize = 50;
let _scanTotal    = 0;

async function renderScans(container) {
  _scanOffset = 0;
  container.innerHTML = `
    <div class="dw-section-label">Scan History</div>
    <div class="dw-panel">
      <table class="table dw-table mb-0">
        <thead><tr>
          <th>Timestamp</th><th>Root</th><th>Duration</th><th>Dirs</th><th>Dirs/min</th><th>Total Size</th><th>Errors</th>
        </tr></thead>
        <tbody id="scanListBody">${tableSpinner(7)}</tbody>
      </table>
      <div class="d-flex justify-content-between align-items-center p-3 border-top" id="scanPagination" style="display:none!important;border-color:var(--dw-border)!important"></div>
    </div>
    <div class="modal fade" id="errorModal" tabindex="-1">
      <div class="modal-dialog modal-lg"><div class="modal-content">
        <div class="modal-header"><h5 class="modal-title">Scan Errors</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
        <div class="modal-body"><pre id="errorModalBody" class="small dw-mono" style="max-height:400px;overflow-y:auto;color:var(--dw-text)"></pre></div>
      </div></div>
    </div>`;
  await loadScanList();
}

async function loadScanList() {
  const tbody = document.getElementById('scanListBody');
  const pag   = document.getElementById('scanPagination');
  if (!tbody) return;
  tbody.innerHTML = tableSpinner(7);
  try {
    const data = await GET(`/api/scans?limit=${_scanPageSize}&offset=${_scanOffset}`);
    _scanTotal = data.total;
    const rows = data.scans;
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4" style="color:var(--dw-text2)">No scans recorded yet</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(s => {
      const meta   = (() => { try { return JSON.parse(s.metadata || '{}'); } catch (_) { return {}; } })();
      const errors = meta.errors || [];
      const errCount = s.errors || 0;
      const dirs   = s.directories_counted || 0;
      const secs   = s.duration_seconds || 0;
      const dpm    = secs > 0 ? Math.round(dirs / (secs / 60)).toLocaleString() : '—';
      const errCell = errCount > 0
        ? `<button class="btn btn-sm btn-outline-danger" onclick="showScanErrors(${JSON.stringify(JSON.stringify(errors))})">${errCount} error${errCount !== 1 ? 's' : ''}</button>`
        : '<span style="color:var(--dw-text3)">—</span>';
      return `<tr>
        <td class="dw-mono small">${relativeTime(s.timestamp)}<span class="ms-1 text-muted small" style="font-family:inherit" title="${formatTs(s.timestamp)}">·</span></td>
        <td><span class="badge bg-secondary">${esc(s.label || s.root_path)}</span></td>
        <td class="dw-mono small">${formatDuration(s.duration_seconds)}</td>
        <td class="dw-mono small">${dirs.toLocaleString()}</td>
        <td class="dw-mono small">${dpm}</td>
        <td class="dw-mono small">${formatBytesShort(s.total_size_bytes)}</td>
        <td>${errCell}</td>
      </tr>`;
    }).join('');
    if (_scanTotal > _scanPageSize) {
      pag.style.removeProperty('display');
      const page = Math.floor(_scanOffset / _scanPageSize) + 1;
      const total = Math.ceil(_scanTotal / _scanPageSize);
      pag.innerHTML = `
        <button class="btn btn-sm btn-outline-secondary" id="scanPrev" ${_scanOffset === 0 ? 'disabled' : ''}>← Prev</button>
        <span class="small" style="color:var(--dw-text2)">Page ${page} of ${total}</span>
        <button class="btn btn-sm btn-outline-secondary" id="scanNext" ${_scanOffset + _scanPageSize >= _scanTotal ? 'disabled' : ''}>Next →</button>`;
      document.getElementById('scanPrev').addEventListener('click', () => { _scanOffset -= _scanPageSize; loadScanList(); });
      document.getElementById('scanNext').addEventListener('click', () => { _scanOffset += _scanPageSize; loadScanList(); });
    }
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="alert alert-danger m-2">${esc(e.message)}</div></td></tr>`;
  }
}

function showScanErrors(errorsJson) {
  const errors = JSON.parse(errorsJson);
  document.getElementById('errorModalBody').textContent = errors.join('\n') || 'No error details';
  new bootstrap.Modal(document.getElementById('errorModal')).show();
}

// ============================================================
// View: Settings
// ============================================================

let _settings = null;

async function renderSettings(container) {
  container.innerHTML = spinner();
  try {
    _settings = await GET('/api/settings');
  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load settings: ${esc(e.message)}</div>`;
    return;
  }

  container.innerHTML = `
    <div class="dw-settings">
    <div class="accordion" id="settingsAccordion">

      <div class="accordion-item">
        <h2 class="accordion-header">
          <button class="accordion-button" type="button" data-bs-toggle="collapse" data-bs-target="#secRoots">
            <i class="bi bi-hdd me-2"></i> Scan Roots
          </button>
        </h2>
        <div id="secRoots" class="accordion-collapse collapse show" data-bs-parent="#settingsAccordion">
          <div class="accordion-body">
            <div id="rootsList"></div>
            <button class="btn btn-sm btn-outline-accent mt-2" id="btnAddRoot"><i class="bi bi-plus-circle me-1"></i>Add Root</button>
            <div class="mt-3"><button class="btn btn-accent btn-sm" onclick="saveSection('roots')">Save Scan Roots</button></div>
          </div>
        </div>
      </div>

      <div class="accordion-item">
        <h2 class="accordion-header">
          <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#secRetention">
            <i class="bi bi-archive me-2"></i> Data Retention
          </button>
        </h2>
        <div id="secRetention" class="accordion-collapse collapse" data-bs-parent="#settingsAccordion">
          <div class="accordion-body">
            <div class="row g-3">
              <div class="col-md-4">
                <label class="form-label">Keep data for (days)</label>
                <input type="number" class="form-control" id="cfgKeepDays" min="1" value="${esc(_settings.retention?.keep_days ?? 365)}" />
              </div>
              <div class="col-md-4 d-flex align-items-end">
                <div class="form-check">
                  <input class="form-check-input" type="checkbox" id="cfgCleanupAfterScan" ${_settings.retention?.cleanup_after_scan ? 'checked' : ''} />
                  <label class="form-check-label" for="cfgCleanupAfterScan">Cleanup after each scan</label>
                </div>
              </div>
            </div>
            <div class="mt-3"><button class="btn btn-accent btn-sm" onclick="saveSection('retention')">Save Retention</button></div>
          </div>
        </div>
      </div>

      <div class="accordion-item">
        <h2 class="accordion-header">
          <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#secEmail">
            <i class="bi bi-envelope me-2"></i> Email Notifications
          </button>
        </h2>
        <div id="secEmail" class="accordion-collapse collapse" data-bs-parent="#settingsAccordion">
          <div class="accordion-body">
            <div class="form-check mb-3">
              <input class="form-check-input" type="checkbox" id="cfgEmailEnabled" ${_settings.email?.enabled ? 'checked' : ''} />
              <label class="form-check-label" for="cfgEmailEnabled">Enable email notifications</label>
            </div>
            <div class="row g-3">
              <div class="col-md-6"><label class="form-label">SMTP Host</label>
                <input type="text" class="form-control" id="cfgSmtpHost" value="${esc(_settings.email?.smtp_host ?? '')}" /></div>
              <div class="col-md-2"><label class="form-label">Port</label>
                <input type="number" class="form-control" id="cfgSmtpPort" value="${esc(_settings.email?.smtp_port ?? 587)}" /></div>
              <div class="col-md-4 d-flex align-items-end pb-1">
                <div class="form-check">
                  <input class="form-check-input" type="checkbox" id="cfgSmtpTls" ${_settings.email?.smtp_tls !== false ? 'checked' : ''} />
                  <label class="form-check-label" for="cfgSmtpTls">Use STARTTLS</label>
                </div>
              </div>
              <div class="col-md-6"><label class="form-label">SMTP Username</label>
                <input type="text" class="form-control" id="cfgSmtpUser" value="${esc(_settings.email?.smtp_user ?? '')}" /></div>
              <div class="col-md-6"><label class="form-label">SMTP Password</label>
                <input type="password" class="form-control" id="cfgSmtpPassword" value="${esc(_settings.email?.smtp_password ?? '')}" /></div>
              <div class="col-md-6"><label class="form-label">From Address</label>
                <input type="email" class="form-control" id="cfgFromAddress" value="${esc(_settings.email?.from_address ?? '')}" /></div>
              <div class="col-md-6"><label class="form-label">To Addresses (one per line)</label>
                <textarea class="form-control dw-mono" id="cfgToAddresses" rows="3">${esc((_settings.email?.to_addresses ?? []).join('\n'))}</textarea></div>
            </div>
            <div class="mt-3 d-flex gap-2">
              <button class="btn btn-accent btn-sm" onclick="saveSection('email')">Save Email</button>
              <button class="btn btn-outline-secondary btn-sm" onclick="testEmail()">Send Test</button>
            </div>
          </div>
        </div>
      </div>

      <div class="accordion-item">
        <h2 class="accordion-header">
          <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#secNtfy">
            <i class="bi bi-bell me-2"></i> ntfy Notifications
          </button>
        </h2>
        <div id="secNtfy" class="accordion-collapse collapse" data-bs-parent="#settingsAccordion">
          <div class="accordion-body">
            <div class="form-check mb-3">
              <input class="form-check-input" type="checkbox" id="cfgNtfyEnabled" ${_settings.ntfy?.enabled ? 'checked' : ''} />
              <label class="form-check-label" for="cfgNtfyEnabled">Enable ntfy notifications</label>
            </div>
            <div class="row g-3">
              <div class="col-md-6"><label class="form-label">Server URL</label>
                <input type="text" class="form-control" id="cfgNtfyUrl" value="${esc(_settings.ntfy?.server_url ?? 'https://ntfy.sh')}" /></div>
              <div class="col-md-6"><label class="form-label">Topic</label>
                <input type="text" class="form-control" id="cfgNtfyTopic" value="${esc(_settings.ntfy?.topic ?? '')}" /></div>
              <div class="col-md-4"><label class="form-label">Priority</label>
                <select class="form-select" id="cfgNtfyPriority">
                  ${['min','low','default','high','urgent'].map(p => `<option ${(_settings.ntfy?.priority ?? 'default') === p ? 'selected' : ''}>${p}</option>`).join('')}
                </select></div>
              <div class="col-md-8"><label class="form-label">Auth Token</label>
                <input type="password" class="form-control" id="cfgNtfyToken" value="${esc(_settings.ntfy?.auth_token ?? '')}" /></div>
              <div class="col-md-6"><label class="form-label">Username</label>
                <input type="text" class="form-control" id="cfgNtfyUsername" value="${esc(_settings.ntfy?.username ?? '')}" autocomplete="off" /></div>
              <div class="col-md-6"><label class="form-label">Password</label>
                <input type="password" class="form-control" id="cfgNtfyPassword" value="${esc(_settings.ntfy?.password ?? '')}" /></div>
            </div>
            <div class="mt-3 d-flex gap-2">
              <button class="btn btn-accent btn-sm" onclick="saveSection('ntfy')">Save ntfy</button>
              <button class="btn btn-outline-secondary btn-sm" onclick="testNtfy()">Send Test</button>
            </div>
          </div>
        </div>
      </div>

      <div class="accordion-item">
        <h2 class="accordion-header">
          <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#secAlerts">
            <i class="bi bi-exclamation-diamond me-2"></i> Alert Rules
          </button>
        </h2>
        <div id="secAlerts" class="accordion-collapse collapse" data-bs-parent="#settingsAccordion">
          <div class="accordion-body">
            <div id="alertRulesList"></div>
            <button class="btn btn-sm btn-outline-secondary mt-2" id="btnAddRule"><i class="bi bi-plus-circle me-1"></i>Add Rule</button>
            <div class="mt-3"><button class="btn btn-accent btn-sm" onclick="saveSection('alerts')">Save Alert Rules</button></div>
          </div>
        </div>
      </div>

      <div class="accordion-item">
        <h2 class="accordion-header">
          <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#secGrowthSpike">
            <i class="bi bi-graph-up-arrow me-2"></i> Growth Spike Detection
          </button>
        </h2>
        <div id="secGrowthSpike" class="accordion-collapse collapse" data-bs-parent="#settingsAccordion">
          <div class="accordion-body">
            <p class="small mb-3" style="color:var(--dw-text2)">A spike is flagged when a directory grows by <em>at least</em> the minimum size <em>and</em> minimum percentage between scans.</p>
            <div class="row g-3">
              <div class="col-md-4"><label class="form-label">Min growth (MB)</label>
                <input type="number" class="form-control" id="cfgSpikeMinMB" min="1" value="${Math.round((_settings.anomalies?.growth_spike?.min_bytes ?? 104857600) / 1048576)}" /></div>
              <div class="col-md-4"><label class="form-label">Min growth (%)</label>
                <input type="number" class="form-control" id="cfgSpikeMinPct" min="1" max="100" value="${Math.round((_settings.anomalies?.growth_spike?.min_ratio ?? 0.20) * 100)}" /></div>
              <div class="col-md-4"><label class="form-label">Notify via</label>
                <div class="form-check"><input class="form-check-input" type="checkbox" id="cfgSpikeNotifyEmail" ${(_settings.anomalies?.growth_spike?.notify ?? []).includes('email') ? 'checked' : ''} /><label class="form-check-label" for="cfgSpikeNotifyEmail">Email</label></div>
                <div class="form-check"><input class="form-check-input" type="checkbox" id="cfgSpikeNotifyNtfy" ${(_settings.anomalies?.growth_spike?.notify ?? []).includes('ntfy') ? 'checked' : ''} /><label class="form-check-label" for="cfgSpikeNotifyNtfy">ntfy</label></div>
              </div>
            </div>
            <div class="mt-3"><button class="btn btn-accent btn-sm" onclick="saveSection('anomalies')">Save</button></div>
          </div>
        </div>
      </div>

      <div class="accordion-item">
        <h2 class="accordion-header">
          <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#secDisplay">
            <i class="bi bi-palette me-2"></i> Display
          </button>
        </h2>
        <div id="secDisplay" class="accordion-collapse collapse" data-bs-parent="#settingsAccordion">
          <div class="accordion-body">
            <div class="row g-3">
              <div class="col-md-4"><label class="form-label">Default time range (days)</label>
                <input type="number" class="form-control" id="cfgDefaultDays" min="1" value="${esc(_settings.display?.default_time_range_days ?? 90)}" /></div>
              <div class="col-md-4"><label class="form-label">Default view</label>
                <select class="form-select" id="cfgDefaultView">
                  ${['dashboard','browse','growth-spikes','alerts','scans','settings'].map(v =>
                    `<option ${(_settings.display?.default_view ?? 'dashboard') === v ? 'selected' : ''} value="${v}">${v}</option>`
                  ).join('')}
                </select></div>
              <div class="col-md-4"><label class="form-label">Theme</label>
                <select class="form-select" id="cfgTheme">
                  <option ${(_settings.display?.theme ?? 'dark') === 'dark' ? 'selected' : ''} value="dark">Dark</option>
                  <option ${(_settings.display?.theme ?? 'dark') === 'light' ? 'selected' : ''} value="light">Light</option>
                </select></div>
            </div>
            <div class="mt-3"><button class="btn btn-accent btn-sm" onclick="saveSection('display')">Save Display</button></div>
          </div>
        </div>
      </div>

      <div class="accordion-item">
        <h2 class="accordion-header">
          <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#secSecurity">
            <i class="bi bi-shield-lock me-2"></i> Security
          </button>
        </h2>
        <div id="secSecurity" class="accordion-collapse collapse" data-bs-parent="#settingsAccordion">
          <div class="accordion-body">
            <div class="row g-3">
              <div class="col-md-4"><label class="form-label">Current password</label>
                <input type="password" class="form-control" id="cfgCurrentPw" /></div>
              <div class="col-md-4"><label class="form-label">New password</label>
                <input type="password" class="form-control" id="cfgNewPw" /></div>
              <div class="col-md-4"><label class="form-label">Confirm new password</label>
                <input type="password" class="form-control" id="cfgNewPwConfirm" /></div>
            </div>
            <div class="mt-3"><button class="btn btn-accent btn-sm" onclick="changePassword()">Change Password</button></div>
          </div>
        </div>
      </div>

    </div>
    </div>

    <!-- Root editor modal -->
    <div class="modal fade" id="rootModal" tabindex="-1">
      <div class="modal-dialog"><div class="modal-content">
        <div class="modal-header"><h5 class="modal-title" id="rootModalTitle">Scan Root</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
        <div class="modal-body">
          <div class="mb-3"><label class="form-label">Path</label>
            <input type="text" class="form-control dw-mono" id="rootModalPath" placeholder="/mnt/data" /></div>
          <div class="mb-3"><label class="form-label">Label</label>
            <input type="text" class="form-control" id="rootModalLabel" placeholder="My Drive" /></div>
          <div class="mb-3"><label class="form-label">Drive type</label>
            <div class="d-flex gap-4">
              <div class="form-check"><input class="form-check-input" type="radio" name="rootDriveType" id="rootTypeLocal" value="local">
                <label class="form-check-label" for="rootTypeLocal">Local <span class="text-muted small">(main system drive)</span></label></div>
              <div class="form-check"><input class="form-check-input" type="radio" name="rootDriveType" id="rootTypeAttached" value="attached">
                <label class="form-check-label" for="rootTypeAttached">Attached <span class="text-muted small">(external / mounted)</span></label></div>
            </div>
          </div>
          <div class="mb-3"><label class="form-label">Excludes (one path per line)</label>
            <textarea class="form-control dw-mono" id="rootModalExcludes" rows="4" placeholder="/proc&#10;/sys"></textarea></div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
          <button type="button" class="btn btn-accent" id="rootModalSave">Save</button>
        </div>
      </div></div>
    </div>

    <!-- Alert rule editor modal -->
    <div class="modal fade" id="ruleModal" tabindex="-1">
      <div class="modal-dialog"><div class="modal-content">
        <div class="modal-header"><h5 class="modal-title" id="ruleModalTitle">Alert Rule</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
        <div class="modal-body">
          <div class="mb-3"><label class="form-label">Rule name</label>
            <input type="text" class="form-control" id="ruleModalName" /></div>
          <div class="mb-3"><label class="form-label">Path</label>
            <input type="text" class="form-control dw-mono" id="ruleModalPath" /></div>
          <div class="mb-3"><label class="form-label">Type</label>
            <select class="form-select" id="ruleModalType">
              <option value="absolute_growth">Absolute growth</option>
              <option value="usage_percent">Disk usage %</option>
            </select></div>
          <div id="ruleThresholdBytes" class="mb-3"><label class="form-label">Threshold</label>
            <input type="text" class="form-control" id="ruleModalThresholdBytes" placeholder="e.g. 5 GB, 500 MB" /></div>
          <div id="ruleThresholdPct" class="mb-3 d-none"><label class="form-label">Threshold (%)</label>
            <input type="number" class="form-control" id="ruleModalThresholdPct" min="1" max="100" /></div>
          <div id="rulePeriodRow" class="mb-3"><label class="form-label">Period (days)</label>
            <input type="number" class="form-control" id="ruleModalPeriod" min="1" value="7" /></div>
          <div class="mb-3"><label class="form-label">Notify via</label>
            <div class="form-check"><input class="form-check-input" type="checkbox" id="ruleNotifyNtfy" value="ntfy"><label class="form-check-label" for="ruleNotifyNtfy">ntfy</label></div>
            <div class="form-check"><input class="form-check-input" type="checkbox" id="ruleNotifyEmail" value="email"><label class="form-check-label" for="ruleNotifyEmail">Email</label></div>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
          <button type="button" class="btn btn-accent" id="ruleModalSave">Save</button>
        </div>
      </div></div>
    </div>`;

  renderRootsList();
  renderAlertRulesList();
  document.getElementById('btnAddRoot').addEventListener('click', () => openRootModal(-1));
  document.getElementById('btnAddRule').addEventListener('click', () => openRuleModal(-1));
  document.getElementById('ruleModalType').addEventListener('change', e => {
    const isGrowth = e.target.value === 'absolute_growth';
    document.getElementById('ruleThresholdBytes').classList.toggle('d-none', !isGrowth);
    document.getElementById('ruleThresholdPct').classList.toggle('d-none', isGrowth);
    document.getElementById('rulePeriodRow').classList.toggle('d-none', !isGrowth);
  });
}

function renderRootsList() {
  const el = document.getElementById('rootsList');
  if (!el || !_settings) return;
  const roots = _settings.scan?.roots ?? [];
  if (roots.length === 0) {
    el.innerHTML = '<div class="small py-2" style="color:var(--dw-text2)">No scan roots configured.</div>';
    return;
  }
  const indexed = roots.map((r, i) => ({ ...r, _idx: i }));
  const local    = indexed.filter(r => r.type === 'local');
  const attached = indexed.filter(r => r.type === 'attached');
  const untyped  = indexed.filter(r => r.type !== 'local' && r.type !== 'attached');

  function rootItem(r, icon) {
    const excl = (r.exclude || []).length;
    return `<div class="dw-root-item">
      <i class="bi ${icon} text-accent flex-shrink-0"></i>
      <div class="flex-grow-1 overflow-hidden">
        <div class="dw-mono small">${esc(r.path)}</div>
        <div class="small" style="color:var(--dw-text2)">${r.label ? esc(r.label) + ' — ' : ''}${excl} exclude${excl !== 1 ? 's' : ''}</div>
      </div>
      <button class="btn btn-sm btn-outline-secondary" onclick="openRootModal(${r._idx})"><i class="bi bi-pencil"></i></button>
      <button class="btn btn-sm btn-outline-danger" onclick="removeRoot(${r._idx})"><i class="bi bi-trash"></i></button>
    </div>`;
  }

  let html = '';
  if (local.length === 0) html += '<div class="alert alert-warning small py-2 mb-2">No <strong>Local</strong> drive configured.</div>';
  else if (local.length > 1) html += '<div class="alert alert-warning small py-2 mb-2">More than one <strong>Local</strong> drive configured.</div>';
  if (local.length > 0) { html += '<div class="small fw-bold text-muted mb-1">Local Drive</div>'; html += local.map(r => rootItem(r, 'bi-hdd-fill')).join(''); }
  if (attached.length > 0) { html += `<div class="small fw-bold text-muted mb-1 ${local.length ? 'mt-3' : ''}">Attached Drives</div>`; html += attached.map(r => rootItem(r, 'bi-hdd')).join(''); }
  if (untyped.length > 0) { html += `<div class="small fw-bold text-muted mb-1 ${local.length || attached.length ? 'mt-3' : ''}">Unclassified</div>`; html += untyped.map(r => rootItem(r, 'bi-hdd')).join(''); }
  el.innerHTML = html;
}

// ============================================================
// Path autocomplete (shared by root modal + rule modal)
// ============================================================

function attachPathAutocomplete(input) {
  if (input.dataset.pathComplete) return;
  input.dataset.pathComplete = '1';

  let dropdown = null;
  let debounceTimer = null;
  let activeIdx = -1;

  function remove() { if (dropdown) { dropdown.remove(); dropdown = null; } activeIdx = -1; }

  function position() {
    if (!dropdown) return;
    const r = input.getBoundingClientRect();
    dropdown.style.top   = (r.bottom + window.scrollY) + 'px';
    dropdown.style.left  = (r.left + window.scrollX) + 'px';
    dropdown.style.width = r.width + 'px';
  }

  function show(suggestions) {
    remove();
    if (!suggestions.length) return;
    dropdown = document.createElement('div');
    dropdown.className = 'dw-autocomplete';
    suggestions.forEach(path => {
      const item = document.createElement('button');
      item.className = 'dw-autocomplete-item';
      item.textContent = path;
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        input.value = path + '/';
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => fetchSugg(input.value), 0);
      });
      dropdown.appendChild(item);
    });
    document.body.appendChild(dropdown);
    position();
  }

  async function fetchSugg(val) {
    if (!val) { remove(); return; }
    try {
      const r = await GET('/api/suggest?path=' + encodeURIComponent(val));
      if (document.activeElement === input) show(r || []);
    } catch (_) { remove(); }
  }

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => fetchSugg(input.value), 180);
  });
  input.addEventListener('keydown', e => {
    if (!dropdown) return;
    const items = [...dropdown.querySelectorAll('.dw-autocomplete-item')];
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx+1, items.length-1); items.forEach((b,i) => b.classList.toggle('active', i===activeIdx)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx-1, 0); items.forEach((b,i) => b.classList.toggle('active', i===activeIdx)); }
    else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); items[activeIdx].dispatchEvent(new MouseEvent('mousedown')); }
    else if (e.key === 'Escape') remove();
  });
  input.addEventListener('blur', () => setTimeout(remove, 150));
  window.addEventListener('scroll', position, { passive: true });
  window.addEventListener('resize', position, { passive: true });
}

function openRootModal(idx) {
  const roots = _settings.scan?.roots ?? [];
  const r = idx >= 0 ? roots[idx] : {};
  document.getElementById('rootModalTitle').textContent = idx >= 0 ? 'Edit Scan Root' : 'Add Scan Root';
  document.getElementById('rootModalPath').value     = r.path || '';
  attachPathAutocomplete(document.getElementById('rootModalPath'));
  document.getElementById('rootModalLabel').value    = r.label || '';
  document.getElementById('rootModalExcludes').value = (r.exclude || []).join('\n');
  const hasLocal = roots.some((x, i) => i !== idx && x.type === 'local');
  const driveType = r.type || (hasLocal ? 'attached' : 'local');
  document.getElementById('rootTypeLocal').checked    = driveType === 'local';
  document.getElementById('rootTypeAttached').checked = driveType !== 'local';
  const modal = new bootstrap.Modal(document.getElementById('rootModal'));
  document.getElementById('rootModalSave').onclick = () => {
    const path  = document.getElementById('rootModalPath').value.trim();
    const label = document.getElementById('rootModalLabel').value.trim();
    const excl  = document.getElementById('rootModalExcludes').value.split('\n').map(s => s.trim()).filter(Boolean);
    const type  = document.getElementById('rootTypeLocal').checked ? 'local' : 'attached';
    if (!path) { showToast('Path is required', 'danger'); return; }
    _settings.scan = _settings.scan || {};
    _settings.scan.roots = _settings.scan.roots || [];
    const entry = { path, label, type, exclude: excl };
    if (idx >= 0) _settings.scan.roots[idx] = entry; else _settings.scan.roots.push(entry);
    renderRootsList();
    modal.hide();
  };
  modal.show();
}

function removeRoot(idx) { _settings.scan.roots.splice(idx, 1); renderRootsList(); }

function renderAlertRulesList() {
  const el = document.getElementById('alertRulesList');
  if (!el || !_settings) return;
  const rules = _settings.alerts?.rules ?? [];
  if (rules.length === 0) { el.innerHTML = '<div class="small py-2" style="color:var(--dw-text2)">No alert rules configured.</div>'; return; }
  el.innerHTML = rules.map((r, i) => {
    const thresh = r.type === 'absolute_growth' ? `${formatBytesShort(r.threshold_bytes)} / ${r.period_days}d` : `${r.threshold_percent}%`;
    return `<div class="dw-rule-item">
      <i class="bi bi-exclamation-diamond text-warning flex-shrink-0"></i>
      <div class="flex-grow-1 overflow-hidden">
        <div class="fw-semibold small">${esc(r.name)}</div>
        <div class="dw-mono small" style="color:var(--dw-text2)">${esc(r.path)} — ${esc(r.type)} — ${thresh}</div>
      </div>
      <button class="btn btn-sm btn-outline-secondary" onclick="openRuleModal(${i})"><i class="bi bi-pencil"></i></button>
      <button class="btn btn-sm btn-outline-danger" onclick="removeRule(${i})"><i class="bi bi-trash"></i></button>
    </div>`;
  }).join('');
}

function openRuleModal(idx) {
  const rules = _settings.alerts?.rules ?? [];
  const r = idx >= 0 ? rules[idx] : {};
  document.getElementById('ruleModalTitle').textContent = idx >= 0 ? 'Edit Alert Rule' : 'Add Alert Rule';
  document.getElementById('ruleModalName').value  = r.name || '';
  document.getElementById('ruleModalPath').value  = r.path || '';
  attachPathAutocomplete(document.getElementById('ruleModalPath'));
  const type = r.type || 'absolute_growth';
  document.getElementById('ruleModalType').value = type;
  document.getElementById('ruleModalThresholdBytes').value = r.threshold_bytes ? bytesToHuman(r.threshold_bytes) : '';
  document.getElementById('ruleModalThresholdPct').value   = r.threshold_percent || '';
  document.getElementById('ruleModalPeriod').value         = r.period_days || 7;
  document.getElementById('ruleNotifyNtfy').checked  = (r.notify || []).includes('ntfy');
  document.getElementById('ruleNotifyEmail').checked = (r.notify || []).includes('email');
  const isGrowth = type === 'absolute_growth';
  document.getElementById('ruleThresholdBytes').classList.toggle('d-none', !isGrowth);
  document.getElementById('ruleThresholdPct').classList.toggle('d-none', isGrowth);
  document.getElementById('rulePeriodRow').classList.toggle('d-none', !isGrowth);
  const modal = new bootstrap.Modal(document.getElementById('ruleModal'));
  document.getElementById('ruleModalSave').onclick = () => {
    const name = document.getElementById('ruleModalName').value.trim();
    const path = document.getElementById('ruleModalPath').value.trim();
    const ruleType = document.getElementById('ruleModalType').value;
    if (!name || !path) { showToast('Name and path are required', 'danger'); return; }
    const notify = [];
    if (document.getElementById('ruleNotifyNtfy').checked)  notify.push('ntfy');
    if (document.getElementById('ruleNotifyEmail').checked) notify.push('email');
    const entry = { name, path, type: ruleType, notify };
    if (ruleType === 'absolute_growth') {
      const sv = parseSize(document.getElementById('ruleModalThresholdBytes').value);
      if (isNaN(sv) || sv <= 0) { showToast('Enter a valid threshold, e.g. 5 GB or 500 MB', 'danger'); return; }
      entry.threshold_bytes = sv;
      entry.period_days = parseInt(document.getElementById('ruleModalPeriod').value) || 7;
    } else {
      entry.threshold_percent = parseFloat(document.getElementById('ruleModalThresholdPct').value) || 0;
    }
    _settings.alerts = _settings.alerts || {};
    _settings.alerts.rules = _settings.alerts.rules || [];
    if (idx >= 0) _settings.alerts.rules[idx] = entry; else _settings.alerts.rules.push(entry);
    renderAlertRulesList();
    modal.hide();
  };
  modal.show();
}

function removeRule(idx) { _settings.alerts.rules.splice(idx, 1); renderAlertRulesList(); }

async function saveSection(section) {
  if (!_settings) return;
  if (section === 'retention') {
    _settings.retention = {
      keep_days: parseInt(document.getElementById('cfgKeepDays').value) || 365,
      cleanup_after_scan: document.getElementById('cfgCleanupAfterScan').checked,
    };
  } else if (section === 'email') {
    _settings.email = {
      enabled:      document.getElementById('cfgEmailEnabled').checked,
      smtp_host:    document.getElementById('cfgSmtpHost').value.trim(),
      smtp_port:    parseInt(document.getElementById('cfgSmtpPort').value) || 587,
      smtp_tls:     document.getElementById('cfgSmtpTls').checked,
      smtp_user:    document.getElementById('cfgSmtpUser').value.trim(),
      smtp_password:document.getElementById('cfgSmtpPassword').value,
      from_address: document.getElementById('cfgFromAddress').value.trim(),
      to_addresses: document.getElementById('cfgToAddresses').value.split('\n').map(s=>s.trim()).filter(Boolean),
    };
  } else if (section === 'ntfy') {
    _settings.ntfy = {
      enabled:    document.getElementById('cfgNtfyEnabled').checked,
      server_url: document.getElementById('cfgNtfyUrl').value.trim(),
      topic:      document.getElementById('cfgNtfyTopic').value.trim(),
      priority:   document.getElementById('cfgNtfyPriority').value,
      auth_token: document.getElementById('cfgNtfyToken').value,
      username:   document.getElementById('cfgNtfyUsername').value.trim(),
      password:   document.getElementById('cfgNtfyPassword').value,
    };
  } else if (section === 'anomalies') {
    const notify = [];
    if (document.getElementById('cfgSpikeNotifyEmail').checked) notify.push('email');
    if (document.getElementById('cfgSpikeNotifyNtfy').checked)  notify.push('ntfy');
    _settings.anomalies = {
      growth_spike: {
        min_bytes: (parseInt(document.getElementById('cfgSpikeMinMB').value) || 100) * 1048576,
        min_ratio: (parseInt(document.getElementById('cfgSpikeMinPct').value) || 20) / 100,
        notify,
      }
    };
  } else if (section === 'display') {
    const theme = document.getElementById('cfgTheme').value;
    _settings.display = {
      default_time_range_days: parseInt(document.getElementById('cfgDefaultDays').value) || 90,
      default_view:            document.getElementById('cfgDefaultView').value,
      theme,
    };
    applyTheme(theme);
  }
  try {
    await PUT('/api/settings', _settings);
    showToast('Settings saved');
  } catch (e) {
    showToast('Save failed: ' + e.message, 'danger');
  }
}

async function testEmail() {
  try { await POST('/api/settings/test-email'); showToast('Test email sent'); }
  catch (e) { showToast('Email failed: ' + e.message, 'danger'); }
}

async function testNtfy() {
  try { await POST('/api/settings/test-ntfy'); showToast('Test notification sent'); }
  catch (e) { showToast('ntfy failed: ' + e.message, 'danger'); }
}

async function changePassword() {
  const current = document.getElementById('cfgCurrentPw').value;
  const newPw   = document.getElementById('cfgNewPw').value;
  const confirm = document.getElementById('cfgNewPwConfirm').value;
  if (newPw !== confirm) { showToast('Passwords do not match', 'danger'); return; }
  if (newPw.length < 8)  { showToast('Password must be at least 8 characters', 'danger'); return; }
  try {
    await POST('/api/auth/change-password', { current_password: current, new_password: newPw });
    showToast('Password changed');
    ['cfgCurrentPw','cfgNewPw','cfgNewPwConfirm'].forEach(id => document.getElementById(id).value = '');
  } catch (e) {
    showToast('Change failed: ' + e.message, 'danger');
  }
}

// ============================================================
// Boot
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // Apply theme immediately (avoids flash)
  GET('/api/settings').then(s => applyTheme(s.display?.theme || 'dark')).catch(() => applyTheme('dark'));

  // Auth check
  checkAuth();

  // Hash routing
  window.addEventListener('hashchange', () => { if (_authenticated) route(); });

  // Nav links
  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', e => {
      if (!_authenticated) return;
      e.preventDefault();
      history.pushState(null, '', el.getAttribute('href'));
      route();
    });
  });

  // Login
  document.getElementById('btnLogin').addEventListener('click', doLogin);
  document.getElementById('loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

  // Setup
  document.getElementById('btnSetup').addEventListener('click', doSetup);
  document.getElementById('setupPasswordConfirm').addEventListener('keydown', e => { if (e.key === 'Enter') doSetup(); });

  // Logout
  document.getElementById('btnLogout').addEventListener('click', doLogout);
  document.getElementById('btnLogoutMobile').addEventListener('click', doLogout);

  // Theme
  document.getElementById('btnTheme').addEventListener('click', toggleTheme);
  document.getElementById('btnThemeMobile').addEventListener('click', toggleTheme);

  // Mobile menu
  document.getElementById('btnMobileMenu').addEventListener('click', () => {
    bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('mobileSidebar')).show();
  });

  // Keep last-scan relative time fresh
  setInterval(() => {
    if (_authenticated) updateLastScan();
  }, 60_000);
});
