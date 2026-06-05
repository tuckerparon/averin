/* ── Averin Insights — single-page app ───────────────────────────────────── */
/* Updated 2026-06-04: wired to FastAPI backend (localhost:8000)              */

// ── Auth gate ─────────────────────────────────────────────────────────────

(function checkAuth() {
  if (!sessionStorage.getItem('averin-token')) {
    document.addEventListener('DOMContentLoaded', () => {
      document.getElementById('loginOverlay').classList.remove('hidden');
    });
  }
})();

function toggleLoginPw(btn) {
  const input = document.getElementById('loginPassword');
  input.type = input.type === 'password' ? 'text' : 'password';
  btn.style.opacity = input.type === 'text' ? '1' : '0.5';
}

async function submitLogin(e) {
  e.preventDefault();
  const pw = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.classList.add('hidden');
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    if (!res.ok) { errEl.classList.remove('hidden'); return; }
    const { token } = await res.json();
    sessionStorage.setItem('averin-token', token);
    document.getElementById('loginOverlay').classList.add('hidden');
  } catch (_) {
    errEl.classList.remove('hidden');
  }
}

const API_BASE = '';

const API = {
  contracts:      `${API_BASE}/contracts`,
  contract:       (id) => `${API_BASE}/contracts/${id}`,
  contractMetrics:(id) => `${API_BASE}/contracts/${id}/metrics`,
  payers:         `${API_BASE}/payers`,
  payerMetrics:   (id) => `${API_BASE}/payers/${id}/metrics`,
  ehrSync:        `${API_BASE}/ehr/sync`,
  ehrSyncStatus:  `${API_BASE}/ehr/sync/status`,
  chat:           `${API_BASE}/chat`,
};

// contractId → payer name (used to correlate upload → dashboard)
let contractIndex = {};
let currentPayerId = null;
let chatHistory = [];

// Raw payer data keyed by contractId — used for rescaling
let _payerDataCache = {};

function getPopulation() {
  return parseInt(document.getElementById('populationInput')?.value || '10000', 10);
}

function scaleOpportunity(rawDollars, denominator) {
  if (!rawDollars || !denominator) return rawDollars;
  const pop = getPopulation();
  return Math.round(rawDollars * (pop / denominator));
}

function rescaleOpportunity() {
  // Re-render all cached payer cards with new population scale
  Object.values(_payerDataCache).forEach(data => renderPayerCard(data));
}

// ── Field normalization helpers ────────────────────────────────────────────

function buildTargetDisplay(m) {
  if (!m.target_value && m.target_value !== 0) return '—';
  const unit = m.target_unit === 'percent' ? '%' : (m.target_unit || '');
  return `${m.target_operator || ''}${m.target_value}${unit}`;
}

function buildEhrFields(m) {
  const parts = [];
  if (m.icd10_codes?.length) parts.push(`ICD-10: ${m.icd10_codes.join(', ')}`);
  if (m.loinc_codes?.length)  parts.push(`LOINC: ${m.loinc_codes.join(', ')}`);
  return parts.join(' · ') || '—';
}

function buildPerfDetail(perf) {
  if (!perf || perf.rate == null) return null;
  const num = perf.numerator_count ?? '?';
  const den = perf.denominator_count ?? '?';
  return { current_value: perf.rate, detail: `${num} of ${den} patients` };
}

// Map new status values to legacy UI color keys
function toColorStatus(status) {
  return { failing: 'red', at_risk: 'yellow', on_track: 'green' }[status] || 'unknown';
}

// Normalize actionsArray (may be string, array, or null)
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

async function handleFiles(files) {
  const pdfs = files.filter(f => f.name.toLowerCase().endsWith('.pdf'));
  if (!pdfs.length) { alert('Please upload PDF files.'); return; }
  const items = pdfs.map(f => ({ file: f, id: addToQueue(f) }));
  for (const { file, id } of items) {
    await uploadAndParse(file, id);
  }
}

// ── Upload queue ──────────────────────────────────────────────────────────

function addToQueue(file) {
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
  return id;
}

async function uploadAndParse(file, queueId) {
  const statusEl = document.getElementById(`${queueId}-status`);
  statusEl.textContent = 'Uploading…'; statusEl.className = 'queue-status parsing';

  const form = new FormData();
  form.append('file', file);

  try {
    showLoading(`Uploading ${file.name}…`);
    const uploadRes = await fetch(API.contracts, { method: 'POST', body: form });
    if (!uploadRes.ok) throw new Error(`Upload failed: HTTP ${uploadRes.status}`);
    const { id: contractId, payer_name: payerName } = await uploadRes.json();
    hideLoading();

    // Poll until extraction complete
    statusEl.textContent = 'Parsing…'; statusEl.className = 'queue-status parsing';
    showLoading(`Extracting metrics from ${file.name}…`);
    await pollUntilComplete(contractId);
    hideLoading();

    // Fetch extracted metrics
    const metricsRes = await fetch(API.contractMetrics(contractId));
    if (!metricsRes.ok) throw new Error('Failed to load metrics');
    const metrics = await metricsRes.json();

    statusEl.textContent = `Done — ${metrics.length} metrics`;
    statusEl.className = 'queue-status done';

    contractIndex[contractId] = payerName;

    document.getElementById('section-dashboard').classList.remove('hidden');
    document.getElementById('sectionDivider').classList.remove('hidden');

    // Trigger EHR sync to populate gaps, then load performance
    showLoading('Syncing EHR data…');
    try {
      await fetch(API.ehrSync, { method: 'POST' });
      await pollEhrSync();
    } catch (_) { /* non-fatal — gaps just won't show */ }
    hideLoading();

    loadPayerPerformance(contractId, payerName);
    collapseParseSection();

  } catch (err) {
    hideLoading();
    statusEl.textContent = 'Error'; statusEl.className = 'queue-status error';
    alert(`Failed to process ${file.name}:\n${err.message}`);
  }
}

async function pollEhrSync(maxWaitMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, 3000));
    const res = await fetch(API.ehrSyncStatus);
    if (!res.ok) return;
    const { status } = await res.json();
    if (status === 'complete' || status === 'failed' || status === 'idle') return;
  }
}

async function pollUntilComplete(contractId, maxWaitMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, 2000));
    const res = await fetch(API.contract(contractId));
    if (!res.ok) throw new Error('Could not check extraction status');
    const { extraction_status } = await res.json();
    if (extraction_status === 'complete') return;
    if (extraction_status === 'failed') throw new Error('Extraction failed — check server logs');
  }
  throw new Error('Extraction timed out after 2 minutes');
}

// ── Contract block (parse view) ───────────────────────────────────────────

function renderContractBlock(contractId, payerName, metrics) {
  const container = document.getElementById('parsedContracts');
  const existing  = document.getElementById(`contract-${contractId}`);
  if (existing) existing.remove();

  const block = document.createElement('div');
  block.className = 'contract-block'; block.id = `contract-${contractId}`;
  block.innerHTML = `
    <div class="contract-header">
      <div class="contract-title">
        <span class="payer-badge">${payerName}</span>
        <div>
          <h2>${esc(payerName)} — Value-Based Care Contract</h2>
          <div class="contract-meta">${metrics.length} metrics extracted</div>
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
            <th>Target</th>
            <th>Period</th>
            <th>Weight</th>
          </tr>
        </thead>
        <tbody id="parse-body-${contractId}"></tbody>
      </table>
    </div>
  `;
  container.appendChild(block);

  const tbody = document.getElementById(`parse-body-${contractId}`);
  metrics.forEach((m, idx) => {
    const rowId = `${contractId}-${idx}`;
    const tr = document.createElement('tr');
    tr.className = 'data-row';
    tr.innerHTML = `
      <td>
        <button class="expand-btn" id="btn-${rowId}" onclick="toggleParseRow('${rowId}')">+</button>
      </td>
      <td class="metric-name-cell">${esc(m.measure_name || '—')}</td>
      <td class="target-val">${esc(buildTargetDisplay(m))}</td>
      <td class="text-muted text-small">${esc(m.measurement_period || '—')}</td>
      <td class="weight-val">${m.financial_weight_pp != null ? m.financial_weight_pp + 'x' : '—'}</td>
    `;
    tbody.appendChild(tr);

    const detailTr = document.createElement('tr');
    detailTr.className = 'expand-detail-row';
    detailTr.id = `detail-${rowId}`;
    detailTr.style.display = 'none';
    detailTr.innerHTML = `<td colspan="5"><div>${buildDetailPanel(m)}</div></td>`;
    tbody.appendChild(detailTr);
  });
}

function buildDetailPanel(m) {
  return `
    <div class="detail-panel open">
      <div class="detail-card" style="flex:2;min-width:300px">
        <div class="detail-card-label">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Contract Source
        </div>
        <div class="detail-card-body">
          <blockquote class="source-quote">${esc(m.contract_source_text || 'No source text extracted.')}</blockquote>
        </div>
      </div>
      <div class="detail-card" style="flex:2;min-width:240px">
        <div class="detail-card-label">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
          EHR Data Mapping
        </div>
        <div class="detail-card-body">${esc(buildEhrFields(m))}</div>
      </div>
      <div class="detail-card" style="flex:1.5;min-width:210px">
        <div class="detail-card-label">Measurement Period</div>
        <div class="detail-card-body">${esc(m.measurement_period || '—')}</div>
      </div>
      <div class="detail-card" style="flex:1.5;min-width:210px">
        <div class="detail-card-label">Confidence</div>
        <div class="detail-card-body">${m.extraction_confidence != null ? (m.extraction_confidence * 100).toFixed(0) + '%' : 'Not scored'}</div>
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

// ── Performance dashboard ─────────────────────────────────────────────────

async function loadPayerPerformance(contractId, payerName) {
  currentPayerId = contractId;
  showLoading(`Loading ${payerName} performance…`);
  try {
    // Fetch payer summary (opportunity $, counts) and metric details in parallel
    const [payersRes, metricsRes] = await Promise.all([
      fetch(API.payers),
      fetch(API.payerMetrics(contractId)),
    ]);
    hideLoading();

    if (!payersRes.ok || !metricsRes.ok) throw new Error('Failed to load performance data');

    const payers  = await payersRes.json();
    const metrics = await metricsRes.json();
    const summary = payers.find(p => p.id === contractId) || {};

    const payerData = {
      payer:       payerName,
      contractId,
      star_rating: 3.5,  // Placeholder — CMS Stars integration pending (Phase 5)
      financial:   { total_opportunity: summary.total_opportunity_dollars || 0 },
      counts: {
        red:    summary.metric_counts?.failing  || 0,
        yellow: summary.metric_counts?.at_risk  || 0,
        green:  summary.metric_counts?.on_track || 0,
      },
      metrics: metrics.map(m => ({
        metric_name:         m.measure_name,
        target_display:      buildTargetDisplay(m),
        target_value:        m.target_value,
        source_text:         m.contract_source_text,
        ehr_field_mapping:   buildEhrFields(m),
        improvement_actions: [],
        status:              toColorStatus(m.performance?.status),
        gap:                 m.performance?.gap_pp ?? null,
        current_performance: buildPerfDetail(m.performance),
        opportunity_flag:    m.performance?.opportunity_flag,
        opportunity_dollars: m.performance?.opportunity_dollars,
        denominator_count:   m.performance?.denominator_count || 1,
      })),
    };
    _payerDataCache[contractId] = payerData;
    renderPayerCard(payerData);
  } catch (err) {
    hideLoading();
    console.error('loadPayerPerformance error:', err);
    alert(`Could not load performance data: ${err.message}`);
  }
}

function renderPayerCard(data) {
  const grid = document.getElementById('payerCardsGrid');
  const existing = document.getElementById(`card-${data.contractId}`);
  if (existing) existing.remove();

  const { star_rating, financial, counts, metrics, payer, contractId } = data;

  const filled = Math.floor(star_rating);
  const half   = (star_rating % 1) >= 0.3;
  const empty  = Math.max(0, 5 - filled - (half ? 1 : 0));
  const stars  = '★'.repeat(filled) + (half ? '½' : '') + '☆'.repeat(empty);

  const chips = [
    counts.red    ? `<span class="card-chip red">● ${counts.red} failing</span>` : '',
    counts.yellow ? `<span class="card-chip yellow">● ${counts.yellow} at risk</span>` : '',
    counts.green  ? `<span class="card-chip green">● ${counts.green} on track</span>` : '',
  ].join('');

  // Scale total opportunity by population ratio
  const avgDenom = metrics.length
    ? metrics.reduce((s, m) => s + (m.denominator_count || 1), 0) / metrics.length
    : 1;
  const scaledTotal = scaleOpportunity(financial.total_opportunity, avgDenom);
  const opp = scaledTotal;
  const oppStr = opp >= 1000000 ? `$${(opp/1000000).toFixed(1)}M`
               : opp >= 1000    ? `$${Math.round(opp/1000)}K`
               : opp > 0        ? `$${opp.toLocaleString()}`
               : '$0';

  const starColor   = star_rating >= 4 ? 'var(--teal-500)' : star_rating >= 3 ? '#F59E0B' : 'var(--red-mid)';
  const accentColor = star_rating >= 4.5 ? '#16A34A' : star_rating >= 4.0 ? '#22C55E' :
                      star_rating >= 3.5 ? '#0F9080' : star_rating >= 3.0 ? '#F59E0B' :
                      star_rating >= 2.5 ? '#F97316' : '#DC2626';
  const headerTint  = star_rating >= 4.5 ? 'rgba(22,163,74,.05)'  : star_rating >= 4.0 ? 'rgba(34,197,94,.05)'  :
                      star_rating >= 3.5 ? 'rgba(15,144,128,.05)' : star_rating >= 3.0 ? 'rgba(245,158,11,.05)' :
                      star_rating >= 2.5 ? 'rgba(249,115,22,.06)' : 'rgba(220,38,38,.06)';

  const card = document.createElement('div');
  card.className = 'payer-card';
  card.id = `card-${contractId}`;
  card.style.borderTop = `4px solid ${accentColor}`;
  card.innerHTML = `
    <div class="payer-card-head" style="background:${headerTint}">
      <div class="payer-card-left">
        <div class="payer-card-name">${esc(payer)}</div>
        <div class="payer-card-stars" style="color:${starColor}">${stars}
          <span class="payer-star-num">${star_rating.toFixed(1)}</span>
        </div>
      </div>
      <div class="payer-card-right">
        <div class="payer-card-opp">${oppStr}</div>
        <div class="payer-card-opp-label">potential opportunity</div>
      </div>
    </div>
    <div class="payer-card-chips">${chips}</div>
    <table class="payer-card-table">
      <thead>
        <tr>
          <th>Measure</th>
          <th>Target</th>
          <th>Performance</th>
          <th>Gap (pp)</th>
        </tr>
      </thead>
      <tbody id="card-tbody-${contractId}"></tbody>
    </table>
  `;
  grid.appendChild(card);

  const order  = { red: 0, yellow: 1, green: 2, unknown: 3 };
  const sorted = [...metrics].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3));
  const known   = sorted.filter(m => m.status !== 'unknown');
  const unknown = sorted.filter(m => m.status === 'unknown');

  const tbody = document.getElementById(`card-tbody-${contractId}`);
  [...known, ...unknown].forEach((m, idx) => {
    const rowId = `${contractId}-${idx}`;
    const status = m.status || 'unknown';
    const val    = m.current_performance?.current_value;
    const tgt    = m.target_display || '—';
    const gap    = m.gap != null ? (m.gap >= 0 ? `+${m.gap}` : `${m.gap}`) : '—';

    const tr = document.createElement('tr');
    tr.className = 'payer-card-row';
    tr.onclick = () => toggleCardRow(rowId);
    tr.innerHTML = `
      <td class="card-metric-name">${esc(m.metric_name)}</td>
      <td class="card-tgt">${esc(tgt)}</td>
      <td class="card-perf-cell">${val != null
        ? `<span class="perf-pill ${status}">${val}%</span>`
        : `<span class="perf-pill unknown">—</span>`}</td>
      <td class="card-gap-cell">${gap}</td>
    `;
    tbody.appendChild(tr);

    const detailTr = document.createElement('tr');
    detailTr.id = `card-detail-${rowId}`;
    detailTr.className = 'card-detail-row';
    detailTr.style.display = 'none';
    detailTr.innerHTML = `<td colspan="4">${buildCardDetail(m)}</td>`;
    tbody.appendChild(detailTr);
  });
}

function buildCardDetail(m) {
  const perf = m.current_performance;
  const perfHtml = perf
    ? `<div class="cd-block"><div class="cd-label">Current Performance</div>
       <div class="cd-val"><strong>${perf.current_value}%</strong> — ${esc(perf.detail || '')}</div></div>`
    : `<div class="cd-block"><div class="cd-label">Current Performance</div>
       <div class="cd-val text-muted">No EHR data mapped to this metric yet.</div></div>`;

  const scaledOpp = m.opportunity_dollars
    ? scaleOpportunity(m.opportunity_dollars, m.denominator_count || 1)
    : null;
  const oppDisplay = scaledOpp >= 1000000 ? `$${(scaledOpp/1000000).toFixed(1)}M`
                   : scaledOpp >= 1000    ? `$${Math.round(scaledOpp/1000)}K`
                   : scaledOpp > 0        ? `$${scaledOpp.toLocaleString()}`
                   : null;
  const flagHtml = m.opportunity_flag
    ? `<div class="cd-block"><div class="cd-label">Opportunity</div>
       <div class="cd-val"><strong>${m.opportunity_flag}</strong>${oppDisplay ? ` — ${oppDisplay}` : ''}</div></div>`
    : '';

  const actList = actionsArray(m.improvement_actions);
  const actions = actList.length
    ? actList.map(a => `<li>${esc(a)}</li>`).join('')
    : '<li class="text-muted">Clinical actions will be generated after EHR sync.</li>';

  return `
    <div class="card-detail-panel">
      ${perfHtml}
      ${flagHtml}
      <div class="cd-block cd-block-wide">
        <div class="cd-label">Contract Source</div>
        <blockquote class="source-quote">${esc(m.source_text || 'No source text extracted.')}</blockquote>
      </div>
      <div class="cd-block">
        <div class="cd-label">EHR Data Fields</div>
        <div class="cd-val">${esc(m.ehr_field_mapping || '—')}</div>
      </div>
      <div class="cd-block">
        <div class="cd-label">Clinical Actions</div>
        <ul style="padding-left:16px;line-height:1.65;margin:0">${actions}</ul>
      </div>
    </div>
  `;
}

function toggleCardRow(rowId) {
  const row = document.getElementById(`card-detail-${rowId}`);
  if (row) row.style.display = row.style.display !== 'none' ? 'none' : 'table-row';
}

// ── Chat ──────────────────────────────────────────────────────────────────

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
  document.getElementById('chatInput').value = btn.textContent.trim();
  document.getElementById('chatSuggestions').style.display = 'none';
  sendChatMessage();
}

async function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const msg   = input.value.trim();
  if (!msg) return;
  input.value = '';
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
        message:    msg,
        history:    chatHistory.slice(-8),
        session_id: currentPayerId,
        population: getPopulation(),
      }),
    });
    const data = await res.json();
    typingEl.remove();
    document.getElementById('chatSendBtn').disabled = false;
    if (data.error) throw new Error(data.error);
    chatHistory.push({ role: 'assistant', content: data.response });
    appendChatMsg('assistant', data.response);
  } catch (err) {
    typingEl.remove();
    document.getElementById('chatSendBtn').disabled = false;
    appendChatMsg('assistant', `Sorry, I ran into an issue: ${err.message}`);
  }
}

function appendChatMsg(role, text) {
  const messages = document.getElementById('chatMessages');
  const div      = document.createElement('div');
  div.className  = `chat-msg ${role}`;
  const bubble   = document.createElement('div');
  bubble.className = 'chat-msg-bubble';
  bubble.innerHTML = role === 'assistant' ? markdownToHtml(text) : esc(text);
  div.appendChild(bubble);
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

document.getElementById('chatInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
});

// ── Utilities ─────────────────────────────────────────────────────────────

function esc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function markdownToHtml(str) {
  if (!str) return '';
  let s = esc(str);
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
  s = s.replace(/`([^`\n]+)`/g, '<code style="background:#1e2d3d;padding:1px 5px;border-radius:3px;font-size:0.85em">$1</code>');
  const lines = s.split('\n');
  const out = [];
  let inList = false;
  for (const line of lines) {
    const m = line.match(/^[-•]\s+(.+)/);
    if (m) {
      if (!inList) { out.push('<ul style="margin:6px 0 6px 16px;padding:0;line-height:1.6">'); inList = true; }
      out.push(`<li>${m[1]}</li>`);
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(line);
    }
  }
  if (inList) out.push('</ul>');
  s = out.join('\n').replace(/\n\n+/g, '<br><br>').replace(/\n/g, '<br>');
  return s;
}

// ── Demo contracts ────────────────────────────────────────────────────────

async function loadDemoContract(name) {
  const filenames = {
    aetna:       'contract_aetna.pdf',
    humana:      'contract_humana.pdf',
    unitedhealth:'contract_unitedhealth.pdf',
    meridian:    'contract_meridian.pdf',
  };
  const filename = filenames[name];
  if (!filename) return;

  // Fetch the PDF from the backend contracts/ directory via a dedicated endpoint
  const res = await fetch(`${API_BASE}/demo-contracts/${filename}`);
  if (!res.ok) { alert(`Could not load demo contract: ${filename}`); return; }
  const blob = await res.blob();
  const file = new File([blob], filename, { type: 'application/pdf' });

  const queueId = addToQueue(file);
  await uploadAndParse(file, queueId);
}

function showLoading(msg) {
  document.getElementById('loadingText').textContent = msg || 'Loading…';
  document.getElementById('loadingOverlay').classList.remove('hidden');
}
function hideLoading() {
  document.getElementById('loadingOverlay').classList.add('hidden');
}
