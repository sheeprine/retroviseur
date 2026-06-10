const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

const FORMATS = {
  classic: {
    name: 'Classic',
    columns: [
      { id: 'went-well', title: 'Went Well', color: '#10b981' },
      { id: 'improve', title: 'To Improve', color: '#f59e0b' },
      { id: 'actions', title: 'Action Items', color: '#6366f1' }
    ]
  },
  start_stop_continue: {
    name: 'Start / Stop / Continue',
    columns: [
      { id: 'start', title: 'Start', color: '#10b981' },
      { id: 'stop', title: 'Stop', color: '#ef4444' },
      { id: 'continue', title: 'Continue', color: '#6366f1' }
    ]
  },
  four_ls: {
    name: '4 Ls',
    columns: [
      { id: 'liked', title: 'Liked', color: '#ec4899' },
      { id: 'learned', title: 'Learned', color: '#8b5cf6' },
      { id: 'lacked', title: 'Lacked', color: '#f59e0b' },
      { id: 'longed', title: 'Longed For', color: '#10b981' }
    ]
  },
  mad_sad_glad: {
    name: 'Mad / Sad / Glad',
    columns: [
      { id: 'mad', title: 'Mad', color: '#ef4444' },
      { id: 'sad', title: 'Sad', color: '#6366f1' },
      { id: 'glad', title: 'Glad', color: '#10b981' }
    ]
  }
};

const AVATAR_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#6366f1', '#a855f7', '#ec4899'
];

function avatarColor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

// Serialize a card from one viewer's perspective
function viewCard(card, revealed, viewerId) {
  return {
    id: card.id,
    columnId: card.columnId,
    text: card.text,
    authorName: (revealed || card.authorId === viewerId) ? card.authorName : null,
    isOwn: card.authorId === viewerId,
    voteCount: card.votes.size,
    hasVoted: card.votes.has(viewerId)
  };
}

// Emit a card event to every participant with their personalized view
function broadcastCard(event, room, card) {
  for (const [pid] of room.participants) {
    io.to(pid).emit(event, viewCard(card, room.revealed, pid));
  }
}

function serializeRoom(room, viewerId) {
  return {
    code: room.code,
    name: room.name,
    format: room.format,
    columns: room.columns,
    cards: [...room.cards.values()].map(c => viewCard(c, room.revealed, viewerId)),
    participants: [...room.participants.values()],
    facilitatorId: room.facilitatorId,
    revealed: room.revealed,
    blurred: room.blurred,
    markdown: room.markdown,
    maxVotes: room.maxVotes,
    isFacilitator: room.facilitatorId === viewerId
  };
}

function addParticipant(socket, room, name) {
  socket.join(room.code);
  room.participants.set(socket.id, {
    id: socket.id,
    name: (name || 'Anonymous').trim().slice(0, 30),
    color: avatarColor(socket.id)
  });
}

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('create-room', ({ name, roomName, format, maxVotes, blurred, markdown }, cb) => {
    const code = generateCode();
    const fmt = FORMATS[format] || FORMATS.classic;
    const room = {
      code,
      name: (roomName || 'Sprint Retro').trim().slice(0, 60),
      format,
      columns: fmt.columns,
      cards: new Map(),
      participants: new Map(),
      facilitatorId: socket.id,
      revealed: false,
      blurred: blurred === true,
      markdown: markdown !== false,
      maxVotes: Math.max(0, Math.min(99, parseInt(maxVotes) || 0))
    };
    rooms.set(code, room);
    addParticipant(socket, room, name);
    currentRoom = code;
    cb({ ok: true, room: serializeRoom(room, socket.id) });
  });

  socket.on('join-room', ({ code, name }, cb) => {
    const normalized = (code || '').toUpperCase().trim();
    const room = rooms.get(normalized);
    if (!room) return cb({ ok: false, error: 'Room not found. Check the code and try again.' });

    addParticipant(socket, room, name);
    currentRoom = room.code;

    // Claim facilitator if the previous facilitator socket is gone
    if (!room.participants.has(room.facilitatorId)) {
      room.facilitatorId = socket.id;
    }

    cb({ ok: true, room: serializeRoom(room, socket.id) });

    const p = room.participants.get(socket.id);
    socket.to(room.code).emit('participant-joined', { id: socket.id, ...p });
  });

  socket.on('add-card', ({ columnId, text }) => {
    const room = rooms.get(currentRoom);
    if (!room || !text?.trim()) return;

    const card = {
      id: uuidv4(),
      columnId,
      text: text.trim().slice(0, 500),
      authorId: socket.id,
      authorName: room.participants.get(socket.id)?.name || 'Anonymous',
      votes: new Set()
    };
    room.cards.set(card.id, card);
    broadcastCard('card-added', room, card);
  });

  socket.on('vote-card', ({ cardId }) => {
    const room = rooms.get(currentRoom);
    if (!room || room.blurred) return;
    const card = room.cards.get(cardId);
    if (!card) return;

    if (card.votes.has(socket.id)) {
      card.votes.delete(socket.id);
    } else {
      if (room.maxVotes > 0) {
        const used = [...room.cards.values()].reduce((n, c) => n + (c.votes.has(socket.id) ? 1 : 0), 0);
        if (used >= room.maxVotes) return;
      }
      card.votes.add(socket.id);
    }

    for (const [pid] of room.participants) {
      io.to(pid).emit('card-votes-updated', {
        cardId,
        voteCount: card.votes.size,
        hasVoted: card.votes.has(pid)
      });
    }
  });

  socket.on('delete-card', ({ cardId }) => {
    const room = rooms.get(currentRoom);
    if (!room) return;
    const card = room.cards.get(cardId);
    if (!card) return;
    if (card.authorId !== socket.id && room.facilitatorId !== socket.id) return;
    room.cards.delete(cardId);
    io.to(currentRoom).emit('card-deleted', { cardId });
  });

  socket.on('edit-card', ({ cardId, text }) => {
    const room = rooms.get(currentRoom);
    if (!room) return;
    const card = room.cards.get(cardId);
    if (!card || !text?.trim()) return;
    if (card.authorId !== socket.id && room.facilitatorId !== socket.id) return;
    card.text = text.trim().slice(0, 500);
    io.to(currentRoom).emit('card-updated', { cardId, text: card.text });
  });

  socket.on('toggle-reveal', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.facilitatorId !== socket.id) return;
    room.revealed = !room.revealed;
    const cardAuthors = [...room.cards.values()].map(c => ({
      id: c.id,
      authorName: room.revealed ? c.authorName : null
    }));
    io.to(currentRoom).emit('reveal-toggled', { revealed: room.revealed, cardAuthors });
  });

  socket.on('move-card', ({ cardId, columnId }) => {
    const room = rooms.get(currentRoom);
    if (!room) return;
    const card = room.cards.get(cardId);
    if (!card) return;
    if (card.authorId !== socket.id && room.facilitatorId !== socket.id) return;
    if (!room.columns.find(c => c.id === columnId)) return;
    card.columnId = columnId;
    io.to(currentRoom).emit('card-moved', { cardId, columnId });
  });

  socket.on('merge-card', ({ sourceCardId, targetCardId }) => {
    const room = rooms.get(currentRoom);
    if (!room) return;
    const source = room.cards.get(sourceCardId);
    const target = room.cards.get(targetCardId);
    if (!source || !target || sourceCardId === targetCardId) return;
    if (source.authorId !== socket.id && room.facilitatorId !== socket.id) return;
    target.text = (target.text + '\n\n' + source.text).slice(0, 500);
    for (const voterId of source.votes) target.votes.add(voterId);
    room.cards.delete(sourceCardId);
    io.to(currentRoom).emit('card-deleted', { cardId: sourceCardId });
    io.to(currentRoom).emit('card-updated', { cardId: targetCardId, text: target.text });
    for (const [pid] of room.participants) {
      io.to(pid).emit('card-votes-updated', {
        cardId: targetCardId,
        voteCount: target.votes.size,
        hasVoted: target.votes.has(pid)
      });
    }
  });

  socket.on('delegate-facilitator', ({ targetId }) => {
    const room = rooms.get(currentRoom);
    if (!room || room.facilitatorId !== socket.id) return;
    if (!room.participants.has(targetId)) return;
    room.facilitatorId = targetId;
    io.to(currentRoom).emit('facilitator-changed', { facilitatorId: targetId });
  });

  socket.on('toggle-blur', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.facilitatorId !== socket.id) return;
    room.blurred = !room.blurred;
    io.to(currentRoom).emit('blur-toggled', { blurred: room.blurred });
  });

  socket.on('toggle-markdown', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.facilitatorId !== socket.id) return;
    room.markdown = !room.markdown;
    io.to(currentRoom).emit('markdown-toggled', { markdown: room.markdown });
  });

  socket.on('clear-votes', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.facilitatorId !== socket.id) return;
    for (const card of room.cards.values()) card.votes.clear();
    io.to(currentRoom).emit('votes-cleared');
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    room.participants.delete(socket.id);
    io.to(currentRoom).emit('participant-left', { id: socket.id });

    if (room.facilitatorId === socket.id) {
      const next = room.participants.keys().next().value;
      if (next) {
        room.facilitatorId = next;
        io.to(currentRoom).emit('facilitator-changed', { facilitatorId: next });
      }
    }

    if (room.participants.size === 0) {
      setTimeout(() => {
        if (rooms.get(currentRoom)?.participants.size === 0) rooms.delete(currentRoom);
      }, 3_600_000);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Rétroviseur running at http://localhost:${PORT}`);
});
