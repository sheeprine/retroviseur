/* ── Drag state ── */
let draggedCardId = null;

/* ── State ── */
const state = {
  room: null,
  myName: '',
  isFacilitator: false,
  facilitatorId: null,
  cards: new Map(),        // cardId → card data
  participants: new Map()  // id → participant
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
  document.getElementById('blur-btn')?.addEventListener('click', () => socket.emit('toggle-blur'));
  document.getElementById('reveal-btn')?.addEventListener('click', () => socket.emit('toggle-reveal'));
  document.getElementById('clear-votes-btn')?.addEventListener('click', () => {
    if (confirm('Clear all votes?')) socket.emit('clear-votes');
  });
  document.getElementById('delegate-btn')?.addEventListener('click', openDelegateDropdown);

  applyBlurState();
}

/* ── Render helpers ── */
function renderParticipants() {
  const bar = document.getElementById('participants-bar');
  const all = [...state.participants.values()];
  const MAX = 6;
  const shown = all.slice(0, MAX);
  const extra = all.length - MAX;

  bar.innerHTML = shown.map(p => {
    const isFacil = p.id === state.facilitatorId;
    return `<div class="avatar${isFacil ? ' avatar-facilitator' : ''}" style="background:${p.color}" title="${escHtml(p.name)}${isFacil ? ' (facilitator)' : ''}">${initials(p.name)}</div>`;
  }).join('') + (extra > 0 ? `<div class="avatar avatar-overflow">+${extra}</div>` : '');
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
      </div>
      <div class="cards-list" id="cards-${col.id}"></div>
      <div class="add-card-area" id="add-area-${col.id}">
        <button class="add-card-btn" data-col="${col.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add a card
        </button>
      </div>`;
    container.appendChild(colEl);

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

  // Render all existing cards
  for (const card of state.cards.values()) renderCard(card);
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
    <div class="card-text">${escHtml(card.text)}</div>
    ${author}
    <div class="card-footer">
      <button class="vote-btn${votedClass}" data-card="${card.id}"${atLimit ? ' disabled' : ''}>
        👍 <span class="vote-count">${card.voteCount}</span>
      </button>
      <div class="card-actions">${editBtn}${deleteBtn}</div>
    </div>`;
}

function updateCardEl(el, card) {
  el.className = `card${card.isOwn ? ' is-own' : ''}`;
  el.innerHTML = cardHTML(card);
  bindCardEvents(el, card);
}

function bindCardEvents(el, card) {
  el.querySelector('.vote-btn')?.addEventListener('click', () => {
    if (state.room?.blurred && !state.isFacilitator) return;
    socket.emit('vote-card', { cardId: card.id });
  });
  el.querySelector('.delete-btn')?.addEventListener('click', () => {
    if (confirm('Delete this card?')) socket.emit('delete-card', { cardId: card.id });
  });
  el.querySelector('.edit-btn')?.addEventListener('click', () => openEditInline(el, card));

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
  } : null;
}

/* ── Inline edit ── */
function openEditInline(el, card) {
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
  renderCard(card, true);
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
});

socket.on('card-updated', ({ cardId, text }) => {
  const card = state.cards.get(cardId);
  if (!card) return;
  card.text = text;
  const el = document.getElementById(`card-${cardId}`);
  if (el) {
    const textEl = el.querySelector('.card-text');
    if (textEl) textEl.textContent = text;
  }
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

/* ── Utils ── */
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
