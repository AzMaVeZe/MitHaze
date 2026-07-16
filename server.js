// שרת המשחק "מתחזה" – Express + Socket.IO.
// מנהל חדרים, מחלק תפקידים בפרטיות ומסנכרן את מצב המשחק בזמן אמת.

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import QRCode from 'qrcode';

import { CATEGORIES } from './data/words.js';
import {
  createRoom,
  getRoom,
  addPlayer,
  reconnectPlayer,
  markDisconnected,
  canStart,
  startRound,
  beginVoting,
  castVote,
  allVoted,
  tallyResults,
  resetToLobby,
  removePlayer,
  connectedPlayers,
  cleanupRooms,
  publicState,
  privateRole,
} from './src/rooms.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const PORT = process.env.PORT || 3000;

app.use(express.static(join(__dirname, 'public')));

// בריאות
app.get('/health', (_req, res) => res.json({ ok: true }));

// רשימת קטגוריות עבור מסך ההגדרות
app.get('/api/categories', (_req, res) => {
  res.json(CATEGORIES.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji })));
});

// יצירת QR עבור קישור הצטרפות
app.get('/api/qr', async (req, res) => {
  const url = String(req.query.url || '');
  if (!url) return res.status(400).json({ error: 'missing url' });
  try {
    const dataUrl = await QRCode.toDataURL(url, {
      width: 320,
      margin: 1,
      color: { dark: '#1a1333', light: '#ffffff' },
    });
    res.json({ dataUrl });
  } catch (e) {
    res.status(500).json({ error: 'qr failed' });
  }
});

// --- לוגיקת סוקטים ---

function roomChannel(code) {
  return `room:${code}`;
}

// משדר את המצב הציבורי לכל מי שבחדר, ואת התפקיד הפרטי לכל שחקן.
function broadcastRoom(room) {
  io.to(roomChannel(room.code)).emit('room:state', publicState(room));
  if (room.round && (room.phase === 'reveal' || room.phase === 'vote')) {
    for (const p of connectedPlayers(room)) {
      if (p.socketId) {
        io.to(p.socketId).emit('player:role', privateRole(room, p.id));
      }
    }
  }
}

io.on('connection', (socket) => {
  // --- מנחה יוצר חדר ---
  socket.on('host:create', async (settings, cb) => {
    const room = createRoom(settings || {});
    room.hostSocketId = socket.id;
    socket.join(roomChannel(room.code));
    socket.data.role = 'host';
    socket.data.code = room.code;
    respond(cb, {
      ok: true,
      code: room.code,
      hostToken: room.hostToken,
      state: publicState(room),
    });
  });

  // --- מנחה מתחבר מחדש ---
  socket.on('host:reconnect', (payload, cb) => {
    const room = getRoom(payload?.code);
    if (!room || room.hostToken !== payload?.hostToken) {
      return respond(cb, { ok: false, error: 'room-not-found' });
    }
    room.hostSocketId = socket.id;
    socket.join(roomChannel(room.code));
    socket.data.role = 'host';
    socket.data.code = room.code;
    respond(cb, { ok: true, code: room.code, state: publicState(room) });
    broadcastRoom(room);
  });

  // --- מנחה מעדכן הגדרות (רק בלובי) ---
  socket.on('host:updateSettings', (payload) => {
    const room = getRoom(socket.data.code);
    if (!room || room.hostSocketId !== socket.id || room.phase !== 'lobby') return;
    const s = payload || {};
    if (s.imposterCount != null) {
      room.settings.imposterCount = Math.max(1, Math.min(3, parseInt(s.imposterCount, 10) || 1));
    }
    if (s.categoryId != null) room.settings.categoryId = String(s.categoryId);
    if (s.imposterSeesCategory != null) room.settings.imposterSeesCategory = !!s.imposterSeesCategory;
    broadcastRoom(room);
  });

  // --- מנחה מתחיל סבב ---
  socket.on('host:start', () => {
    const room = getRoom(socket.data.code);
    if (!room || room.hostSocketId !== socket.id) return;
    if (!canStart(room)) return;
    startRound(room);
    broadcastRoom(room);
  });

  // --- מנחה עובר להצבעה ---
  socket.on('host:beginVoting', () => {
    const room = getRoom(socket.data.code);
    if (!room || room.hostSocketId !== socket.id || room.phase !== 'reveal') return;
    beginVoting(room);
    broadcastRoom(room);
  });

  // --- מנחה מסיים הצבעה וחושף תוצאות ---
  socket.on('host:reveal', () => {
    const room = getRoom(socket.data.code);
    if (!room || room.hostSocketId !== socket.id || room.phase !== 'vote') return;
    tallyResults(room);
    broadcastRoom(room);
  });

  // --- מנחה מתחיל סבב חדש (חזרה ללובי) ---
  socket.on('host:nextRound', () => {
    const room = getRoom(socket.data.code);
    if (!room || room.hostSocketId !== socket.id) return;
    resetToLobby(room);
    broadcastRoom(room);
  });

  // --- מנחה מסלק שחקן ---
  socket.on('host:kick', (payload) => {
    const room = getRoom(socket.data.code);
    if (!room || room.hostSocketId !== socket.id) return;
    const pid = payload?.playerId;
    const player = room.players.get(pid);
    if (player?.socketId) io.to(player.socketId).emit('player:kicked');
    removePlayer(room, pid);
    broadcastRoom(room);
  });

  // --- שחקן מצטרף ---
  socket.on('player:join', (payload, cb) => {
    const room = getRoom(payload?.code);
    if (!room) return respond(cb, { ok: false, error: 'room-not-found' });
    if (room.phase !== 'lobby') return respond(cb, { ok: false, error: 'game-in-progress' });
    const player = addPlayer(room, payload?.name, socket.id);
    socket.join(roomChannel(room.code));
    socket.data.role = 'player';
    socket.data.code = room.code;
    socket.data.playerId = player.id;
    respond(cb, { ok: true, playerId: player.id, code: room.code, state: publicState(room) });
    broadcastRoom(room);
  });

  // --- שחקן מתחבר מחדש ---
  socket.on('player:reconnect', (payload, cb) => {
    const room = getRoom(payload?.code);
    if (!room) return respond(cb, { ok: false, error: 'room-not-found' });
    const player = reconnectPlayer(room, payload?.playerId, socket.id);
    if (!player) return respond(cb, { ok: false, error: 'player-not-found' });
    socket.join(roomChannel(room.code));
    socket.data.role = 'player';
    socket.data.code = room.code;
    socket.data.playerId = player.id;
    respond(cb, { ok: true, playerId: player.id, code: room.code, state: publicState(room) });
    // שלח תפקיד פרטי אם באמצע סבב
    if (room.round && (room.phase === 'reveal' || room.phase === 'vote')) {
      socket.emit('player:role', privateRole(room, player.id));
    }
    broadcastRoom(room);
  });

  // --- שחקן מצביע ---
  socket.on('player:vote', (payload) => {
    const room = getRoom(socket.data.code);
    if (!room) return;
    const voterId = socket.data.playerId;
    if (!voterId) return;
    if (castVote(room, voterId, payload?.targetId)) {
      broadcastRoom(room);
      // אם כולם הצביעו – חשיפה אוטומטית
      if (allVoted(room)) {
        tallyResults(room);
        broadcastRoom(room);
      }
    }
  });

  socket.on('disconnect', () => {
    const result = markDisconnected(socket.id);
    if (result) broadcastRoom(result.room);
  });
});

function respond(cb, data) {
  if (typeof cb === 'function') cb(data);
}

setInterval(cleanupRooms, 30 * 60 * 1000);

httpServer.listen(PORT, () => {
  console.log(`🎭 מתחזה רץ על http://localhost:${PORT}`);
});
