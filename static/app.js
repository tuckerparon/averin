/* ── Averin Insights — single-page app ───────────────────────────────────── */

const API = {
  parse:       '/api/parse-contract',
  payers:      '/api/payers',
  performance: (p) => `/api/performance/${encodeURIComponent(p)}`,
  chat:        '/api/chat',
};

let parsedPayers = {};
let currentPayer = null;
let chatHistory  = [];   // { role: 'user'|'assistant', content: string }

// Normalize Gemini's improvement_actions (sometimes array, sometimes string)
function actionsArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(s => String(s).trim()).filter(Boolean);
  return String(val).split(/[;\n]/).map(s => s.trim()).filter(Boolean);
}

// ── Section collapse ──────────────────────────────────────────────────────

function toggleParseSection() {
  const body = document.getElementById('parseSectionBody');
  const btn  = document.getElementById('collapseParseBtn');
  const collapsed = body.style.display === 'none';
  body.style.display = collapsed ? '' : 'none';
  btn.classList.toggle('collapsed', !collapsed);
}

function collapseParseSection() {
  const body = document.getElementById('parseSectionBody');
  const btn  = document.getElementById('collapseParseBtn');
  body.style.display = 'none';
  btn.classList.add('collapsed');
}

// ── File upload (drag & drop + file input) ────────────────────────────────

const dropzone  = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');

dropzone.addEventListener('dragover', e => {
  e.preventDefault(); dropzone.classList.add('drag-over');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', e => {
  e.preventDefault(); dropzone.classList.remove('drag-over');
  handleFiles([...e.dataTransfer.files]);
});
dropzone.addEventListener('click', e => {
  if (e.target.tagName !== 'LABEL') fileInput.click();
});
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) handleFiles([...fileInput.files]);
});

function handleFiles(files) {
  const pdfs = files.filter(f => f.name.toLowerCase().endsWith('.pdf'));
  if (!pdfs.length) { alert('Please upload PDF files.'); return; }
  pdfs.forEach(enqueueFile);
}

// ── Upload queue ──────────────────────────────────────────────────────────

function enqueueFile(file) {
  const queue = document.getElementById('uploadQueue');
  queue.classList.remove('hidden');
  const id = `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const item = document.createElement('div');
  item.className = 'queue-item'; item.id = id;
  item.innerHTML = `
    <span class="queue-icon">📄</span>
    <span class="queue-name">${file.name}</span>
    <span class="queue-status pending" id="${id}-status">Queued</span>
  `;
  queue.appendChild(item);
  uploadAndParse(file, id);
}

async function uploadAndParse(file, queueId) {
  const statusEl = document.getElementById(`${queueId}-status`);
  statusEl.textContent = 'Parsing…'; statusEl.className = 'queue-status parsing';
  const form = new FormData();
  form.append('file', file);
  try {
    showLoading(`Parsing ${file.name} with Gemini AI…`);
    const res  = await fetch(API.parse, { method: 'POST', body: form });
    hideLoading();
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    statusEl.textContent = `Done — ${data.metric_count} metrics`;
    statusEl.className = 'queue-status done';
    parsedPayers[data.payer] = data;
    renderContractBlock(data.payer, data.metrics);
    refreshPayerTabs();
    loadPayerPerformance(data.payer);
    // Collapse upload section once first contract is loaded
    collapseParseSection();
  } catch (err) {
    hideLoading();
    statusEl.textContent = 'Error'; statusEl.className = 'queue-status error';
    alert(`Failed to parse ${file.name}:\n${err.message}`);
  }
}

// ── Contract block (parse view) ───────────────────────────────────────────

function renderContractBlock(payer, metrics) {
  const container = document.getElementById('parsedContracts');
  const existing  = document.getElementById(`contract-${payer}`);
  if (existing) existing.remove();

  const catCounts = {};
  metrics.forEach(m => { catCounts[m.category || 'Other'] = (catCounts[m.category || 'Other'] || 0) + 1; });

  const block = document.createElement('div');
  block.className = 'contract-block'; block.id = `contract-${payer}`;
  block.innerHTML = `
    <div class="contract-header">
      <div class="contract-title">
        <span class="payer-badge">${payer}</span>
        <div>
          <h2>${metrics[0]?.payer_name || payer} — Value-Based Care Contract</h2>
          <div class="contract-meta">${Object.entries(catCounts).map(([c, n]) => `${c} (${n})`).join(' · ')}</div>
        </div>
      </div>
      <span class="contract-count">${metrics.length} metrics extracted</span>
    </div>
    <div class="parse-table-wrap">
      <table class="parse-table">
        <thead>
          <tr>
            <th style="width:40px"></th>
            <th>Metric</th>
            <th>Category</th>
            <th>Target</th>
            <th>Calculation</th>
            <th>Weight</th>
          </tr>
        </thead>
        <tbody id="parse-body-${payer}"></tbody>
      </table>
    </div>
  `;
  container.appendChild(block);

  const tbody = document.getElementById(`parse-body-${payer}`);
  metrics.forEach((m, idx) => {
    const rowId = `${payer}-${idx}`;
    const tr = document.createElement('tr');
    tr.className = 'data-row';
    tr.innerHTML = `
      <td>
        <button class="expand-btn" id="btn-${rowId}" onclick="toggleParseRow('${rowId}')">+</button>
      </td>
      <td class="metric-name-cell">${esc(m.metric_name || '—')}</td>
      <td><span class="cat-badge">${esc(m.category || '—')}</span></td>
      <td class="target-val">${esc(m.target_display || (m.target_value != null ? m.target_value + '%' : '—'))}</td>
      <td class="text-muted text-small">${esc(m.calculation_method || '—')}</td>
      <td class="weight-val">${m.weight != null ? (m.weight * 100).toFixed(0) + '%' : '—'}</td>
    `;
    tbody.appendChild(tr);

    const detailTr = document.createElement('tr');
    detailTr.className = 'expand-detail-row';
    detailTr.id = `detail-${rowId}`;
    detailTr.style.display = 'none';
    detailTr.innerHTML = `<td colspan="6"><div>${buildDetailPanel(m)}</div></td>`;
    tbody.appendChild(detailTr);
  });
}

function buildDetailPanel(m) {
  const incentive = m.financial_incentive
    ? `<p>${esc(m.financial_incentive)}</p>`
    : '<p class="text-muted">Not specified in contract.</p>';
  const actList = actionsArray(m.improvement_actions);
  const actions = actList.length
    ? actList.map(a => `<li>${esc(a)}</li>`).join('')
    : '<li class="text-muted">No specific actions noted.</li>';

  return `
    <div class="detail-panel open">
      <div class="detail-card" style="flex:2;min-width:300px">
        <div class="detail-card-label">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Contract Source ${m.source_location ? `<span class="text-faint text-small">— ${esc(m.source_location)}</span>` : ''}
        </div>
        <div class="detail-card-body">
          <blockquote class="source-quote">${esc(m.source_text || 'No source text extracted.')}</blockquote>
        </div>
      </div>
      <div class="detail-card" style="flex:2;min-width:240px">
        <div class="detail-card-label">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
          EHR Data Mapping
        </div>
        <div class="detail-card-body">${esc(m.ehr_field_mapping || 'Not specified.')}</div>
      </div>
      <div class="detail-card" style="flex:1.5;min-width:210px">
        <div class="detail-card-label">Financial Incentive</div>
        <div class="detail-card-body">${incentive}</div>
      </div>
      <div class="detail-card" style="flex:1.5;min-width:210px">
        <div class="detail-card-label">Improvement Actions</div>
        <div class="detail-card-body"><ul style="padding-left:16px;line-height:1.65">${actions}</ul></div>
      </div>
    </div>
  `;
}

function toggleParseRow(rowId) {
  const detail = document.getElementById(`detail-${rowId}`);
  const btn    = document.getElementById(`btn-${rowId}`);
  const open   = detail.style.display !== 'none';
  detail.style.display = open ? 'none' : 'table-row';
  btn.textContent = open ? '+' : '−';
  btn.classList.toggle('open', !open);
}

// ── Payer tabs ────────────────────────────────────────────────────────────

function refreshPayerTabs() {
  const tabs = document.getElementById('payerTabs');
  const sel  = document.getElementById('payerSelector');
  const keys = Object.keys(parsedPayers);
  if (!keys.length) { sel.classList.add('hidden'); return; }
  sel.classList.remove('hidden');
  tabs.innerHTML = '';
  keys.forEach(key => {
    const btn = document.createElement('button');
    btn.className = `payer-tab ${key === currentPayer ? 'active' : ''}`;
    btn.textContent = key;
    btn.onclick = () => {
      currentPayer = key;
      document.querySelectorAll('.payer-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadPayerPerformance(key);
    };
    tabs.appendChild(btn);
  });
}

// ── Performance dashboard ─────────────────────────────────────────────────

async function loadPayerPerformance(payer) {
  currentPayer = payer;
  refreshPayerTabs();
  showLoading(`Loading ${payer} performance…`);
  try {
    const res  = await fetch(API.performance(payer));
    hideLoading();
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    document.getElementById('noPayers').classList.add('hidden');
    document.getElementById('dashboardContent').classList.remove('hidden');
    renderSummaryCards(data);
    renderImpactBanner(data);
    renderQuickWins(data);
    renderMetricsTable(data.metrics);
  } catch (err) {
    hideLoading();
    alert(`Could not load performance data: ${err.message}`);
  }
}

function renderSummaryCards(data) {
  const { star_rating, financial, counts } = data;
  const starAccent = star_rating >= 4 ? 'teal' : star_rating >= 3.5 ? 'yellow' : 'red';
  const starClass  = star_rating >= 4 ? 'teal' : star_rating >= 3.5 ? 'yellow' : 'red';
  const total = counts.green + counts.yellow + counts.red;
  document.getElementById('summaryCards').innerHTML = `
    <div class="summary-card accent-${starAccent}">
      <div class="label">Estimated Star Rating</div>
      <div class="value ${starClass}">${star_rating.toFixed(1)}</div>
      <div class="stars-text">${renderStars(star_rating)}</div>
    </div>
    <div class="summary-card accent-teal">
      <div class="label">Revenue Opportunity</div>
      <div class="value teal">$${financial.total_opportunity.toLocaleString()}</div>
      <div class="sub">Estimated annual uplift</div>
    </div>
    <div class="summary-card accent-green">
      <div class="label">On Target</div>
      <div class="value green">${counts.green}</div>
      <div class="sub">of ${total} measured metrics</div>
    </div>
    <div class="summary-card accent-yellow">
      <div class="label">Near Miss</div>
      <div class="value yellow">${counts.yellow}</div>
      <div class="sub">within striking distance</div>
    </div>
    <div class="summary-card accent-red">
      <div class="label">Gaps to Close</div>
      <div class="value red">${counts.red}</div>
      <div class="sub">below contract target</div>
    </div>
  `;
}

function renderStars(r) {
  const filled = Math.floor(r);
  const half   = (r % 1) >= 0.3;
  return '★'.repeat(filled) + (half ? '½' : '') + '☆'.repeat(Math.max(0, 5 - filled - (half ? 1 : 0)));
}

function renderImpactBanner(data) {
  const { star_rating, financial, counts } = data;
  document.getElementById('impactBanner').innerHTML = `
    You're currently tracking at <strong>${star_rating.toFixed(1)} stars</strong> under your ${esc(data.payer)} contract.
    Closing the <strong>${counts.red} red gap${counts.red !== 1 ? 's' : ''}</strong>
    ${counts.yellow > 0 ? `and addressing the <strong>${counts.yellow} near-miss metric${counts.yellow !== 1 ? 's' : ''}</strong>` : ''}
    could move you to <strong>${financial.potential_stars.toFixed(1)} stars</strong> —
    approximately <strong>$${financial.total_opportunity.toLocaleString()}</strong> in additional quality bonuses
    and shared savings annually (based on ~${financial.ma_patients_assumed} Medicare Advantage attributed members).
  `;
}

function renderQuickWins(data) {
  const qw = document.getElementById('quickWins');
  const top = data.metrics
    .filter(m => (m.status === 'red' || m.status === 'yellow') && m.current_performance)
    .sort((a, b) => ((b.weight || .5) * Math.abs(b.gap || 0)) - ((a.weight || .5) * Math.abs(a.gap || 0)))
    .slice(0, 3);

  if (!top.length) { qw.classList.add('hidden'); return; }
  qw.classList.remove('hidden');
  qw.innerHTML = `
    <div class="quick-wins-header">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
      Top Improvement Opportunities
    </div>
    <div class="quick-wins-body" id="quickWinsBody"></div>
  `;
  const body = document.getElementById('quickWinsBody');
  top.forEach((m, i) => {
    const p = m.current_performance;
    const gapStr = m.gap != null ? (m.gap >= 0 ? `+${m.gap}pp` : `${m.gap}pp`) : '';
    const gapCol = m.gap != null && m.gap < 0 ? '#B91C1C' : '#15803D';
    const impact = m.weight != null ? `~${(m.weight * 100).toFixed(0)}% of score` : 'High priority';
    const act    = actionsArray(m.improvement_actions)[0] || '';
    const el = document.createElement('div');
    el.className = 'quick-win-item';
    el.innerHTML = `
      <div class="win-rank">${i + 1}</div>
      <div class="win-content">
        <div class="win-name">${esc(m.metric_name)}</div>
        <div class="win-detail">
          Current: <strong>${p.current_value}%</strong> &nbsp;→&nbsp; Target: <strong>${m.target_display || m.target_value + '%'}</strong>
          &nbsp;<span style="color:${gapCol};font-weight:700">${gapStr}</span>
        </div>
        ${act ? `<div class="win-detail text-muted" style="margin-top:3px">💡 ${esc(act)}</div>` : ''}
      </div>
      <span class="win-impact">${impact}</span>
    `;
    body.appendChild(el);
  });
}

function renderMetricsTable(metrics) {
  const tbody = document.getElementById('metricsBody');
  tbody.innerHTML = '';
  metrics.forEach((m, idx) => {
    const status = m.status || 'unknown';
    const rowId  = `dash-${idx}`;
    const gapVal = m.gap != null
      ? `<span class="${m.gap >= 0 ? 'gap-positive' : m.gap >= -10 ? 'gap-warn' : 'gap-negative'}">${m.gap >= 0 ? '+' : ''}${m.gap}pp</span>`
      : '<span class="gap-neutral">—</span>';

    const tr = document.createElement('tr');
    tr.className = `data-row status-${status}`;
    tr.onclick = () => toggleDashRow(rowId);
    tr.innerHTML = `
      <td class="metric-name-cell">${esc(m.metric_name)}</td>
      <td><span class="cat-badge">${esc(m.category || '—')}</span></td>
      <td class="fw-600">${esc(m.target_display || (m.target_value != null ? m.target_value + '%' : '—'))}</td>
      <td class="perf-cell">${buildProgressCell(m, status)}</td>
      <td>${gapVal}</td>
      <td class="weight-val">${m.weight != null ? (m.weight * 100).toFixed(0) + '%' : '—'}</td>
      <td><span class="status-badge ${status}">${statusLabel(status)}</span></td>
    `;
    tbody.appendChild(tr);

    const detailTr = document.createElement('tr');
    detailTr.id = `dash-detail-${rowId}`;
    detailTr.style.display = 'none';
    detailTr.innerHTML = `<td colspan="7">${buildDashDetailPanel(m)}</td>`;
    tbody.appendChild(detailTr);
  });
}

function buildProgressCell(m, status) {
  const perf = m.current_performance;
  if (!perf || perf.current_value == null) return '<div class="perf-value no-data">No data</div>';
  const cur = perf.current_value;
  const tgt = m.target_value;
  const op  = m.target_operator || '>=';
  let pct, tgtPct;
  if (op === '<=' || op === '<') {
    const scale = Math.max(cur * 1.5, tgt ? tgt * 1.3 : 30, 30);
    pct    = Math.min(cur / scale * 100, 100);
    tgtPct = tgt != null ? Math.min(tgt / scale * 100, 100) : null;
  } else {
    pct    = Math.min(cur, 100);
    tgtPct = tgt != null ? Math.min(tgt, 100) : null;
  }
  const targetLine = tgtPct != null
    ? `<div class="progress-target" style="left:${tgtPct}%"></div>` : '';
  return `
    <div class="perf-value">${cur}%</div>
    <div class="progress-wrap">
      <div class="progress-bar ${status}" style="width:${pct}%"></div>
      ${targetLine}
    </div>
  `;
}

function buildDashDetailPanel(m) {
  const perf = m.current_performance;
  const perfSection = perf
    ? `<div class="detail-card" style="flex:1.2">
         <div class="detail-card-label">Current Performance</div>
         <div class="detail-card-body"><strong>${perf.current_value}%</strong><br>
           <span class="text-muted text-small">${esc(perf.detail || '')}</span></div>
       </div>`
    : `<div class="detail-card" style="flex:1.2">
         <div class="detail-card-label">Current Performance</div>
         <div class="detail-card-body text-muted">No EHR data mapped to this metric.</div>
       </div>`;
  const actList = actionsArray(m.improvement_actions);
  const actions = actList.length ? actList.map(a => `<li>${esc(a)}</li>`).join('') : '<li class="text-muted">—</li>';
  return `
    <div style="padding:0 18px 18px">
      <div class="detail-panel open">
        ${perfSection}
        <div class="detail-card" style="flex:2;min-width:280px">
          <div class="detail-card-label">Contract Source</div>
          <div class="detail-card-body">
            <blockquote class="source-quote">${esc(m.source_text || 'No source text available.')}</blockquote>
          </div>
        </div>
        <div class="detail-card" style="flex:1.4;min-width:210px">
          <div class="detail-card-label">EHR Data Fields</div>
          <div class="detail-card-body text-small">${esc(m.ehr_field_mapping || '—')}</div>
        </div>
        <div class="detail-card" style="flex:1.4;min-width:210px">
          <div class="detail-card-label">Clinical Actions</div>
          <div class="detail-card-body"><ul style="padding-left:16px;line-height:1.65">${actions}</ul></div>
        </div>
      </div>
    </div>
  `;
}

function toggleDashRow(rowId) {
  const row = document.getElementById(`dash-detail-${rowId}`);
  row.style.display = row.style.display !== 'none' ? 'none' : 'table-row';
}

// ── Chat support ──────────────────────────────────────────────────────────

let chatOpen = false;

function toggleChat() {
  chatOpen = !chatOpen;
  const panel     = document.getElementById('chatPanel');
  const iconOpen  = document.getElementById('chatIconOpen');
  const iconClose = document.getElementById('chatIconClose');
  const label     = document.getElementById('chatBubbleLabel');
  if (chatOpen) {
    panel.classList.remove('hidden');
    iconOpen.style.display  = 'none';
    iconClose.style.display = '';
    label.textContent = 'Close';
    document.getElementById('chatInput').focus();
  } else {
    panel.classList.add('hidden');
    iconOpen.style.display  = '';
    iconClose.style.display = 'none';
    label.textContent = 'Ask AI';
  }
}

function sendSuggestion(btn) {
  const text = btn.textContent.trim();
  document.getElementById('chatInput').value = text;
  // Hide suggestions after first use
  document.getElementById('chatSuggestions').style.display = 'none';
  sendChatMessage();
}

async function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const msg   = input.value.trim();
  if (!msg) return;
  input.value = '';

  // Hide suggestion chips after first message
  document.getElementById('chatSuggestions').style.display = 'none';

  appendChatMsg('user', msg);
  chatHistory.push({ role: 'user', content: msg });

  const typingEl = appendTyping();
  document.getElementById('chatSendBtn').disabled = true;

  try {
    const res = await fetch(API.chat, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        message:      msg,
        history:      chatHistory.slice(-8),
        current_payer: currentPayer,
      }),
    });
    const data = await res.json();
    typingEl.remove();
    document.getElementById('chatSendBtn').disabled = false;
    if (data.error) throw new Error(data.error);
    const reply = data.response;
    chatHistory.push({ role: 'assistant', content: reply });
    appendChatMsg('assistant', reply);
  } catch (err) {
    typingEl.remove();
    document.getElementById('chatSendBtn').disabled = false;
    appendChatMsg('assistant', `Sorry, I ran into an issue: ${err.message}`);
  }
}

function appendChatMsg(role, text) {
  const messages = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.innerHTML = `<div class="chat-msg-bubble">${escHtml(text)}</div>`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

function appendTyping() {
  const messages = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'chat-msg assistant';
  div.innerHTML = `<div class="chat-typing"><span></span><span></span><span></span></div>`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

// Enter key to send
document.getElementById('chatInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
});

// ── Utilities ─────────────────────────────────────────────────────────────

function statusLabel(s) {
  return { green: 'On Target', yellow: 'Near Miss', red: 'Gap', unknown: 'No Data' }[s] || s;
}

function esc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Slightly richer escaping for chat (preserve newlines as <br>)
function escHtml(str) {
  return esc(str).replace(/\n/g, '<br>');
}

function showLoading(msg) {
  document.getElementById('loadingText').textContent = msg || 'Loading…';
  document.getElementById('loadingOverlay').classList.remove('hidden');
}
function hideLoading() {
  document.getElementById('loadingOverlay').classList.add('hidden');
}

// ── Init ──────────────────────────────────────────────────────────────────

(async function init() {
  try {
    const res  = await fetch(API.payers);
    const data = await res.json();
    if (data.payers.length) {
      data.payers.forEach(p => { parsedPayers[p.key] = p; });
      refreshPayerTabs();
      currentPayer = data.payers[0].key;
      loadPayerPerformance(currentPayer);
    }
  } catch (e) { /* server not ready */ }
})();
