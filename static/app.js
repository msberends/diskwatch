'use strict';

// ============================================================
// Utilities
// ============================================================

function formatBytes(n) {
  if (n == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const mults = [1, 1e3, 1e6, 1e9, 1e12, 1e15];
  let i = 0;
  const abs = Math.abs(n);
  while (i < mults.length - 1 && abs >= mults[i + 1]) i++;
  const v = abs / mults[i];
  return (n < 0 ? '-' : '') + v.toFixed(2).replace(/\.?0+$/, m => m === '.' ? '' : m) + ' ' + units[i];
}

function formatBytesShort(n) {
  if (n == null) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e15) return sign + (abs / 1e15).toFixed(1) + ' PB';
  if (abs >= 1e12) return sign + (abs / 1e12).toFixed(1) + ' TB';
  if (abs >= 1e9)  return sign + (abs / 1e9).toFixed(1) + ' GB';
  if (abs >= 1e6)  return sign + (abs / 1e6).toFixed(1) + ' MB';
  if (abs >= 1e3)  return sign + (abs / 1e3).toFixed(1) + ' KB';
  return sign + abs + ' B';
}

function parseSize(str) {
  if (!str) return NaN;
  const m = str.trim().match(/^([\d.]+)\s*(tb|gb|mb|kb|b)?$/i);
  if (!m) return NaN;
  const num = parseFloat(m[1]);
  const mult = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12 };
  return Math.round(num * (mult[(m[2] || 'b').toLowerCase()] ?? 1));
}

function bytesToHuman(n) {
  if (!n) return '';
  const units = ['TB', 'GB', 'MB', 'KB', 'B'];
  const mults = [1e12, 1e9, 1e6, 1e3, 1];
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
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDuration(secs) {
  if (secs == null) return '—';
  const s = Math.round(secs);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return m + 'm ' + rem + 's';
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function spinner() {
  return '<div class="dw-spinner-overlay"><div class="spinner-border text-accent" role="status"><span class="visually-hidden">Loading…</span></div></div>';
}

function tableSpinner(cols) {
  return `<tr><td colspan="${cols}" class="text-center py-4">${spinner()}</td></tr>`;
}

function growthIndicator(bytes) {
  if (bytes == null) return '<span class="dw-growth-flat">—</span>';
  if (bytes === 0)   return '<span class="dw-growth-flat">±0</span>';
  const cls = bytes > 0 ? 'dw-growth-up' : 'dw-growth-down';
  const icon = bytes > 0 ? '▲' : '▼';
  return `<span class="${cls}">${icon} ${formatBytesShort(Math.abs(bytes))}</span>`;
}

// ============================================================
// API layer
// ============================================================

async function api(method, path, body) {
  const opts = {
    method,
    headers: {},
    credentials: 'same-origin',
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  if (res.status === 401) {
    // Session expired — re-check auth
    checkAuth();
    throw new Error('Not authenticated');
  }
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
// Toast notifications
// ============================================================

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const id = 'toast-' + Date.now();
  const bgClass = type === 'success' ? 'bg-success' : type === 'danger' ? 'bg-danger' : 'bg-secondary';
  const html = `
    <div id="${id}" class="toast align-items-center text-white ${bgClass} border-0" role="alert" aria-live="assertive" aria-atomic="true">
      <div class="d-flex">
        <div class="toast-body">${esc(message)}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    </div>`;
  container.insertAdjacentHTML('beforeend', html);
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
  const icon = document.getElementById('themeIcon');
  const iconMobile = document.getElementById('themeIconMobile');
  const cls = theme === 'light' ? 'bi-moon-fill' : 'bi-sun-fill';
  if (icon) { icon.className = 'bi ' + cls; }
  if (iconMobile) { iconMobile.className = 'bi ' + cls; }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-bs-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  // Persist to server settings asynchronously
  GET('/api/settings').then(cfg => {
    cfg.display = cfg.display || {};
    cfg.display.theme = next;
    PUT('/api/settings', cfg).catch(() => {});
  }).catch(() => {});
}

// ============================================================
// Authentication
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
  } catch (e) {
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
  if (pw !== pw2) {
    errEl.textContent = 'Passwords do not match.';
    errEl.classList.remove('d-none');
    return;
  }
  if (pw.length < 8) {
    errEl.textContent = 'Password must be at least 8 characters.';
    errEl.classList.remove('d-none');
    return;
  }
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
// Sidebar badges & last-scan
// ============================================================

async function updateBadges() {
  try {
    const [anomalies, alerts] = await Promise.all([
      GET('/api/anomalies?acknowledged=false&limit=1000'),
      GET('/api/alerts?acknowledged=false&limit=1000'),
    ]);
    const ba = document.getElementById('badgeAnomalies');
    const bl = document.getElementById('badgeAlerts');
    if (ba) {
      if (anomalies.length > 0) { ba.textContent = anomalies.length; ba.style.display = ''; }
      else { ba.style.display = 'none'; }
    }
    if (bl) {
      if (alerts.length > 0) { bl.textContent = alerts.length; bl.style.display = ''; }
      else { bl.style.display = 'none'; }
    }
  } catch (_) {}
}

async function updateLastScan() {
  try {
    const info = await GET('/api/scan-info');
    const latest = info.reduce((best, r) => {
      if (!r.latest_scan) return best;
      return (!best || r.latest_scan > best) ? r.latest_scan : best;
    }, null);
    const el = document.getElementById('lastScanTime');
    if (el) el.textContent = latest ? formatTs(latest) : 'Never';
  } catch (_) {}
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
    case 'dashboard': renderDashboard(container); break;
    case 'browse':    renderBrowse(container, parts.slice(1).join('/')); break;
    case 'anomalies': renderAnomalies(container); break;
    case 'alerts':    renderAlerts(container); break;
    case 'scans':     renderScans(container); break;
    case 'settings':  renderSettings(container); break;
    default:          renderDashboard(container);
  }
}

// ============================================================
// View: Dashboard
// ============================================================

async function renderDashboard(container) {
  container.innerHTML = spinner();

  try {
    const [partitions, overview, growers, anomalies, scanInfo] = await Promise.all([
      GET('/api/partitions'),
      GET('/api/overview'),
      GET('/api/biggest-growers?days=7&limit=10'),
      GET('/api/anomalies?acknowledged=false&limit=10'),
      GET('/api/scan-info'),
    ]);

    // Aggregate stats
    const totalSize  = scanInfo.reduce((s, r) => s + (r.total_size_bytes || 0), 0);
    const totalScans = scanInfo.reduce((s, r) => s + (r.total_scans || 0), 0);

    // Largest single directory across all roots
    let biggestDir = null, biggestBytes = 0;
    for (const root of overview) {
      for (const d of root.directories || []) {
        if (d.size_bytes > biggestBytes) { biggestBytes = d.size_bytes; biggestDir = d.path; }
      }
    }

    // Biggest 7d grower
    const topGrower = growers[0];

    // --- Partition cards ---
    const partitionCards = partitions.map(p => {
      const pct = p.used_percent || 0;
      const barCls = pct >= 85 ? 'bg-danger' : pct >= 70 ? 'bg-warning' : 'bg-success';
      const typeBadge = p.type === 'local'
        ? '<span class="badge bg-secondary me-1">local</span>'
        : p.type === 'attached'
          ? '<span class="badge bg-info text-dark me-1">attached</span>'
          : '';
      return `
        <div class="col-12 col-sm-6 col-xl-3">
          <div class="card dw-partition-card h-100">
            <div class="card-body">
              <div class="d-flex align-items-center gap-1 mb-1">${typeBadge}<span class="dw-partition-label">${esc(p.label)}</span></div>
              <div class="dw-mono small text-muted mb-2">${esc(p.root_path)}</div>
              <div class="d-flex justify-content-between mb-1">
                <span class="small">${formatBytesShort(p.used_bytes)} used</span>
                <span class="small fw-medium">${pct.toFixed(1)}%</span>
              </div>
              <div class="progress mb-2">
                <div class="progress-bar ${barCls}" style="width:${Math.min(pct,100)}%"></div>
              </div>
              <div class="d-flex justify-content-between small text-muted">
                <span>${formatBytesShort(p.free_bytes)} free</span>
                <span>${formatBytesShort(p.total_bytes)} total</span>
              </div>
            </div>
          </div>
        </div>`;
    }).join('');

    // --- Stat cards ---
    const statCards = `
      <div class="col-6 col-md-3">
        <div class="card dw-stat-card h-100">
          <div class="card-body">
            <div class="card-title">Total Tracked</div>
            <div class="dw-stat-value">${formatBytesShort(totalSize)}</div>
            <div class="dw-stat-sub">${totalScans} scan${totalScans !== 1 ? 's' : ''} recorded</div>
          </div>
        </div>
      </div>
      <div class="col-6 col-md-3">
        <div class="card dw-stat-card h-100">
          <div class="card-body">
            <div class="card-title">Directories</div>
            <div class="dw-stat-value">${scanInfo.reduce((s,r)=>s+(r.total_scans?1:0),0) > 0 ? '—' : '—'}</div>
            <div class="dw-stat-sub">${partitions.length} root${partitions.length !== 1 ? 's' : ''} monitored</div>
          </div>
        </div>
      </div>
      <div class="col-6 col-md-3">
        <div class="card dw-stat-card h-100">
          <div class="card-body">
            <div class="card-title">Largest Directory</div>
            <div class="dw-stat-value">${formatBytesShort(biggestBytes)}</div>
            <div class="dw-stat-sub dw-mono text-truncate" title="${esc(biggestDir)}">${esc(biggestDir || '—')}</div>
          </div>
        </div>
      </div>
      <div class="col-6 col-md-3">
        <div class="card dw-stat-card h-100">
          <div class="card-body">
            <div class="card-title">Biggest Grower (7d)</div>
            <div class="dw-stat-value dw-growth-up">${topGrower ? formatBytesShort(topGrower.growth_bytes) : '—'}</div>
            <div class="dw-stat-sub dw-mono text-truncate" title="${esc(topGrower?.path)}">${esc(topGrower?.path || 'No data')}</div>
          </div>
        </div>
      </div>`;

    // --- Charts data ---
    // Top 10 largest (flatten all roots, unique paths, sort)
    const allDirs = [];
    for (const root of overview) {
      for (const d of root.directories || []) allDirs.push(d);
    }
    allDirs.sort((a, b) => b.size_bytes - a.size_bytes);
    const top10 = allDirs.slice(0, 10).reverse();

    const growersTop10 = growers.slice(0, 10).reverse();

    // --- Recent anomalies table ---
    const anomalyRows = anomalies.length === 0
      ? '<tr><td colspan="5" class="text-center text-muted py-3">No unacknowledged anomalies</td></tr>'
      : anomalies.map(a => {
          const details = (() => { try { return JSON.parse(a.details || '{}'); } catch (_) { return {}; } })();
          const typeBadge = anomalyBadge(a.type);
          const detail = anomalyDetail(a.type, details);
          return `<tr>
            <td class="text-muted small">${formatTs(a.timestamp)}</td>
            <td class="dw-path dw-mono"><a href="#/browse${esc(a.path)}" class="text-accent text-decoration-none">${esc(a.path)}</a></td>
            <td>${typeBadge}</td>
            <td class="small">${esc(detail)}</td>
            <td><button class="btn btn-sm btn-outline-secondary" onclick="ackAnomaly(${a.id}, this)">Ack</button></td>
          </tr>`;
        }).join('');

    container.innerHTML = `
      <div class="dw-section-title">Partitions</div>
      <div class="row g-3 mb-4">${partitionCards}</div>

      <div class="dw-section-title">Overview</div>
      <div class="row g-3 mb-4">${statCards}</div>

      <div class="row g-3 mb-4">
        <div class="col-12 col-lg-6">
          <div class="card h-100">
            <div class="card-header small fw-medium">Top 10 Largest Directories</div>
            <div class="card-body p-2">
              <div id="chartLargest" class="dw-chart-container"></div>
            </div>
          </div>
        </div>
        <div class="col-12 col-lg-6">
          <div class="card h-100">
            <div class="card-header small fw-medium">Top 10 Biggest Growers (7d)</div>
            <div class="card-body p-2">
              <div id="chartGrowers" class="dw-chart-container"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="dw-section-title">Recent Anomalies</div>
      <div class="card mb-4">
        <div class="card-body p-0">
          <table class="table dw-table mb-0">
            <thead><tr>
              <th>Date</th><th>Path</th><th>Type</th><th>Details</th><th></th>
            </tr></thead>
            <tbody id="anomalyTableBody">${anomalyRows}</tbody>
          </table>
        </div>
      </div>`;

    // Render charts
    const isDark = document.documentElement.getAttribute('data-bs-theme') !== 'light';
    const plotBg  = isDark ? '#212529' : '#fff';
    const gridClr = isDark ? '#343a40' : '#dee2e6';
    const fontClr = isDark ? '#adb5bd' : '#495057';

    const baseLayout = {
      paper_bgcolor: plotBg, plot_bgcolor: plotBg,
      font: { color: fontClr, family: 'DM Sans, system-ui, sans-serif', size: 11 },
      margin: { l: 180, r: 20, t: 10, b: 40 },
      xaxis: { gridcolor: gridClr, zeroline: false },
      yaxis: { gridcolor: gridClr },
    };

    if (top10.length > 0) {
      Plotly.newPlot('chartLargest', [{
        type: 'bar', orientation: 'h',
        x: top10.map(d => d.size_bytes),
        y: top10.map(d => d.path.split('/').slice(-2).join('/') || d.path),
        text: top10.map(d => formatBytesShort(d.size_bytes)),
        textposition: 'outside',
        marker: { color: '#2ec4b6' },
        hovertemplate: '<b>%{y}</b><br>%{text}<extra></extra>',
      }], {
        ...baseLayout,
        xaxis: { ...baseLayout.xaxis, tickformat: '.2s' },
      }, { responsive: true, displayModeBar: false });
    } else {
      document.getElementById('chartLargest').innerHTML = '<div class="dw-chart-placeholder">No data yet</div>';
    }

    if (growersTop10.length > 0) {
      Plotly.newPlot('chartGrowers', [{
        type: 'bar', orientation: 'h',
        x: growersTop10.map(d => d.growth_bytes),
        y: growersTop10.map(d => d.path.split('/').slice(-2).join('/') || d.path),
        text: growersTop10.map(d => '+' + formatBytesShort(d.growth_bytes)),
        textposition: 'outside',
        marker: { color: '#dc3545' },
        hovertemplate: '<b>%{y}</b><br>%{text}<extra></extra>',
      }], {
        ...baseLayout,
        xaxis: { ...baseLayout.xaxis, tickformat: '.2s' },
      }, { responsive: true, displayModeBar: false });
    } else {
      document.getElementById('chartGrowers').innerHTML = '<div class="dw-chart-placeholder">No growth data yet</div>';
    }

  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load dashboard: ${esc(e.message)}</div>`;
  }
}

function anomalyBadge(type) {
  switch (type) {
    case 'growth_spike':      return '<span class="badge bg-warning text-dark">growth spike</span>';
    case 'new_directory':     return '<span class="badge bg-info text-dark">new dir</span>';
    case 'deleted_directory': return '<span class="badge bg-danger">deleted dir</span>';
    default:                  return `<span class="badge bg-secondary">${esc(type)}</span>`;
  }
}

function anomalyDetail(type, details) {
  if (type === 'growth_spike') {
    return `${formatBytesShort(details.previous_size)} → ${formatBytesShort(details.current_size)} (+${details.growth_percent}%)`;
  }
  if (type === 'new_directory') {
    return `${formatBytesShort(details.current_size)}, ${(details.file_count || 0).toLocaleString()} files`;
  }
  if (type === 'deleted_directory') {
    return `Was ${formatBytesShort(details.previous_size)}`;
  }
  return JSON.stringify(details);
}

async function ackAnomaly(id, btn) {
  btn.disabled = true;
  try {
    await POST(`/api/anomalies/${id}/acknowledge`);
    btn.closest('tr').remove();
    updateBadges();
  } catch (e) {
    showToast('Failed to acknowledge: ' + e.message, 'danger');
    btn.disabled = false;
  }
}

// ============================================================
// View: Browse
// ============================================================

let _browseSort = 'size'; // 'size' | 'name'
let _browseTrendDays = 90;

async function renderBrowse(container, pathFromHash) {
  // pathFromHash is the hash fragment after #/browse, e.g. "var/www" -> "/var/www"
  const targetPath = pathFromHash ? '/' + pathFromHash : '/';
  container.innerHTML = spinner();

  let roots = [];
  try {
    const [settings, partitions] = await Promise.all([
      GET('/api/settings'),
      GET('/api/partitions'),
    ]);
    _browseTrendDays = (settings.display && settings.display.default_time_range_days) || 90;
    roots = partitions || [];
  } catch (_) {}

  // If at '/' but '/' is not a configured root, redirect to first configured root
  if (targetPath === '/' && roots.length > 0 && !roots.find(r => r.root_path === '/')) {
    location.hash = '#/browse' + roots[0].root_path;
    return;
  }

  // Find which root targetPath belongs to (longest prefix match wins)
  const sortedRoots = [...roots].sort((a, b) => b.root_path.length - a.root_path.length);
  const currentRoot = sortedRoots.find(r => {
    const rp = r.root_path;
    return targetPath === rp || targetPath.startsWith(rp === '/' ? '/' : rp + '/');
  }) || roots[0] || { root_path: '/', label: '/ (root)' };

  // Root picker: only shown when multiple roots are configured
  const pickerHtml = roots.length > 1 ? `
    <div class="d-flex align-items-center gap-2 mb-2">
      <span class="small text-muted flex-shrink-0">Root:</span>
      <select class="form-select form-select-sm dw-mono" id="browseRootPicker" style="width:auto;max-width:320px">
        ${roots.map(r => `<option value="${esc(r.root_path)}"${r.root_path === currentRoot.root_path ? ' selected' : ''}>${esc(r.label || r.root_path)}</option>`).join('')}
      </select>
    </div>` : '';

  container.innerHTML = `
    <div class="mb-3">
      ${pickerHtml}
      <nav aria-label="breadcrumb" class="dw-breadcrumb">
        <ol class="breadcrumb mb-0" id="browseBreadcrumb"></ol>
      </nav>
    </div>
    <div class="row g-3">
      <div class="col-12 col-lg-5">
        <div class="card h-100">
          <div class="card-header d-flex align-items-center gap-2 py-2">
            <span class="small fw-medium flex-grow-1">Directories</span>
            <div class="btn-group btn-group-sm" role="group">
              <button class="btn btn-outline-secondary ${_browseSort==='size'?'active':''}" id="sortBySize">Size</button>
              <button class="btn btn-outline-secondary ${_browseSort==='name'?'active':''}" id="sortByName">Name</button>
            </div>
          </div>
          <div class="card-body p-0" style="max-height:600px;overflow-y:auto">
            <div id="browseDirList">${spinner()}</div>
          </div>
        </div>
      </div>
      <div class="col-12 col-lg-7">
        <div class="card h-100">
          <div class="card-header py-2 d-flex align-items-center gap-2">
            <span class="small fw-medium flex-grow-1" id="browseTrendTitle">Select a directory</span>
            <div class="btn-group btn-group-sm" role="group" id="trendRangeGroup">
              <button class="btn btn-outline-secondary" data-days="7">7d</button>
              <button class="btn btn-outline-secondary" data-days="30">30d</button>
              <button class="btn btn-outline-secondary active" data-days="90">90d</button>
              <button class="btn btn-outline-secondary" data-days="365">1y</button>
              <button class="btn btn-outline-secondary" data-days="3650">All</button>
            </div>
          </div>
          <div class="card-body p-2">
            <div id="browseTrendChart" class="dw-chart-container">
              <div class="dw-chart-placeholder">Click <i class="bi bi-graph-up-arrow"></i> on a directory to view its trend</div>
            </div>
            <div id="browseTrendSummary" class="text-muted small mt-1 text-center"></div>
          </div>
        </div>
      </div>
    </div>`;

  buildBreadcrumb(targetPath, currentRoot);

  if (roots.length > 1) {
    document.getElementById('browseRootPicker').addEventListener('change', e => {
      const newRoot = e.target.value;
      location.hash = '#/browse' + (newRoot === '/' ? '' : newRoot);
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
    document.querySelectorAll('#trendRangeGroup button').forEach(b => b.classList.toggle('active', b === btn));
    const sel = document.querySelector('.dw-dir-item.selected');
    if (sel) renderTrendChart(sel.dataset.path);
  });

  await renderDirList(targetPath);

  // Auto-load trend for the directory itself on first load
  renderTrendChart(targetPath);
}

function buildBreadcrumb(path, currentRoot) {
  const ol = document.getElementById('browseBreadcrumb');
  if (!ol) return;
  const rp = currentRoot.root_path;
  const rawLabel = currentRoot.label || rp;
  const rootLabel = rawLabel === '/' ? '/ (root)' : rawLabel;
  const rootHash = '#/browse' + (rp === '/' ? '' : rp);

  // Path relative to the current root
  let relativePath = path;
  if (rp !== '/' && path.startsWith(rp)) {
    relativePath = path.slice(rp.length); // '' or '/subdir/...'
  }

  const parts = relativePath.split('/').filter(Boolean);
  let html = `<li class="breadcrumb-item"><a href="${rootHash}">${esc(rootLabel)}</a></li>`;
  let cumPath = rp === '/' ? '' : rp;
  for (let i = 0; i < parts.length; i++) {
    cumPath += '/' + parts[i];
    if (i === parts.length - 1) {
      html += `<li class="breadcrumb-item active">${esc(parts[i])}</li>`;
    } else {
      html += `<li class="breadcrumb-item"><a href="#/browse${cumPath}">${esc(parts[i])}</a></li>`;
    }
  }
  ol.innerHTML = html;
}

async function renderDirList(path) {
  const listEl = document.getElementById('browseDirList');
  if (!listEl) return;
  listEl.innerHTML = spinner();
  try {
    let dirs = await GET('/api/tree?path=' + encodeURIComponent(path));
    if (_browseSort === 'name') dirs.sort((a, b) => a.name.localeCompare(b.name));

    if (dirs.length === 0) {
      listEl.innerHTML = '<div class="text-center text-muted py-4 small">No subdirectories found</div>';
      return;
    }

    const html = dirs.map(d => `
      <div class="dw-dir-item list-group-item list-group-item-action px-3 py-2 border-0"
           data-path="${esc(d.path)}">
        <div class="d-flex align-items-center gap-2">
          <i class="bi bi-folder-fill text-accent flex-shrink-0"></i>
          <span class="dw-dir-name flex-grow-1" title="${esc(d.path)}">${esc(d.name)}</span>
          <button class="btn btn-link btn-sm dw-trend-btn p-0 text-muted flex-shrink-0" title="Show trend"><i class="bi bi-graph-up-arrow"></i></button>
          <span class="dw-mono small text-end flex-shrink-0">${formatBytesShort(d.size_bytes)}</span>
        </div>
        <div class="d-flex justify-content-between mt-1">
          <span class="small text-muted">${(d.file_count || 0).toLocaleString()} files</span>
          <span class="small">${growthIndicator(d.change_7d)}</span>
        </div>
      </div>`).join('');

    listEl.innerHTML = `<div class="list-group list-group-flush">${html}</div>`;

    listEl.querySelectorAll('.dw-dir-item').forEach(el => {
      el.addEventListener('click', () => {
        const p = el.dataset.path;
        const hashPath = p.startsWith('/') ? p.slice(1) : p;
        location.hash = '#/browse/' + hashPath;
      });
      el.querySelector('.dw-trend-btn').addEventListener('click', e => {
        e.stopPropagation();
        const p = el.dataset.path;
        listEl.querySelectorAll('.dw-dir-item').forEach(x => x.classList.remove('selected'));
        el.classList.add('selected');
        renderTrendChart(p);
      });
    });
  } catch (e) {
    listEl.innerHTML = `<div class="alert alert-danger m-2 small">${esc(e.message)}</div>`;
  }
}

async function renderTrendChart(path) {
  const chartEl = document.getElementById('browseTrendChart');
  const summaryEl = document.getElementById('browseTrendSummary');
  const titleEl = document.getElementById('browseTrendTitle');
  if (!chartEl) return;

  const shortName = path.split('/').filter(Boolean).slice(-1)[0] || '/';
  if (titleEl) titleEl.textContent = shortName;

  chartEl.innerHTML = spinner();

  try {
    const data = await GET(`/api/trend?path=${encodeURIComponent(path)}&days=${_browseTrendDays}`);

    if (data.length === 0) {
      chartEl.innerHTML = '<div class="dw-chart-placeholder">No trend data for this directory</div>';
      if (summaryEl) summaryEl.textContent = '';
      return;
    }

    const isDark = document.documentElement.getAttribute('data-bs-theme') !== 'light';
    const plotBg  = isDark ? '#212529' : '#fff';
    const gridClr = isDark ? '#343a40' : '#dee2e6';
    const fontClr = isDark ? '#adb5bd' : '#495057';

    const xs = data.map(d => d.date);
    const ys = data.map(d => d.size_bytes);

    Plotly.newPlot(chartEl, [{
      type: 'scatter', mode: 'lines+markers',
      x: xs, y: ys,
      line: { color: '#2ec4b6', width: 2 },
      marker: { color: '#2ec4b6', size: 4 },
      text: ys.map(v => formatBytesShort(v)),
      hovertemplate: '%{x}<br><b>%{text}</b><extra></extra>',
    }], {
      paper_bgcolor: plotBg, plot_bgcolor: plotBg,
      font: { color: fontClr, family: 'DM Sans, system-ui, sans-serif', size: 11 },
      margin: { l: 60, r: 20, t: 10, b: 40 },
      xaxis: { gridcolor: gridClr, zeroline: false },
      yaxis: { gridcolor: gridClr, tickformat: '.2s', zeroline: false },
    }, { responsive: true, displayModeBar: false });

    // Summary
    if (summaryEl && data.length >= 2) {
      const first = data[0].size_bytes;
      const last  = data[data.length - 1].size_bytes;
      const delta = last - first;
      const pct   = first > 0 ? (delta / first * 100).toFixed(1) : null;
      const sign  = delta >= 0 ? '+' : '';
      const cls   = delta > 0 ? 'dw-growth-up' : delta < 0 ? 'dw-growth-down' : '';
      summaryEl.innerHTML = `Over period: <span class="${cls}">${sign}${formatBytesShort(delta)}${pct != null ? ` (${sign}${pct}%)` : ''}</span>`;
    } else if (summaryEl) {
      summaryEl.textContent = '';
    }

  } catch (e) {
    chartEl.innerHTML = `<div class="alert alert-danger m-2 small">${esc(e.message)}</div>`;
  }
}

// ============================================================
// View: Anomalies
// ============================================================

let _anomalyFilter = { type: '', acknowledged: 'false' };
let _anomalySelected = new Set();

async function renderAnomalies(container) {
  container.innerHTML = `
    <div class="d-flex align-items-center gap-3 mb-3 flex-wrap">
      <div class="dw-section-title mb-0">Anomalies</div>
      <select class="form-select form-select-sm" id="filterAnomalyType" style="max-width:160px">
        <option value="">All types</option>
        <option value="growth_spike">Growth spike</option>
        <option value="new_directory">New directory</option>
        <option value="deleted_directory">Deleted directory</option>
      </select>
      <select class="form-select form-select-sm" id="filterAnomalyAck" style="max-width:160px">
        <option value="false">Unacknowledged</option>
        <option value="true">Acknowledged</option>
        <option value="">All</option>
      </select>
      <button class="btn btn-sm btn-outline-warning ms-auto" id="btnBulkAck">Acknowledge selected</button>
    </div>
    <div class="card">
      <div class="card-body p-0">
        <table class="table dw-table mb-0">
          <thead><tr>
            <th><input type="checkbox" id="ackSelectAll"></th>
            <th>Date</th><th>Path</th><th>Type</th><th>Details</th><th>Status</th><th></th>
          </tr></thead>
          <tbody id="anomalyListBody">${tableSpinner(7)}</tbody>
        </table>
      </div>
    </div>`;

  document.getElementById('filterAnomalyType').value = _anomalyFilter.type;
  document.getElementById('filterAnomalyAck').value  = _anomalyFilter.acknowledged;

  const reload = () => loadAnomalyList();
  document.getElementById('filterAnomalyType').addEventListener('change', e => { _anomalyFilter.type = e.target.value; reload(); });
  document.getElementById('filterAnomalyAck').addEventListener('change',  e => { _anomalyFilter.acknowledged = e.target.value; reload(); });
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
  tbody.innerHTML = tableSpinner(7);
  _anomalySelected = new Set();

  let url = '/api/anomalies?limit=200';
  if (_anomalyFilter.acknowledged !== '') url += `&acknowledged=${_anomalyFilter.acknowledged}`;

  try {
    let rows = await GET(url);
    if (_anomalyFilter.type) rows = rows.filter(r => r.type === _anomalyFilter.type);

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">No anomalies found</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(a => {
      const details = (() => { try { return JSON.parse(a.details || '{}'); } catch (_) { return {}; } })();
      return `<tr>
        <td><input type="checkbox" class="anomaly-row-check" data-id="${a.id}" ${_anomalySelected.has(String(a.id)) ? 'checked' : ''}></td>
        <td class="text-muted small">${formatTs(a.timestamp)}</td>
        <td class="dw-path dw-mono"><a href="#/browse${esc(a.path)}" class="text-accent text-decoration-none">${esc(a.path)}</a></td>
        <td>${anomalyBadge(a.type)}</td>
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
    tbody.innerHTML = `<tr><td colspan="7"><div class="alert alert-danger m-2">${esc(e.message)}</div></td></tr>`;
  }
}

async function bulkAckAnomalies() {
  if (_anomalySelected.size === 0) { showToast('Select rows first', 'secondary'); return; }
  const ids = [..._anomalySelected];
  try {
    await Promise.all(ids.map(id => POST(`/api/anomalies/${id}/acknowledge`)));
    showToast(`Acknowledged ${ids.length} anomaly/anomalies`);
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
      <div class="dw-section-title mb-0">Alerts</div>
      <select class="form-select form-select-sm" id="filterAlertAck" style="max-width:160px">
        <option value="false">Unacknowledged</option>
        <option value="true">Acknowledged</option>
        <option value="">All</option>
      </select>
    </div>
    <div class="card">
      <div class="card-body p-0">
        <table class="table dw-table mb-0">
          <thead><tr>
            <th>Date</th><th>Rule</th><th>Path</th><th>Message</th><th>Channels</th><th>Status</th><th></th>
          </tr></thead>
          <tbody id="alertListBody">${tableSpinner(7)}</tbody>
        </table>
      </div>
    </div>`;

  document.getElementById('filterAlertAck').value = _alertFilter.acknowledged;
  document.getElementById('filterAlertAck').addEventListener('change', e => {
    _alertFilter.acknowledged = e.target.value;
    loadAlertList();
  });

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
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">No alerts found</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(a => {
      const channels = (() => { try { return JSON.parse(a.notification_channels || '[]'); } catch (_) { return []; } })();
      const channelBadges = channels.map(c => `<span class="badge bg-secondary me-1">${esc(c)}</span>`).join('');
      return `<tr>
        <td class="text-muted small">${formatTs(a.timestamp)}</td>
        <td><span class="badge bg-primary">${esc(a.rule_name)}</span></td>
        <td class="dw-path dw-mono"><a href="#/browse${esc(a.path)}" class="text-accent text-decoration-none">${esc(a.path)}</a></td>
        <td class="small">${esc(a.message)}</td>
        <td>${channelBadges || '<span class="text-muted">—</span>'}</td>
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
    showToast('Failed to acknowledge: ' + e.message, 'danger');
    btn.disabled = false;
  }
}

// ============================================================
// View: Scan History
// ============================================================

let _scanOffset = 0;
const _scanPageSize = 50;
let _scanTotal = 0;

async function renderScans(container) {
  _scanOffset = 0;
  container.innerHTML = `
    <div class="dw-section-title">Scan History</div>
    <div class="card">
      <div class="card-body p-0">
        <table class="table dw-table mb-0">
          <thead><tr>
            <th>Timestamp</th><th>Root</th><th>Duration</th><th>Directories</th><th>Dirs/min</th><th>Total Size</th><th>Errors</th>
          </tr></thead>
          <tbody id="scanListBody">${tableSpinner(7)}</tbody>
        </table>
      </div>
      <div class="card-footer d-flex justify-content-between align-items-center py-2" id="scanPagination" style="display:none!important"></div>
    </div>
    <!-- Error detail modal -->
    <div class="modal fade" id="errorModal" tabindex="-1">
      <div class="modal-dialog modal-lg">
        <div class="modal-content">
          <div class="modal-header"><h5 class="modal-title">Scan Errors</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body"><pre id="errorModalBody" class="small" style="max-height:400px;overflow-y:auto"></pre></div>
        </div>
      </div>
    </div>`;

  await loadScanList();
}

async function loadScanList() {
  const tbody = document.getElementById('scanListBody');
  const pagination = document.getElementById('scanPagination');
  if (!tbody) return;
  tbody.innerHTML = tableSpinner(6);

  try {
    const data = await GET(`/api/scans?limit=${_scanPageSize}&offset=${_scanOffset}`);
    _scanTotal = data.total;
    const rows = data.scans;

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">No scans recorded yet</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(s => {
      const meta = (() => { try { return JSON.parse(s.metadata || '{}'); } catch (_) { return {}; } })();
      const errors = meta.errors || [];
      const errCount = s.errors || 0;
      const errCell = errCount > 0
        ? `<button class="btn btn-sm btn-outline-danger" onclick="showScanErrors(${JSON.stringify(JSON.stringify(errors))})">${errCount} error${errCount !== 1 ? 's' : ''}</button>`
        : '<span class="text-muted">—</span>';
      const dirs = s.directories_counted || 0;
      const secs = s.duration_seconds || 0;
      const dirsPerMin = secs > 0 ? Math.round(dirs / (secs / 60)).toLocaleString() : '—';
      return `<tr>
        <td class="dw-mono small">${formatTs(s.timestamp)}</td>
        <td><span class="badge bg-secondary">${esc(s.label || s.root_path)}</span></td>
        <td class="dw-mono small">${formatDuration(s.duration_seconds)}</td>
        <td class="dw-mono small">${dirs.toLocaleString()}</td>
        <td class="dw-mono small">${dirsPerMin}</td>
        <td class="dw-mono small">${formatBytesShort(s.total_size_bytes)}</td>
        <td>${errCell}</td>
      </tr>`;
    }).join('');

    // Pagination
    if (_scanTotal > _scanPageSize) {
      pagination.style.removeProperty('display');
      const page = Math.floor(_scanOffset / _scanPageSize) + 1;
      const totalPages = Math.ceil(_scanTotal / _scanPageSize);
      pagination.innerHTML = `
        <button class="btn btn-sm btn-outline-secondary" id="scanPrev" ${_scanOffset === 0 ? 'disabled' : ''}>← Prev</button>
        <span class="small text-muted">Page ${page} of ${totalPages} (${_scanTotal} total)</span>
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

      <!-- Scan Roots -->
      <div class="accordion-item">
        <h2 class="accordion-header">
          <button class="accordion-button" type="button" data-bs-toggle="collapse" data-bs-target="#secRoots">
            <i class="bi bi-hdd me-2"></i> Scan Roots
          </button>
        </h2>
        <div id="secRoots" class="accordion-collapse collapse show" data-bs-parent="#settingsAccordion">
          <div class="accordion-body">
            <div id="rootsList"></div>
            <button class="btn btn-sm btn-outline-accent mt-2" id="btnAddRoot">
              <i class="bi bi-plus-circle me-1"></i>Add Root
            </button>
            <div class="mt-3"><button class="btn btn-accent btn-sm" onclick="saveSection('roots')">Save Scan Roots</button></div>
          </div>
        </div>
      </div>

      <!-- Data Retention -->
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

      <!-- Email -->
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
              <div class="col-md-4 d-flex align-items-end">
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
              <button class="btn btn-outline-secondary btn-sm" onclick="testEmail()">Send Test Email</button>
            </div>
          </div>
        </div>
      </div>

      <!-- ntfy -->
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
                  ${['min','low','default','high','urgent'].map(p =>
                    `<option ${(_settings.ntfy?.priority ?? 'default') === p ? 'selected' : ''}>${p}</option>`
                  ).join('')}
                </select></div>
              <div class="col-md-8"><label class="form-label">Auth Token <span class="text-muted small">(use token <em>or</em> username/password)</span></label>
                <input type="password" class="form-control" id="cfgNtfyToken" value="${esc(_settings.ntfy?.auth_token ?? '')}" /></div>
              <div class="col-md-6"><label class="form-label">Username</label>
                <input type="text" class="form-control" id="cfgNtfyUsername" value="${esc(_settings.ntfy?.username ?? '')}" autocomplete="off" /></div>
              <div class="col-md-6"><label class="form-label">Password</label>
                <input type="password" class="form-control" id="cfgNtfyPassword" value="${esc(_settings.ntfy?.password ?? '')}" /></div>
            </div>
            <div class="mt-3 d-flex gap-2">
              <button class="btn btn-accent btn-sm" onclick="saveSection('ntfy')">Save ntfy</button>
              <button class="btn btn-outline-secondary btn-sm" onclick="testNtfy()">Send Test Notification</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Alert Rules -->
      <div class="accordion-item">
        <h2 class="accordion-header">
          <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#secAlerts">
            <i class="bi bi-exclamation-diamond me-2"></i> Alert Rules
          </button>
        </h2>
        <div id="secAlerts" class="accordion-collapse collapse" data-bs-parent="#settingsAccordion">
          <div class="accordion-body">
            <div id="alertRulesList"></div>
            <button class="btn btn-sm btn-outline-secondary mt-2" id="btnAddRule">
              <i class="bi bi-plus-circle me-1"></i>Add Rule
            </button>
            <div class="mt-3"><button class="btn btn-accent btn-sm" onclick="saveSection('alerts')">Save Alert Rules</button></div>
          </div>
        </div>
      </div>

      <!-- Display -->
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
                  ${['dashboard','browse','anomalies','alerts','scans','settings'].map(v =>
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

      <!-- Security -->
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

    </div><!-- /accordion -->
    </div><!-- /dw-settings -->

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
              <div class="form-check">
                <input class="form-check-input" type="radio" name="rootDriveType" id="rootTypeLocal" value="local">
                <label class="form-check-label" for="rootTypeLocal">Local <span class="text-muted small">(main system drive — one only)</span></label>
              </div>
              <div class="form-check">
                <input class="form-check-input" type="radio" name="rootDriveType" id="rootTypeAttached" value="attached">
                <label class="form-check-label" for="rootTypeAttached">Attached <span class="text-muted small">(external / mounted)</span></label>
              </div>
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
            <input type="text" class="form-control" id="ruleModalThresholdBytes" placeholder="e.g. 5 GB, 500 MB, 2 TB" /></div>
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
    el.innerHTML = '<div class="text-muted small py-2">No scan roots configured.</div>';
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
        <div class="dw-mono">${esc(r.path)}</div>
        <div class="small text-muted">${r.label ? esc(r.label) + ' — ' : ''}${excl} exclude${excl !== 1 ? 's' : ''}</div>
      </div>
      <button class="btn btn-sm btn-outline-secondary flex-shrink-0" onclick="openRootModal(${r._idx})"><i class="bi bi-pencil"></i></button>
      <button class="btn btn-sm btn-outline-danger flex-shrink-0" onclick="removeRoot(${r._idx})"><i class="bi bi-trash"></i></button>
    </div>`;
  }

  let html = '';

  if (local.length === 0) {
    html += '<div class="alert alert-warning small py-2 mb-2">No <strong>Local</strong> drive configured. Edit a root and set its type to Local.</div>';
  } else if (local.length > 1) {
    html += '<div class="alert alert-warning small py-2 mb-2">More than one <strong>Local</strong> drive is configured — there should be exactly one.</div>';
  }

  if (local.length > 0) {
    html += '<div class="small fw-medium text-muted mb-1">Local Drive</div>';
    html += local.map(r => rootItem(r, 'bi-hdd-fill')).join('');
  }

  if (attached.length > 0) {
    html += `<div class="small fw-medium text-muted mb-1 ${local.length ? 'mt-3' : ''}">Attached Drives</div>`;
    html += attached.map(r => rootItem(r, 'bi-hdd')).join('');
  }

  if (untyped.length > 0) {
    html += `<div class="small fw-medium text-muted mb-1 ${local.length || attached.length ? 'mt-3' : ''}">Unclassified</div>`;
    html += untyped.map(r => rootItem(r, 'bi-hdd')).join('');
  }

  el.innerHTML = html;
}

function attachPathAutocomplete(input) {
  if (input.dataset.pathComplete) return;
  input.dataset.pathComplete = '1';

  let dropdown = null;
  let debounceTimer = null;
  let activeIdx = -1;

  function removeDropdown() {
    if (dropdown) { dropdown.remove(); dropdown = null; }
    activeIdx = -1;
  }

  function positionDropdown() {
    if (!dropdown) return;
    const r = input.getBoundingClientRect();
    dropdown.style.top   = (r.bottom + window.scrollY) + 'px';
    dropdown.style.left  = (r.left   + window.scrollX) + 'px';
    dropdown.style.width = r.width + 'px';
  }

  function showSuggestions(suggestions) {
    removeDropdown();
    if (!suggestions.length) return;
    dropdown = document.createElement('div');
    dropdown.className = 'list-group shadow';
    dropdown.style.cssText = 'position:absolute;z-index:9999;max-height:200px;overflow-y:auto;';
    suggestions.forEach(path => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'list-group-item list-group-item-action dw-mono small py-1 px-2 border-0';
      item.textContent = path;
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        input.value = path + '/';
        input.focus();
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => fetchSuggestions(input.value), 0);
      });
      dropdown.appendChild(item);
    });
    document.body.appendChild(dropdown);
    positionDropdown();
  }

  async function fetchSuggestions(val) {
    if (!val) { removeDropdown(); return; }
    try {
      const results = await GET('/api/suggest?path=' + encodeURIComponent(val));
      if (document.activeElement === input) showSuggestions(results || []);
    } catch (_) { removeDropdown(); }
  }

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => fetchSuggestions(input.value), 180);
  });

  input.addEventListener('keydown', e => {
    if (!dropdown) return;
    const items = [...dropdown.querySelectorAll('button')];
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, items.length - 1);
      items.forEach((b, i) => b.classList.toggle('active', i === activeIdx));
      if (items[activeIdx]) items[activeIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      items.forEach((b, i) => b.classList.toggle('active', i === activeIdx));
      if (items[activeIdx]) items[activeIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      items[activeIdx].dispatchEvent(new MouseEvent('mousedown'));
    } else if (e.key === 'Escape') {
      removeDropdown();
    }
  });

  input.addEventListener('blur', () => setTimeout(removeDropdown, 150));
  window.addEventListener('scroll', positionDropdown, { passive: true });
  window.addEventListener('resize', positionDropdown, { passive: true });
}

function openRootModal(idx) {
  const roots = _settings.scan?.roots ?? [];
  const r = idx >= 0 ? roots[idx] : {};
  document.getElementById('rootModalTitle').textContent = idx >= 0 ? 'Edit Scan Root' : 'Add Scan Root';
  document.getElementById('rootModalPath').value     = r.path || '';
  attachPathAutocomplete(document.getElementById('rootModalPath'));
  document.getElementById('rootModalLabel').value    = r.label || '';
  document.getElementById('rootModalExcludes').value = (r.exclude || []).join('\n');

  // Default type for new roots: local if none exists yet, otherwise attached
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
    if (idx >= 0) _settings.scan.roots[idx] = entry;
    else _settings.scan.roots.push(entry);
    renderRootsList();
    modal.hide();
  };
  modal.show();
}

function removeRoot(idx) {
  _settings.scan.roots.splice(idx, 1);
  renderRootsList();
}

function renderAlertRulesList() {
  const el = document.getElementById('alertRulesList');
  if (!el || !_settings) return;
  const rules = _settings.alerts?.rules ?? [];
  if (rules.length === 0) {
    el.innerHTML = '<div class="text-muted small py-2">No alert rules configured.</div>';
    return;
  }
  el.innerHTML = rules.map((r, i) => {
    const thresh = r.type === 'absolute_growth'
      ? `${formatBytesShort(r.threshold_bytes)} / ${r.period_days}d`
      : `${r.threshold_percent}%`;
    return `<div class="dw-rule-item">
      <i class="bi bi-exclamation-diamond text-warning flex-shrink-0"></i>
      <div class="flex-grow-1 overflow-hidden">
        <div class="fw-medium">${esc(r.name)}</div>
        <div class="dw-mono small text-muted">${esc(r.path)} — ${esc(r.type)} — ${thresh}</div>
      </div>
      <button class="btn btn-sm btn-outline-secondary flex-shrink-0" onclick="openRuleModal(${i})"><i class="bi bi-pencil"></i></button>
      <button class="btn btn-sm btn-outline-danger flex-shrink-0" onclick="removeRule(${i})"><i class="bi bi-trash"></i></button>
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
  document.getElementById('ruleModalType').value  = type;
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
      const sizeVal = parseSize(document.getElementById('ruleModalThresholdBytes').value);
      if (isNaN(sizeVal) || sizeVal <= 0) { showToast('Enter a valid threshold, e.g. 5 GB or 500 MB', 'danger'); return; }
      entry.threshold_bytes = sizeVal;
      entry.period_days     = parseInt(document.getElementById('ruleModalPeriod').value) || 7;
    } else {
      entry.threshold_percent = parseFloat(document.getElementById('ruleModalThresholdPct').value) || 0;
    }
    _settings.alerts = _settings.alerts || {};
    _settings.alerts.rules = _settings.alerts.rules || [];
    if (idx >= 0) _settings.alerts.rules[idx] = entry;
    else _settings.alerts.rules.push(entry);
    renderAlertRulesList();
    modal.hide();
  };
  modal.show();
}

function removeRule(idx) {
  _settings.alerts.rules.splice(idx, 1);
  renderAlertRulesList();
}

async function saveSection(section) {
  if (!_settings) return;
  // Gather fields into _settings before saving
  if (section === 'retention') {
    _settings.retention = {
      keep_days: parseInt(document.getElementById('cfgKeepDays').value) || 365,
      cleanup_after_scan: document.getElementById('cfgCleanupAfterScan').checked,
    };
  } else if (section === 'email') {
    _settings.email = {
      enabled: document.getElementById('cfgEmailEnabled').checked,
      smtp_host: document.getElementById('cfgSmtpHost').value.trim(),
      smtp_port: parseInt(document.getElementById('cfgSmtpPort').value) || 587,
      smtp_tls:  document.getElementById('cfgSmtpTls').checked,
      smtp_user: document.getElementById('cfgSmtpUser').value.trim(),
      smtp_password: document.getElementById('cfgSmtpPassword').value,
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
  } else if (section === 'display') {
    const theme = document.getElementById('cfgTheme').value;
    _settings.display = {
      default_time_range_days: parseInt(document.getElementById('cfgDefaultDays').value) || 90,
      default_view: document.getElementById('cfgDefaultView').value,
      theme,
    };
    applyTheme(theme);
  }
  // 'roots' and 'alerts' are already mutated in-place by the modal handlers

  try {
    await PUT('/api/settings', _settings);
    showToast('Settings saved');
  } catch (e) {
    showToast('Save failed: ' + e.message, 'danger');
  }
}

async function testEmail() {
  try {
    await POST('/api/settings/test-email');
    showToast('Test email sent successfully');
  } catch (e) {
    showToast('Test email failed: ' + e.message, 'danger');
  }
}

async function testNtfy() {
  try {
    await POST('/api/settings/test-ntfy');
    showToast('Test ntfy notification sent');
  } catch (e) {
    showToast('Test ntfy failed: ' + e.message, 'danger');
  }
}

async function changePassword() {
  const current = document.getElementById('cfgCurrentPw').value;
  const newPw   = document.getElementById('cfgNewPw').value;
  const confirm = document.getElementById('cfgNewPwConfirm').value;
  if (newPw !== confirm) { showToast('New passwords do not match', 'danger'); return; }
  if (newPw.length < 8)  { showToast('New password must be at least 8 characters', 'danger'); return; }
  try {
    await POST('/api/auth/change-password', { current_password: current, new_password: newPw });
    showToast('Password changed successfully');
    document.getElementById('cfgCurrentPw').value = '';
    document.getElementById('cfgNewPw').value = '';
    document.getElementById('cfgNewPwConfirm').value = '';
  } catch (e) {
    showToast('Password change failed: ' + e.message, 'danger');
  }
}

// ============================================================
// Boot
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // Theme — apply immediately from stored setting (load without auth to avoid flash)
  GET('/api/settings').then(s => {
    applyTheme(s.display?.theme || 'dark');
  }).catch(() => applyTheme('dark'));

  // Auth check
  checkAuth();

  // Hash routing — handles browser back/forward
  window.addEventListener('hashchange', () => { if (_authenticated) route(); });

  // Nav link clicks — push state directly so route() fires once without relying on hashchange
  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', e => {
      if (!_authenticated) return;
      e.preventDefault();
      history.pushState(null, '', el.getAttribute('href'));
      route();
    });
  });

  // Login form
  document.getElementById('btnLogin').addEventListener('click', doLogin);
  document.getElementById('loginPassword').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });

  // Setup form
  document.getElementById('btnSetup').addEventListener('click', doSetup);
  document.getElementById('setupPasswordConfirm').addEventListener('keydown', e => {
    if (e.key === 'Enter') doSetup();
  });

  // Logout
  document.getElementById('btnLogout').addEventListener('click', doLogout);
  document.getElementById('btnLogoutMobile').addEventListener('click', doLogout);

  // Theme toggles
  document.getElementById('btnTheme').addEventListener('click', toggleTheme);
  document.getElementById('btnThemeMobile').addEventListener('click', toggleTheme);

  // Mobile sidebar trigger
  document.getElementById('btnMobileMenu').addEventListener('click', () => {
    bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('mobileSidebar')).show();
  });
});
