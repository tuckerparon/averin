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
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch (_) {
      // Server returned non-JSON (likely a Vercel timeout or crash)
      const hint = res.status === 504 || text.includes('FUNCTION_INVOCATION_TIMEOUT')
        ? 'The request timed out — Vercel free plan limits functions to 10s. Upgrade to Pro or try a smaller file.'
        : `Server returned HTTP ${res.status}. Check Vercel logs for details.`;
      throw new Error(hint);
    }
    if (data.error) throw new Error(data.error);
    statusEl.textContent = `Done — ${data.metric_count} metrics`;
    statusEl.className = 'queue-status done';
    parsedPayers[data.payer] = data;
    renderContractBlock(data.payer, data.metrics);
    // Reveal dashboard section + divider on first parse
    document.getElementById('section-dashboard').classList.remove('hidden');
    document.getElementById('sectionDivider').classList.remove('hidden');
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

// ── Performance dashboard — payer cards ──────────────────────────────────

async function loadPayerPerformance(payer) {
  currentPayer = payer;
  showLoading(`Loading ${payer} performance…`);
  try {
    const res      = await fetch(API.performance(payer));
    hideLoading();
    const perfText = await res.text();
    let data;
    try { data = JSON.parse(perfText); }
    catch (_) { throw new Error(`Server returned HTTP ${res.status} — not JSON. Check Vercel logs.`); }
    if (data.error) throw new Error(data.error);
    renderPayerCard(data);
  } catch (err) {
    hideLoading();
    console.error('loadPayerPerformance error:', err);
    alert(`Could not load performance data: ${err.message}\n\nSee browser console (F12) for details.`);
  }
}

function renderPayerCard(data) {
  const grid = document.getElementById('payerCardsGrid');
  const existing = document.getElementById(`card-${data.payer}`);
  if (existing) existing.remove();

  const { star_rating, financial, counts, metrics, payer } = data;

  // Stars
  const filled = Math.floor(star_rating);
  const half   = (star_rating % 1) >= 0.3;
  const empty  = Math.max(0, 5 - filled - (half ? 1 : 0));
  const stars  = '★'.repeat(filled) + (half ? '½' : '') + '☆'.repeat(empty);

  // Status chips
  const chips = [
    counts.red    ? `<span class="card-chip red">● ${counts.red} failing</span>` : '',
    counts.yellow ? `<span class="card-chip yellow">● ${counts.yellow} at risk</span>` : '',
    counts.green  ? `<span class="card-chip green">● ${counts.green} on track</span>` : '',
  ].join('');

  // Opportunity
  const opp = financial.total_opportunity;
  const oppStr = opp >= 1000000 ? `$${(opp/1000000).toFixed(1)}M`
               : opp >= 1000    ? `$${Math.round(opp/1000)}K`
               : opp > 0        ? `$${opp.toLocaleString()}`
               : '$0';

  const starColor = star_rating >= 4 ? 'var(--teal-500)' : star_rating >= 3 ? '#F59E0B' : 'var(--red-mid)';

  const card = document.createElement('div');
  card.className = 'payer-card';
  card.id = `card-${payer}`;
  card.innerHTML = `
    <div class="payer-card-head">
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
      <tbody id="card-tbody-${payer}"></tbody>
    </table>
  `;
  grid.appendChild(card);

  // Sort: red → yellow → green → unknown
  const order = { red: 0, yellow: 1, green: 2, unknown: 3 };
  const sorted = [...metrics].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3));

  const tbody = document.getElementById(`card-tbody-${payer}`);
  sorted.forEach((m, idx) => {
    const rowId  = `${payer}-${idx}`;
    const status = m.status || 'unknown';
    const val    = m.current_performance?.current_value;
    const tgt    = m.target_display || (m.target_value != null ? m.target_value + '%' : '—');
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
       <div class="cd-val text-muted">No EHR data mapped to this metric.</div></div>`;
  const actList = actionsArray(m.improvement_actions);
  const actions = actList.length
    ? actList.map(a => `<li>${esc(a)}</li>`).join('')
    : '<li class="text-muted">—</li>';
  return `
    <div class="card-detail-panel">
      ${perfHtml}
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
  const bubble = document.createElement('div');
  bubble.className = 'chat-msg-bubble';
  if (role === 'assistant') {
    bubble.innerHTML = markdownToHtml(text);
  } else {
    bubble.textContent = text;
  }
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

// Markdown → HTML for assistant chat messages
function markdownToHtml(str) {
  if (!str) return '';
  let s = esc(str);
  // Bold: **text**
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  // Italic: *text* (single asterisk, not bold)
  s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
  // Inline code: `code`
  s = s.replace(/`([^`\n]+)`/g, '<code style="background:#1e2d3d;padding:1px 5px;border-radius:3px;font-size:0.85em">$1</code>');
  // Lists: lines starting with "- " or "* " or "• "
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
  s = out.join('\n');
  // Paragraph breaks and line breaks
  s = s.replace(/\n\n+/g, '<br><br>');
  s = s.replace(/\n/g, '<br>');
  return s;
}

function showLoading(msg) {
  document.getElementById('loadingText').textContent = msg || 'Loading…';
  document.getElementById('loadingOverlay').classList.remove('hidden');
}
function hideLoading() {
  document.getElementById('loadingOverlay').classList.add('hidden');
}

// No auto-load on init — every page load starts with the upload view only.
