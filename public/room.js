/* ── Drag state ── */
let draggedCardId = null;

/* ── State ── */
const state = {
  room: null,
  myName: '',
  isFacilitator: false,
  facilitatorId: null,
  cards: new Map(),        // cardId → card data
  participants: new Map(), // id → participant
  sortOrder: 'date'        // 'date' | 'votes' | 'random'
};

/* ── Socket ── */
const socket = io();

/* ── Boot ── */
(function boot() {
  const params = new URLSearchParams(location.search);
  const code = (params.get('code') || '').toUpperCase().trim();
  if (!code) { location.href = '/'; return; }

  // Try to use room state passed from index page (same session)
  const cached = sessionStorage.getItem('retro-room');
  if (cached) {
    try {
      const room = JSON.parse(cached);
      if (room.code === code) {
        sessionStorage.removeItem('retro-room');
        const name = localStorage.getItem('retro-name') || 'Anonymous';
        // Re-join with the socket (index page created a different socket)
        joinWithName(code, name);
        return;
      }
    } catch (_) {}
  }

  // Direct link — show name modal
  const savedName = localStorage.getItem('retro-name') || '';
  document.getElementById('modal-name').value = savedName;
  document.getElementById('join-modal').classList.remove('hidden');

  document.getElementById('join-modal-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('modal-name').value.trim();
    if (!name) return;
    localStorage.setItem('retro-name', name);
    document.getElementById('join-modal').classList.add('hidden');
    joinWithName(code, name);
  });

  if (savedName) {
    document.getElementById('modal-name').focus();
  }
})();

function joinWithName(code, name) {
  state.myName = name;
  socket.emit('join-room', { code, name }, ({ ok, room, error }) => {
    if (!ok) {
      document.getElementById('modal-error').textContent = error || 'Could not join room.';
      document.getElementById('join-modal').classList.remove('hidden');
      return;
    }
    initRoom(room);
  });
}

/* ── Init room ── */
function initRoom(room) {
  state.room = room;
  state.isFacilitator = room.isFacilitator;
  state.facilitatorId = room.facilitatorId;

  document.title = `${room.name} — Rétroviseur`;
  document.getElementById('room-title').textContent = room.name;
  document.getElementById('room-code-label').textContent = room.code;

  for (const p of room.participants) state.participants.set(p.id, p);
  for (const c of room.cards) state.cards.set(c.id, c);

  renderParticipants();
  renderFacilitatorControls();
  renderColumns();
  updateVotesCounter();

  document.getElementById('copy-btn').addEventListener('click', copyLink);
  document.getElementById('sort-btn').addEventListener('click', openSortDropdown);
  document.getElementById('export-pdf-btn').addEventListener('click', exportAllToPDF);
  document.getElementById('export-png-btn').addEventListener('click', exportAllToPNG);
  document.getElementById('markdown-btn')?.addEventListener('click', () => socket.emit('toggle-markdown'));
  document.getElementById('blur-btn')?.addEventListener('click', () => socket.emit('toggle-blur'));
  document.getElementById('reveal-btn')?.addEventListener('click', () => socket.emit('toggle-reveal'));
  document.getElementById('clear-votes-btn')?.addEventListener('click', () => {
    if (confirm('Clear all votes?')) socket.emit('clear-votes');
  });
  document.getElementById('delegate-btn')?.addEventListener('click', openDelegateDropdown);

  applyBlurState();
  applyMarkdownState();
}

/* ── Render helpers ── */
function renderParticipants() {
  const bar = document.getElementById('participants-bar');
  const all = [...state.participants.values()];
  bar.innerHTML = all.map(p => {
    const isFacil = p.id === state.facilitatorId;
    return `<div class="participant-row">` +
      `<div class="avatar${isFacil ? ' avatar-facilitator' : ''}" style="background:${p.color}">${initials(p.name)}</div>` +
      `<span class="participant-name${isFacil ? ' is-facilitator' : ''}">${escHtml(p.name)}</span>` +
      `</div>`;
  }).join('');
}

function renderFacilitatorControls() {
  const el = document.getElementById('facilitator-controls');
  if (state.isFacilitator) el.classList.remove('hidden');
  else el.classList.add('hidden');
  updateRevealBtn();
  updateBlurBtn();
}

function updateRevealBtn() {
  const btn = document.getElementById('reveal-btn');
  if (!btn) return;
  btn.textContent = state.room?.revealed ? '🙈 Hide authors' : '👁 Show authors';
}

function updateBlurBtn() {
  const btn = document.getElementById('blur-btn');
  if (!btn) return;
  btn.textContent = state.room?.blurred ? '👁 Unblur cards' : '🫣 Blur cards';
}

function applyBlurState() {
  const shouldBlur = state.room?.blurred && !state.isFacilitator;
  document.body.classList.toggle('cards-blurred', shouldBlur);
  updateBlurBtn();
}

function applyMarkdownState() {
  const btn = document.getElementById('markdown-btn');
  if (btn) btn.textContent = state.room?.markdown ? '🔤 Markdown on' : '🔤 Markdown off';
  rerenderAllCards();
}

function renderColumns() {
  const container = document.getElementById('columns-container');
  container.innerHTML = '';

  for (const col of state.room.columns) {
    const colEl = document.createElement('div');
    colEl.className = 'column';
    colEl.dataset.colId = col.id;
    colEl.innerHTML = `
      <div class="column-header" style="border-bottom-color:${col.color}">
        <div class="column-header-left">
          <span class="column-title">${escHtml(col.title)}</span>
          <span class="column-count" id="count-${col.id}">0</span>
        </div>
        <div class="column-export-btns">
          <button class="column-export-btn" data-export="pdf" title="Export to PDF">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            PDF
          </button>
          <button class="column-export-btn" data-export="png" title="Export to PNG">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            PNG
          </button>
        </div>
      </div>
      <div class="cards-list" id="cards-${col.id}"></div>
      <div class="add-card-area" id="add-area-${col.id}">
        <button class="add-card-btn" data-col="${col.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add a card
        </button>
      </div>`;
    container.appendChild(colEl);

    colEl.querySelector('[data-export="pdf"]').addEventListener('click', () => exportColumnToPDF(col.id));
    colEl.querySelector('[data-export="png"]').addEventListener('click', () => exportColumnToPNG(col.id));
    colEl.querySelector('.add-card-btn').addEventListener('click', () => openAddForm(col.id));
    colEl.addEventListener('dblclick', (e) => {
      if (e.target.closest('.card, .add-card-area, button')) return;
      openAddForm(col.id);
    });

    const cardsList = colEl.querySelector('.cards-list');
    cardsList.addEventListener('dragover', (e) => {
      if (!draggedCardId) return;
      e.preventDefault();
      cardsList.classList.add('drag-over');
    });
    cardsList.addEventListener('dragleave', (e) => {
      if (!cardsList.contains(e.relatedTarget)) cardsList.classList.remove('drag-over');
    });
    cardsList.addEventListener('drop', (e) => {
      e.preventDefault();
      cardsList.classList.remove('drag-over');
      if (!draggedCardId) return;
      const card = state.cards.get(draggedCardId);
      if (!card || card.columnId === col.id) return;
      socket.emit('move-card', { cardId: draggedCardId, columnId: col.id });
    });
  }

  // Render all existing cards in sorted order per column
  for (const col of state.room.columns) {
    for (const card of getSortedColumnCards(col.id)) renderCard(card);
  }
  updateCounts();
}

/* ── Card rendering ── */
function renderCard(card, prepend = false) {
  const list = document.getElementById(`cards-${card.columnId}`);
  if (!list) return;

  const existing = document.getElementById(`card-${card.id}`);
  if (existing) { updateCardEl(existing, card); return; }

  const el = document.createElement('div');
  el.className = `card${card.isOwn ? ' is-own' : ''}`;
  el.id = `card-${card.id}`;
  el.innerHTML = cardHTML(card);

  if (prepend) list.prepend(el);
  else list.appendChild(el);

  bindCardEvents(el, card);
}

function cardHTML(card) {
  const canEdit = card.isOwn || state.isFacilitator;
  const editBtn = canEdit
    ? `<button class="action-btn edit-btn" title="Edit">✏️</button>`
    : '';
  const deleteBtn = canEdit
    ? `<button class="action-btn danger delete-btn" title="Delete">🗑</button>`
    : '';
  const author = card.authorName
    ? `<div class="card-author">— ${escHtml(card.authorName)}</div>`
    : '';
  const votedClass = card.hasVoted ? ' voted' : '';
  const max = state.room?.maxVotes;
  const atLimit = max > 0 && countMyVotes() >= max && !card.hasVoted;
  return `
    <div class="card-text${state.room?.markdown ? '' : ' plain'}">${renderMd(card.text)}</div>
    ${author}
    <div class="card-footer">
      <button class="vote-btn${votedClass}" data-card="${card.id}"${atLimit ? ' disabled' : ''}>
        👍 <span class="vote-count">${card.voteCount}</span>
      </button>
      <div class="card-actions">${editBtn}${deleteBtn}</div>
    </div>`;
}

function updateCardEl(el, card) {
  if (el.querySelector('.card-edit-area')) return;
  const fresh = el.cloneNode(false);
  fresh.className = `card${card.isOwn ? ' is-own' : ''}`;
  fresh.innerHTML = cardHTML(card);
  el.replaceWith(fresh);
  bindCardEvents(fresh, card);
}

function bindCardEvents(el, card) {
  el.querySelector('.vote-btn')?.addEventListener('click', () => {
    if (state.room?.blurred && !state.isFacilitator && !card.isOwn) return;
    socket.emit('vote-card', { cardId: card.id });
  });
  el.querySelector('.delete-btn')?.addEventListener('click', () => {
    if (confirm('Delete this card?')) socket.emit('delete-card', { cardId: card.id });
  });
  el.querySelector('.edit-btn')?.addEventListener('click', () => openEditInline(el, card));

  const canEdit = card.isOwn || state.isFacilitator;
  if (canEdit) el.addEventListener('dblclick', (e) => {
    if (e.target.closest('button, textarea, .card-edit-actions')) return;
    openEditInline(el, card);
  });

  const canMove = card.isOwn || state.isFacilitator;
  el.draggable = canMove;
  el.ondragstart = canMove ? (e) => {
    if (e.target.closest('button, textarea')) return;
    draggedCardId = card.id;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => el.classList.add('dragging'), 0);
  } : null;
  el.ondragend = canMove ? () => {
    draggedCardId = null;
    el.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(d => d.classList.remove('drag-over'));
    document.querySelectorAll('.merge-target').forEach(d => d.classList.remove('merge-target'));
  } : null;

  el.addEventListener('dragover', (e) => {
    if (!draggedCardId || draggedCardId === card.id) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    el.classList.add('merge-target');
    el.closest('.cards-list')?.classList.remove('drag-over');
  });
  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget)) el.classList.remove('merge-target');
  });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('merge-target');
    if (!draggedCardId || draggedCardId === card.id) return;
    socket.emit('merge-card', { sourceCardId: draggedCardId, targetCardId: card.id });
  });
}

/* ── Inline edit ── */
function openEditInline(el, card) {
  if (el.querySelector('.card-edit-area')) return;
  const textEl = el.querySelector('.card-text');
  const footer = el.querySelector('.card-footer');
  const author = el.querySelector('.card-author');
  const original = card.text;

  textEl.style.display = 'none';
  if (author) author.style.display = 'none';
  footer.style.display = 'none';

  const textarea = document.createElement('textarea');
  textarea.className = 'card-edit-area';
  textarea.value = original;

  const actions = document.createElement('div');
  actions.className = 'card-edit-actions';
  actions.innerHTML = `<button class="btn btn-sm btn-ghost cancel-edit">Cancel</button>
    <button class="btn btn-sm btn-primary save-edit">Save</button>`;

  el.appendChild(textarea);
  el.appendChild(actions);
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  const save = () => {
    const text = textarea.value.trim();
    if (text && text !== original) socket.emit('edit-card', { cardId: card.id, text });
    cancel();
  };
  const cancel = () => {
    textarea.remove();
    actions.remove();
    textEl.style.display = '';
    if (author) author.style.display = '';
    footer.style.display = '';
  };

  actions.querySelector('.save-edit').addEventListener('click', save);
  actions.querySelector('.cancel-edit').addEventListener('click', cancel);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
  });
}

/* ── Add card form ── */
function openAddForm(columnId) {
  const area = document.getElementById(`add-area-${columnId}`);
  if (area.querySelector('.add-card-form')) return; // already open

  const btn = area.querySelector('.add-card-btn');
  btn.style.display = 'none';

  const form = document.createElement('div');
  form.className = 'add-card-form';
  form.innerHTML = `<textarea placeholder="What's on your mind?" maxlength="500" rows="3"></textarea>
    <div class="add-card-form-actions">
      <button class="btn btn-sm btn-ghost cancel-add">Cancel</button>
      <button class="btn btn-sm btn-primary submit-add">Add card</button>
    </div>`;
  area.appendChild(form);

  const ta = form.querySelector('textarea');
  ta.focus();

  const submit = () => {
    const text = ta.value.trim();
    if (text) socket.emit('add-card', { columnId, text });
    close();
  };
  const close = () => {
    form.remove();
    btn.style.display = '';
  };

  form.querySelector('.submit-add').addEventListener('click', submit);
  form.querySelector('.cancel-add').addEventListener('click', close);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
  });
}

/* ── Votes counter ── */
function countMyVotes() {
  return [...state.cards.values()].filter(c => c.hasVoted).length;
}

function updateVotesCounter() {
  const el = document.getElementById('votes-counter');
  if (!el) return;
  const max = state.room?.maxVotes;
  if (!max) { el.classList.add('hidden'); return; }
  const used = countMyVotes();
  const left = max - used;
  el.textContent = `${left} vote${left !== 1 ? 's' : ''} left`;
  el.classList.toggle('hidden', false);
  el.classList.toggle('exhausted', left === 0);
}

function updateVoteButtons() {
  const max = state.room?.maxVotes;
  if (!max) return;
  const atLimit = countMyVotes() >= max;
  for (const [, card] of state.cards) {
    const btn = document.querySelector(`#card-${card.id} .vote-btn`);
    if (btn) btn.disabled = atLimit && !card.hasVoted;
  }
}

/* ── Count badges ── */
function updateCounts() {
  if (!state.room) return;
  for (const col of state.room.columns) {
    const count = [...state.cards.values()].filter(c => c.columnId === col.id).length;
    const el = document.getElementById(`count-${col.id}`);
    if (el) el.textContent = count;
  }
}

/* ── Delegate facilitator ── */
function openDelegateDropdown() {
  const existing = document.getElementById('delegate-dropdown');
  if (existing) { existing.remove(); return; }

  const others = [...state.participants.values()].filter(p => p.id !== socket.id);
  if (others.length === 0) return;

  const dropdown = document.createElement('div');
  dropdown.id = 'delegate-dropdown';
  dropdown.className = 'delegate-dropdown';
  dropdown.innerHTML = others.map(p =>
    `<div class="delegate-dropdown-item" data-id="${escHtml(p.id)}">` +
    `<span class="avatar-mini" style="background:${p.color}">${escHtml(initials(p.name))}</span>` +
    `${escHtml(p.name)}</div>`
  ).join('');

  document.getElementById('facilitator-controls').appendChild(dropdown);

  dropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.delegate-dropdown-item');
    if (!item) return;
    socket.emit('delegate-facilitator', { targetId: item.dataset.id });
    dropdown.remove();
  });

  const closeOnOutside = (e) => {
    if (!dropdown.contains(e.target) && e.target !== document.getElementById('delegate-btn')) {
      dropdown.remove();
      document.removeEventListener('click', closeOnOutside);
    }
  };
  setTimeout(() => document.addEventListener('click', closeOnOutside), 0);
}

/* ── Sort ── */
const SORT_LABELS = { date: '⇅ Date', votes: '⇅ Votes', random: '⇅ Random' };

function getSortedColumnCards(colId) {
  const cards = [...state.cards.values()].filter(c => c.columnId === colId);
  if (state.sortOrder === 'votes') {
    cards.sort((a, b) => b.voteCount - a.voteCount);
  } else if (state.sortOrder === 'random') {
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
  }
  return cards;
}

function resortColumns() {
  if (!state.room) return;
  document.querySelectorAll('.card').forEach(el => el.style.animation = 'none');
  for (const col of state.room.columns) {
    const list = document.getElementById(`cards-${col.id}`);
    if (!list) continue;
    for (const card of getSortedColumnCards(col.id)) {
      const el = document.getElementById(`card-${card.id}`);
      if (el) list.appendChild(el);
    }
  }
  requestAnimationFrame(() => {
    document.querySelectorAll('.card').forEach(el => el.style.animation = '');
  });
}

function openSortDropdown() {
  const existing = document.getElementById('sort-dropdown');
  if (existing) { existing.remove(); return; }

  const options = [
    { value: 'date', label: 'Date' },
    { value: 'votes', label: 'Votes' },
    { value: 'random', label: 'Random' },
  ];

  const dropdown = document.createElement('div');
  dropdown.id = 'sort-dropdown';
  dropdown.className = 'sort-dropdown';
  dropdown.innerHTML = options.map(o =>
    `<div class="sort-dropdown-item${state.sortOrder === o.value ? ' active' : ''}" data-value="${o.value}">${o.label}</div>`
  ).join('');

  document.getElementById('sort-control').appendChild(dropdown);

  dropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.sort-dropdown-item');
    if (!item) return;
    state.sortOrder = item.dataset.value;
    document.getElementById('sort-btn').textContent = SORT_LABELS[state.sortOrder];
    resortColumns();
    dropdown.remove();
  });

  const closeOnOutside = (e) => {
    if (!dropdown.contains(e.target) && e.target !== document.getElementById('sort-btn')) {
      dropdown.remove();
      document.removeEventListener('click', closeOnOutside);
    }
  };
  setTimeout(() => document.addEventListener('click', closeOnOutside), 0);
}

/* ── Copy link ── */
function copyLink() {
  const url = `${location.origin}/room.html?code=${state.room.code}`;
  navigator.clipboard?.writeText(url).then(() => {
    const btn = document.getElementById('copy-btn');
    btn.classList.add('copy-success');
    btn.textContent = '✓ Copied!';
    setTimeout(() => {
      btn.classList.remove('copy-success');
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy link`;
    }, 2000);
  });
}

/* ── Toasts ── */
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 2900);
}

/* ── Socket events ── */
socket.on('card-added', (card) => {
  state.cards.set(card.id, card);
  renderCard(card, state.sortOrder === 'date');
  if (state.sortOrder === 'votes') resortColumns();
  updateCounts();
  if (!card.isOwn) {
    const authorLabel = card.authorName ? ` by ${card.authorName}` : '';
    toast(`New card added${authorLabel}`);
  }
});

socket.on('card-votes-updated', ({ cardId, voteCount, hasVoted }) => {
  const card = state.cards.get(cardId);
  if (!card) return;
  card.voteCount = voteCount;
  card.hasVoted = hasVoted;
  const el = document.getElementById(`card-${cardId}`);
  if (!el) return;
  const voteBtn = el.querySelector('.vote-btn');
  if (!voteBtn) return;
  voteBtn.className = `vote-btn${hasVoted ? ' voted' : ''}`;
  voteBtn.querySelector('.vote-count').textContent = voteCount;
  updateVotesCounter();
  updateVoteButtons();
  if (state.sortOrder === 'votes') resortColumns();
});

socket.on('card-updated', ({ cardId, text }) => {
  const card = state.cards.get(cardId);
  if (!card) return;
  card.text = text;
  const el = document.getElementById(`card-${cardId}`);
  if (el) updateCardEl(el, card);
});

socket.on('card-moved', ({ cardId, columnId }) => {
  const card = state.cards.get(cardId);
  if (!card) return;
  card.columnId = columnId;
  const el = document.getElementById(`card-${cardId}`);
  const targetList = document.getElementById(`cards-${columnId}`);
  if (el && targetList) targetList.appendChild(el);
  updateCounts();
});

socket.on('card-deleted', ({ cardId }) => {
  state.cards.delete(cardId);
  document.getElementById(`card-${cardId}`)?.remove();
  updateCounts();
});

socket.on('reveal-toggled', ({ revealed, cardAuthors }) => {
  state.room.revealed = revealed;
  updateRevealBtn();
  for (const { id, authorName } of cardAuthors) {
    const card = state.cards.get(id);
    if (!card) continue;
    card.authorName = authorName;
    const el = document.getElementById(`card-${id}`);
    if (!el) continue;
    const authorEl = el.querySelector('.card-author');
    if (authorName) {
      if (authorEl) authorEl.textContent = `— ${authorName}`;
      else {
        const div = document.createElement('div');
        div.className = 'card-author';
        div.textContent = `— ${authorName}`;
        el.querySelector('.card-text').after(div);
      }
    } else if (authorEl && !card.isOwn) {
      authorEl.remove();
    }
  }
  toast(revealed ? '👁 Author names revealed' : '🙈 Author names hidden');
});

socket.on('votes-cleared', () => {
  for (const card of state.cards.values()) {
    card.voteCount = 0;
    card.hasVoted = false;
    const el = document.getElementById(`card-${card.id}`);
    if (!el) continue;
    const voteBtn = el.querySelector('.vote-btn');
    if (!voteBtn) continue;
    voteBtn.className = 'vote-btn';
    voteBtn.disabled = false;
    voteBtn.querySelector('.vote-count').textContent = '0';
  }
  updateVotesCounter();
  toast('🗑 All votes cleared');
});

socket.on('participant-joined', (p) => {
  state.participants.set(p.id, p);
  renderParticipants();
  toast(`👋 ${p.name} joined`);
});

socket.on('participant-left', ({ id }) => {
  state.participants.delete(id);
  renderParticipants();
});

socket.on('blur-toggled', ({ blurred }) => {
  state.room.blurred = blurred;
  applyBlurState();
  toast(blurred ? '🫣 Cards blurred' : '👁 Cards visible');
});

socket.on('markdown-toggled', ({ markdown }) => {
  state.room.markdown = markdown;
  applyMarkdownState();
  toast(markdown ? '🔤 Markdown enabled' : '🔤 Markdown disabled');
});

socket.on('facilitator-changed', ({ facilitatorId }) => {
  state.facilitatorId = facilitatorId;
  const wasMe = state.isFacilitator;
  state.isFacilitator = facilitatorId === socket.id;
  if (state.isFacilitator && !wasMe) toast('👑 You are now the facilitator');
  renderFacilitatorControls();
  renderParticipants();
  applyBlurState();
});

socket.on('disconnect', () => {
  toast('⚡ Connection lost — reconnecting…');
});
socket.on('connect', () => {
  if (state.room) toast('✓ Reconnected');
});

/* ── Export to PDF ── */
function exportColumnToPDF(colId) {
  const col = state.room.columns.find(c => c.id === colId);
  if (!col) return;

  const cards = getSortedColumnCards(colId);
  const useMarkdown = !!state.room?.markdown;

  const cardRows = cards.map(card => {
    const textContent = useMarkdown
      ? DOMPurify.sanitize(marked.parse(String(card.text ?? '')))
      : escHtml(String(card.text ?? ''));
    const plainClass = useMarkdown ? '' : ' plain';
    const author = card.authorName ? `<div class="card-author">— ${escHtml(card.authorName)}</div>` : '';
    const votes = card.voteCount > 0 ? `<div class="card-votes">👍 ${card.voteCount} vote${card.voteCount !== 1 ? 's' : ''}</div>` : '';
    return `<div class="card"><div class="card-text${plainClass}">${textContent}</div>${author}${votes}</div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${escHtml(col.title)} — ${escHtml(state.room.name)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 32px; color: #1e293b; max-width: 680px; margin: 0 auto; }
    h1 { font-size: 20px; font-weight: 700; margin: 0 0 4px; border-bottom: 3px solid ${col.color}; padding-bottom: 8px; }
    .subtitle { font-size: 13px; color: #64748b; margin: 0 0 24px; }
    .card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin-bottom: 12px; page-break-inside: avoid; }
    .card-text { font-size: 14px; line-height: 1.6; word-break: break-word; }
    .card-text.plain { white-space: pre-wrap; }
    .card-text p { margin: 0 0 .4em; }
    .card-text ul, .card-text ol { margin: 0 0 .4em; padding-left: 1.4em; }
    .card-text code { font-size: 12px; background: rgba(0,0,0,.06); border-radius: 3px; padding: 1px 4px; }
    .card-text pre { font-size: 12px; background: rgba(0,0,0,.06); border-radius: 4px; padding: 8px; overflow-x: auto; margin: 0 0 .4em; }
    .card-text > :first-child { margin-top: 0; }
    .card-text > :last-child { margin-bottom: 0; }
    .card-author { font-size: 11px; color: #64748b; margin-top: 8px; }
    .card-votes { font-size: 12px; color: #64748b; margin-top: 4px; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <h1>${escHtml(col.title)}</h1>
  <div class="subtitle">${escHtml(state.room.name)} · ${cards.length} card${cards.length !== 1 ? 's' : ''}</div>
  ${cardRows || '<p style="color:#64748b;font-size:14px">No cards in this column.</p>'}
  <script>window.onload = function() { window.print(); }<\/script>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) { toast('Allow pop-ups to export PDF'); return; }
  win.document.write(html);
  win.document.close();
}

function exportAllToPDF() {
  const useMarkdown = !!state.room?.markdown;
  const totalCards = [...state.cards.values()].length;

  const CSS = `
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 32px; color: #1e293b; max-width: 680px; margin: 0 auto; }
    h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px; }
    .room-subtitle { font-size: 13px; color: #64748b; margin: 0 0 32px; }
    h2 { font-size: 18px; font-weight: 700; margin: 0 0 4px; border-bottom: 3px solid; padding-bottom: 8px; }
    .col-subtitle { font-size: 13px; color: #64748b; margin: 0 0 16px; }
    .card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin-bottom: 10px; page-break-inside: avoid; }
    .card-text { font-size: 14px; line-height: 1.6; word-break: break-word; }
    .card-text.plain { white-space: pre-wrap; }
    .card-text p { margin: 0 0 .4em; } .card-text ul,.card-text ol { margin: 0 0 .4em; padding-left: 1.4em; }
    .card-text code { font-size: 12px; background: rgba(0,0,0,.06); border-radius: 3px; padding: 1px 4px; }
    .card-text pre { font-size: 12px; background: rgba(0,0,0,.06); border-radius: 4px; padding: 8px; overflow-x: auto; margin: 0 0 .4em; }
    .card-text > :first-child { margin-top: 0; } .card-text > :last-child { margin-bottom: 0; }
    .card-author { font-size: 11px; color: #64748b; margin-top: 8px; }
    .card-votes { font-size: 12px; color: #64748b; margin-top: 4px; }
    .empty { font-size: 14px; color: #94a3b8; margin: 0; }
    @media print { body { padding: 0; } }`;

  const sections = state.room.columns.map((col, i) => {
    const cards = getSortedColumnCards(col.id);
    const cardRows = cards.map(card => {
      const textContent = useMarkdown
        ? DOMPurify.sanitize(marked.parse(String(card.text ?? '')))
        : escHtml(String(card.text ?? ''));
      const author = card.authorName ? `<div class="card-author">— ${escHtml(card.authorName)}</div>` : '';
      const votes = card.voteCount > 0 ? `<div class="card-votes">👍 ${card.voteCount} vote${card.voteCount !== 1 ? 's' : ''}</div>` : '';
      return `<div class="card"><div class="card-text${useMarkdown ? '' : ' plain'}">${textContent}</div>${author}${votes}</div>`;
    }).join('');
    const breakStyle = i > 0 ? ' style="page-break-before:always"' : '';
    return `<section${breakStyle}>
      <h2 style="border-bottom-color:${col.color}">${escHtml(col.title)}</h2>
      <div class="col-subtitle">${cards.length} card${cards.length !== 1 ? 's' : ''}</div>
      ${cardRows || '<p class="empty">No cards in this column.</p>'}
    </section>`;
  }).join('');

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
    <title>${escHtml(state.room.name)}</title><style>${CSS}</style></head>
    <body>
      <h1>${escHtml(state.room.name)}</h1>
      <div class="room-subtitle">${state.room.columns.length} columns · ${totalCards} card${totalCards !== 1 ? 's' : ''} total</div>
      ${sections}
      <script>window.onload=function(){window.print()}<\/script>
    </body></html>`;

  const win = window.open('', '_blank');
  if (!win) { toast('Allow pop-ups to export PDF'); return; }
  win.document.write(html);
  win.document.close();
}

/* ── PNG helpers (shared) ── */
const PNG_FONT = '"Helvetica Neue", Arial, sans-serif';
let _pngMCtx = null;
function pngWrap(text, maxW, fs) {
  if (!_pngMCtx) _pngMCtx = document.createElement('canvas').getContext('2d');
  _pngMCtx.font = `${fs}px ${PNG_FONT}`;
  const lines = [];
  for (const para of String(text ?? '').split('\n')) {
    if (!para) { lines.push(''); continue; }
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (line && _pngMCtx.measureText(test).width > maxW) { lines.push(line); line = word; }
      else line = test;
    }
    if (line) lines.push(line);
  }
  return lines;
}
function pngStripHtml(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.textContent || '';
}
function pngRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function pngCardData(cards, textW, cardPad) {
  const TEXT_FS = 14, TEXT_LH = 22, AUTHOR_FS = 11, AUTHOR_LH = 16, VOTES_FS = 12, VOTES_LH = 18;
  return cards.map(card => {
    const rawText = state.room?.markdown
      ? pngStripHtml(DOMPurify.sanitize(marked.parse(String(card.text ?? ''))))
      : String(card.text ?? '');
    const textLines = pngWrap(rawText, textW, TEXT_FS);
    const authorStr = card.authorName ? `— ${card.authorName}` : null;
    const authorLines = authorStr ? pngWrap(authorStr, textW, AUTHOR_FS) : [];
    const votesStr = card.voteCount > 0 ? `👍 ${card.voteCount} vote${card.voteCount !== 1 ? 's' : ''}` : null;
    let h = cardPad + textLines.length * TEXT_LH;
    if (authorStr) h += 8 + authorLines.length * AUTHOR_LH;
    if (votesStr) h += 6 + VOTES_LH;
    h += cardPad;
    return { textLines, authorStr, authorLines, votesStr, h };
  });
}
function pngDrawCards(ctx, cardData, x, y, colW, cardPad, cardGap) {
  const TEXT_FS = 14, TEXT_LH = 22, AUTHOR_FS = 11, AUTHOR_LH = 16, VOTES_FS = 12, VOTES_LH = 18;
  for (const card of cardData) {
    pngRoundRect(ctx, x, y, colW, card.h, 8);
    ctx.fillStyle = '#f8fafc'; ctx.fill();
    ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1.5; ctx.stroke();

    const px = x + cardPad;
    let cy = y + cardPad;
    ctx.fillStyle = '#1e293b';
    ctx.font = `${TEXT_FS}px ${PNG_FONT}`;
    for (const line of card.textLines) { ctx.fillText(line, px, cy); cy += TEXT_LH; }

    if (card.authorStr) {
      cy += 8;
      ctx.fillStyle = '#64748b';
      ctx.font = `${AUTHOR_FS}px ${PNG_FONT}`;
      for (const line of card.authorLines) { ctx.fillText(line, px, cy); cy += AUTHOR_LH; }
    }
    if (card.votesStr) {
      cy += 6;
      ctx.fillStyle = '#64748b';
      ctx.font = `${VOTES_FS}px ${PNG_FONT}`;
      ctx.fillText(card.votesStr, px, cy);
    }
    y += card.h + cardGap;
  }
}

/* ── Export to PNG ── */
function exportColumnToPNG(colId) {
  const col = state.room.columns.find(c => c.id === colId);
  if (!col) return;
  const cards = getSortedColumnCards(colId);

  const DPR = 2, PAD = 28, CARD_PAD = 14, CARD_GAP = 10;
  const INNER_W = 504, W = INNER_W + PAD * 2;
  const TEXT_W = INNER_W - CARD_PAD * 2;
  const TEXT_LH = 22, TITLE_FS = 20, SUBTITLE_FS = 13;

  const cardData = pngCardData(cards, TEXT_W, CARD_PAD);

  let totalH = PAD + TITLE_FS + 4 + 3 + 8 + SUBTITLE_FS + 20;
  if (cardData.length === 0) { totalH += TEXT_LH; }
  else { for (const c of cardData) totalH += c.h + CARD_GAP; totalH -= CARD_GAP; }
  totalH += PAD;

  const canvas = document.createElement('canvas');
  canvas.width = W * DPR;
  canvas.height = totalH * DPR;
  const ctx = canvas.getContext('2d');
  ctx.scale(DPR, DPR);
  ctx.textBaseline = 'top';

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, totalH);

  let y = PAD;

  ctx.fillStyle = '#1e293b';
  ctx.font = `700 ${TITLE_FS}px ${PNG_FONT}`;
  ctx.fillText(col.title, PAD, y);
  y += TITLE_FS + 4;

  ctx.fillStyle = col.color;
  ctx.fillRect(PAD, y, INNER_W, 3);
  y += 3 + 8;

  ctx.fillStyle = '#94a3b8';
  ctx.font = `${SUBTITLE_FS}px ${PNG_FONT}`;
  ctx.fillText(`${state.room.name} · ${cards.length} card${cards.length !== 1 ? 's' : ''}`, PAD, y);
  y += SUBTITLE_FS + 20;

  if (cardData.length === 0) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = `14px ${PNG_FONT}`;
    ctx.fillText('No cards in this column.', PAD, y);
  }

  pngDrawCards(ctx, cardData, PAD, y, INNER_W, CARD_PAD, CARD_GAP);

  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `${col.title}.png`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  });
}

function exportAllToPNG() {
  const DPR = 2, PAD = 28, COL_GAP = 20, CARD_PAD = 14, CARD_GAP = 10;
  const COL_W = 504, TEXT_W = COL_W - CARD_PAD * 2;
  const TEXT_LH = 22, TITLE_FS = 20, SUBTITLE_FS = 13, ROOM_TITLE_FS = 22;

  const cols = state.room.columns;
  const totalCards = [...state.cards.values()].length;

  const colData = cols.map(col => {
    const cards = getSortedColumnCards(col.id);
    const cardData = pngCardData(cards, TEXT_W, CARD_PAD);
    const cardsH = cardData.length === 0
      ? TEXT_LH
      : cardData.reduce((s, c) => s + c.h + CARD_GAP, 0) - CARD_GAP;
    return { col, cards, cardData, cardsH };
  });

  const roomHeaderH = ROOM_TITLE_FS + 4 + 3 + 10 + SUBTITLE_FS + 24;
  const colHeaderH  = TITLE_FS + 4 + 3 + 8 + SUBTITLE_FS + 20;
  const maxCardsH   = Math.max(0, ...colData.map(c => c.cardsH));
  const innerW      = cols.length * COL_W + Math.max(0, cols.length - 1) * COL_GAP;
  const W           = PAD + innerW + PAD;
  const totalH      = PAD + roomHeaderH + colHeaderH + maxCardsH + PAD;

  const canvas = document.createElement('canvas');
  canvas.width  = W * DPR;
  canvas.height = totalH * DPR;
  const ctx = canvas.getContext('2d');
  ctx.scale(DPR, DPR);
  ctx.textBaseline = 'top';

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, totalH);

  let y = PAD;

  ctx.fillStyle = '#1e293b';
  ctx.font = `700 ${ROOM_TITLE_FS}px ${PNG_FONT}`;
  ctx.fillText(state.room.name, PAD, y);
  y += ROOM_TITLE_FS + 4;

  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(PAD, y, innerW, 3);
  y += 3 + 10;

  ctx.fillStyle = '#94a3b8';
  ctx.font = `${SUBTITLE_FS}px ${PNG_FONT}`;
  ctx.fillText(`${cols.length} column${cols.length !== 1 ? 's' : ''} · ${totalCards} card${totalCards !== 1 ? 's' : ''} total`, PAD, y);
  y += SUBTITLE_FS + 24;

  for (let i = 0; i < colData.length; i++) {
    const { col, cards, cardData } = colData[i];
    const x = PAD + i * (COL_W + COL_GAP);
    let cy = y;

    ctx.fillStyle = '#1e293b';
    ctx.font = `700 ${TITLE_FS}px ${PNG_FONT}`;
    ctx.fillText(col.title, x, cy);
    cy += TITLE_FS + 4;

    ctx.fillStyle = col.color;
    ctx.fillRect(x, cy, COL_W, 3);
    cy += 3 + 8;

    ctx.fillStyle = '#94a3b8';
    ctx.font = `${SUBTITLE_FS}px ${PNG_FONT}`;
    ctx.fillText(`${cards.length} card${cards.length !== 1 ? 's' : ''}`, x, cy);
    cy += SUBTITLE_FS + 20;

    if (cardData.length === 0) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = `14px ${PNG_FONT}`;
      ctx.fillText('No cards in this column.', x, cy);
    } else {
      pngDrawCards(ctx, cardData, x, cy, COL_W, CARD_PAD, CARD_GAP);
    }
  }

  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `${state.room.name}.png`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  });
}

/* ── Utils ── */
function renderMd(text) {
  if (!state.room?.markdown) return escHtml(String(text ?? ''));
  return DOMPurify.sanitize(marked.parse(String(text ?? '')));
}

function rerenderAllCards() {
  for (const card of state.cards.values()) {
    const el = document.getElementById(`card-${card.id}`);
    if (el) updateCardEl(el, card);
  }
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function initials(name) {
  return (name || '?').trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}
