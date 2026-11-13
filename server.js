// שרת המשחק "מתחזה" – Express + Socket.IO.
// מנהל חדרים, מחלק תפקידים בפרטיות ומסנכרן את מצב המשחק בזמן אמת.

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import QRCode from 'qrcode';
import { readFileSync } from 'fs';
import { createHash, timingSafeEqual } from 'crypto';

import { CATEGORIES } from './data/words.js';
import {
  createRoom,
  getRoom,
  addPlayer,
  reconnectPlayer,
  HOST_VERIFIED,
  markDisconnected,
  canStart,
  startRound,
  beginVoting,
  completeTurn,
  addClue,
  submitMarks,
  submitGuess,
  roundComplete,
  tallyResults,
  resetToLobby,
  removePlayer,
  connectedPlayers,
  cleanupRooms,
  touchRoom,
  publicState,
  privateRole,
  clampInt,
  validCategory,
} from './src/rooms.js';
import { incrementGamesPlayed, getStats } from './src/stats.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
// הודעות המשחק קטנות מאוד; ברירת המחדל (1MB להודעה) מאפשרת לנפח זיכרון בקלות.
const io = new Server(httpServer, { maxHttpBufferSize: 10_000 });

const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
// הפרסר המורחב של Express 4 (qs) בונה אובייקטים מקוננים מה-query; אין בהם צורך כאן.
app.set('query parser', 'simple');

// כותרות אבטחה. 'unsafe-inline' רק לסגנונות (style="..." ב-HTML שנוצר בקוד) —
// סקריפטים מותרים רק מהאתר עצמו, כך ששם שחקן זדוני לא יכול להריץ קוד.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
app.use((_req, res, next) => {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
});

// express.static מתעלם מ-dotfiles כברירת מחדל (dotfiles:'ignore') — אבל
// /.well-known/assetlinks.json (אימות Android App Links ל-TWA) חייב להיות מוגש.
// מגדירים סטטיק ייעודי שמאפשר dotfiles רק תחת /.well-known, בלי לפרוץ את
// ברירת המחדל הבטוחה לשאר האתר.
app.use('/.well-known', express.static(join(__dirname, 'public', '.well-known'), { dotfiles: 'allow' }));
app.use(express.static(join(__dirname, 'public')));

// בריאות — כולל גרסה כדי שאפשר יהיה לוודא איזו מהדורה רצה בפרודקשן
const VERSION = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8')).version;
app.get('/health', (_req, res) => res.json({ ok: true, version: VERSION }));

// רשימת קטגוריות עבור מסך ההגדרות
app.get('/api/categories', (_req, res) => {
  res.json(CATEGORIES.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji })));
});

// סטטיסטיקה פנימית (לא מקושרת משום מקום באתר) — כמה סבבים שוחקו בסך הכל.
// נחשפת רק עם מפתח סודי ב-ADMIN_STATS_KEY; בלי ההגדרה הזו הנתיב לא קיים בכלל.
// ההשוואה על תקצירי SHA-256 ב-timingSafeEqual כדי לא לדלוף מידע דרך זמן התגובה.
const digest = (s) => createHash('sha256').update(s).digest();
if (process.env.ADMIN_STATS_KEY) {
  const expected = digest(process.env.ADMIN_STATS_KEY);
  app.get('/api/stats', (req, res) => {
    const given = req.get('x-admin-key') || (typeof req.query.key === 'string' ? req.query.key : '');
    if (!timingSafeEqual(digest(given), expected)) return res.status(404).end();
    res.json(getStats());
  });
}

// יצירת QR — רק לקישור הצטרפות לחדר באתר הזה, כדי שהנתיב לא ישמש מחולל QR פתוח.
app.get('/api/qr', async (req, res) => {
  const raw = typeof req.query.url === 'string' ? req.query.url : '';
  let target;
  try { target = new URL(raw); } catch { return res.status(400).json({ error: 'bad url' }); }
  if (raw.length > 200 || target.host !== req.get('host') || !/^[A-Z2-9]{4,8}$/.test(target.searchParams.get('c') || '')) {
    return res.status(400).json({ error: 'bad url' });
  }
  try {
    const dataUrl = await QRCode.toDataURL(raw, {
      width: 320,
      margin: 1,
      color: { dark: '#1a1333', light: '#ffffff' },
    });
    res.set('Cache-Control', 'public, max-age=86400');
    res.json({ dataUrl });
  } catch (e) {
    res.status(500).json({ error: 'qr failed' });
  }
});

// --- הגבלת קצב ---
// חלון זמן קבוע לכל מפתח (סוקט או IP). מונע הצפת אירועים, יצירת אלפי חדרים,
// וסריקה של כל קודי החדרים (יש רק ~1M צירופים של 4 תווים).
function makeLimiter(limit, windowMs) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
  }, windowMs).unref();
  const entry = (key) => {
    const now = Date.now();
    let e = hits.get(key);
    if (!e || now - e.start > windowMs) { e = { start: now, n: 0 }; hits.set(key, e); }
    return e;
  };
  return {
    hit: (key) => ++entry(key).n <= limit,      // סופר ומחזיר האם עדיין במכסה
    over: (key) => entry(key).n >= limit,        // רק בודק, בלי לספור
  };
}
const eventLimit = makeLimiter(60, 10_000);     // לכל סוקט: 60 אירועים ב-10 שניות
const createLimit = makeLimiter(10, 60_000);    // לכל IP: 10 חדרים בדקה
const missLimit = makeLimiter(30, 60_000);      // לכל IP: 30 קודים/שחקנים שגויים בדקה (כיתה שלמה מאחורי אותו IP)

// מאחורי ה-proxy של Render ה-IP האמיתי הוא האחרון ב-X-Forwarded-For
// (הלקוח יכול לזייף ערכים בתחילת הרשימה, לא בסופה).
function clientIp(socket) {
  const xff = socket.handshake.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',').pop().trim();
  return socket.handshake.address;
}

// --- לוגיקת סוקטים ---

function roomChannel(code) {
  return `room:${code}`;
}

// משדר את המצב הציבורי לכל מי שבחדר, ואת התפקיד הפרטי לכל שחקן.
function broadcastRoom(room) {
  touchRoom(room);
  io.to(roomChannel(room.code)).emit('room:state', publicState(room));
  if (room.round && (room.phase === 'reveal' || room.phase === 'vote')) {
    for (const p of connectedPlayers(room)) {
      if (p.socketId) {
        const role = privateRole(room, p.id);
        if (role) io.to(p.socketId).emit('player:role', role);
      }
    }
  }
}

// מנתק סוקט מזהות שחקן: יוצא מערוץ החדר ולא יכול יותר לפעול בשמו.
function detachSocket(socketId, room, event) {
  const s = socketId && io.sockets.sockets.get(socketId);
  if (!s) return;
  s.leave(roomChannel(room.code));
  s.data.playerId = null;
  s.data.code = null;
  s.data.role = null;
  if (event) s.emit(event);
}

// כשאותו שחקן מתחבר מסוקט חדש (טאב שני / מכשיר אחר) — הסוקט הישן מאבד את הזהות.
function takeOver(room, playerId, newSocketId) {
  const prev = room.players.get(playerId)?.socketId;
  if (prev && prev !== newSocketId) detachSocket(prev, room, 'session:replaced');
}

// כשסוקט עובר לחדר חדש — עוזבים את ערוצי החדרים הקודמים ומנתקים
// את הזהות הישנה שלו שם, כדי שקבוצות שונות לא יתערבבו.
function leaveOtherRooms(socket, newCode) {
  for (const r of [...socket.rooms]) {
    if (r.startsWith('room:') && r !== roomChannel(newCode)) socket.leave(r);
  }
  if (socket.data.code && socket.data.code !== newCode) {
    const old = getRoom(socket.data.code);
    if (old) {
      const op = old.players.get(socket.data.playerId);
      if (op && op.socketId === socket.id) {
        op.connected = false;
        op.socketId = null;
      }
      if (old.hostSocketId === socket.id) old.hostSocketId = null;
      broadcastRoom(old);
    }
  }
  socket.data.playerId = null;
}

io.on('connection', (socket) => {
  const ip = clientIp(socket);

  // כל handler עטוף: הגבלת קצב + try/catch. חריגה שלא נתפסה בתוך handler של
  // Socket.IO מפילה את כל התהליך — וכל המשחקים (שנשמרים בזיכרון) נמחקים.
  const on = (event, handler) => socket.on(event, (...args) => {
    const cb = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
    if (!eventLimit.hit(socket.id)) return respond(cb, { ok: false, error: 'rate-limited' });
    try {
      handler(...args);
    } catch (err) {
      console.error(`[${event}]`, err);
      respond(cb, { ok: false, error: 'server-error' });
    }
  });

  // חיפוש חדר לפי קוד מהרשת, עם חסימה אחרי יותר מדי ניסיונות כושלים מאותו IP
  const lookup = (code, cb) => {
    if (missLimit.over(ip)) { respond(cb, { ok: false, exists: false, error: 'rate-limited' }); return null; }
    const room = getRoom(code);
    if (!room) { missLimit.hit(ip); respond(cb, { ok: false, exists: false, error: 'room-not-found' }); }
    return room;
  };

  // --- מנחה יוצר חדר ---
  on('host:create', (settings, cb) => {
    if (!createLimit.hit(ip)) return respond(cb, { ok: false, error: 'rate-limited' });
    const opts = settings && typeof settings === 'object' ? settings : {};
    const room = createRoom(opts);
    if (!room) return respond(cb, { ok: false, error: 'server-full' });
    leaveOtherRooms(socket, room.code);
    room.hostSocketId = socket.id;
    socket.join(roomChannel(room.code));
    socket.data.role = 'host';
    socket.data.code = room.code;

    // המנחה משתתף גם כשחקן (מהטלפון שלו)
    let hostPlayerId = null;
    if (opts.hostPlays) {
      const hostPlayer = addPlayer(room, opts.hostName || 'המנחה', socket.id);
      hostPlayer.isHost = true;
      room.hostPlays = true;
      room.hostPlayerId = hostPlayer.id;
      hostPlayerId = hostPlayer.id;
      socket.data.playerId = hostPlayer.id;
    }

    respond(cb, {
      ok: true,
      code: room.code,
      hostToken: room.hostToken,
      hostPlayerId,
      state: publicState(room),
    });
    broadcastRoom(room);
  });

  // --- מנחה מתחבר מחדש ---
  on('host:reconnect', (payload, cb) => {
    const room = lookup(payload?.code, cb);
    if (!room) return;
    if (typeof payload?.hostToken !== 'string' || room.hostToken !== payload.hostToken) {
      missLimit.hit(ip);
      return respond(cb, { ok: false, error: 'room-not-found' });
    }
    leaveOtherRooms(socket, room.code);
    if (room.hostSocketId && room.hostSocketId !== socket.id) {
      detachSocket(room.hostSocketId, room, 'session:replaced');
    }
    room.hostSocketId = socket.id;
    socket.join(roomChannel(room.code));
    socket.data.role = 'host';
    socket.data.code = room.code;

    // אם המנחה משתתף כשחקן — חבר מחדש גם את השחקן שלו
    if (room.hostPlays && room.hostPlayerId) {
      reconnectPlayer(room, room.hostPlayerId, socket.id, HOST_VERIFIED);
      socket.data.playerId = room.hostPlayerId;
    }

    respond(cb, {
      ok: true,
      code: room.code,
      hostPlayerId: room.hostPlays ? room.hostPlayerId : null,
      state: publicState(room),
    });
    if (room.round && (room.phase === 'reveal' || room.phase === 'vote') && room.hostPlayerId) {
      const role = privateRole(room, room.hostPlayerId);
      if (role) socket.emit('player:role', role);
    }
    broadcastRoom(room);
  });

  // --- מנחה מעדכן הגדרות (רק בלובי) ---
  on('host:updateSettings', (payload) => {
    const room = getRoom(socket.data.code);
    if (!room || room.hostSocketId !== socket.id || room.phase !== 'lobby') return;
    const s = payload && typeof payload === 'object' ? payload : {};
    if (s.imposterCount != null) {
      room.settings.imposterCount = clampInt(s.imposterCount, 1, 3, room.settings.imposterCount);
    }
    if (s.categoryId != null && validCategory(s.categoryId)) room.settings.categoryId = s.categoryId;
    if (s.imposterSeesCategory != null) room.settings.imposterSeesCategory = !!s.imposterSeesCategory;
    if (s.typedClues != null) room.settings.typedClues = !!s.typedClues;
    broadcastRoom(room);
  });

  // --- מנחה מתחיל סבב ---
  // canStart דורש שלב לובי — לחיצה כפולה לא מגרילה את הסבב מחדש ולא מנפחת את המונה.
  on('host:start', () => {
    const room = getRoom(socket.data.code);
    if (!room || room.hostSocketId !== socket.id) return;
    if (!canStart(room)) return;
    startRound(room);
    incrementGamesPlayed();
    broadcastRoom(room);
  });

  // --- מנחה עובר להצבעה ---
  on('host:beginVoting', () => {
    const room = getRoom(socket.data.code);
    if (!room || room.hostSocketId !== socket.id || room.phase !== 'reveal') return;
    beginVoting(room);
    broadcastRoom(room);
  });

  // --- מנחה מסיים הצבעה וחושף תוצאות ---
  on('host:reveal', () => {
    const room = getRoom(socket.data.code);
    if (!room || room.hostSocketId !== socket.id || room.phase !== 'vote') return;
    tallyResults(room);
    broadcastRoom(room);
  });

  // --- מנחה מתחיל סבב חדש (חזרה ללובי) ---
  on('host:nextRound', () => {
    const room = getRoom(socket.data.code);
    if (!room || room.hostSocketId !== socket.id) return;
    resetToLobby(room);
    broadcastRoom(room);
  });

  // --- מנחה מסלק שחקן (רק בלובי, ולא את עצמו) ---
  on('host:kick', (payload) => {
    const room = getRoom(socket.data.code);
    if (!room || room.hostSocketId !== socket.id || room.phase !== 'lobby') return;
    const player = room.players.get(payload?.playerId);
    if (!player || player.id === room.hostPlayerId) return;
    detachSocket(player.socketId, room, 'player:kicked');
    removePlayer(room, player.id);
    broadcastRoom(room);
  });

  // --- שחקן מצטרף ---
  on('player:join', (payload, cb) => {
    const room = lookup(payload?.code, cb);
    if (!room) return;
    // מותר להצטרף גם באמצע סבב — המצטרף ממתין לסבב הבא
    const player = addPlayer(room, payload?.name, socket.id);
    if (!player) return respond(cb, { ok: false, error: 'room-full' });
    leaveOtherRooms(socket, room.code);
    socket.join(roomChannel(room.code));
    socket.data.role = 'player';
    socket.data.code = room.code;
    socket.data.playerId = player.id;
    respond(cb, { ok: true, playerId: player.id, token: player.token, code: room.code, state: publicState(room) });
    broadcastRoom(room);
  });

  // --- שחקן מתחבר מחדש (דורש את ה-token הסודי, לא רק את המזהה הציבורי) ---
  on('player:reconnect', (payload, cb) => {
    const room = lookup(payload?.code, cb);
    if (!room) return;
    const pid = payload?.playerId;
    const prevSocket = room.players.get(pid)?.socketId;
    const player = reconnectPlayer(room, pid, socket.id, payload?.token);
    if (!player) {
      missLimit.hit(ip);
      return respond(cb, { ok: false, error: 'player-not-found' });
    }
    if (prevSocket && prevSocket !== socket.id) detachSocket(prevSocket, room, 'session:replaced');
    leaveOtherRooms(socket, room.code);
    socket.join(roomChannel(room.code));
    socket.data.role = 'player';
    socket.data.code = room.code;
    socket.data.playerId = player.id;
    respond(cb, { ok: true, playerId: player.id, code: room.code, state: publicState(room) });
    // שלח תפקיד פרטי אם באמצע סבב (ורק אם השחקן משתתף בסבב)
    if (room.round && (room.phase === 'reveal' || room.phase === 'vote')) {
      const role = privateRole(room, player.id);
      if (role) socket.emit('player:role', role);
    }
    broadcastRoom(room);
  });

  // --- בדיקת מצב חדר (לשחזור שקט בטעינת עמוד) ---
  on('room:probe', (payload, cb) => {
    const room = lookup(payload?.code, cb);
    if (!room) return;
    respond(cb, { exists: true, phase: room.phase });
  });

  // --- סיום תור רמז: השחקן שבתור, או המנחה ---
  // הלקוח שולח את מספר התור שהוא ראה; לחיצה כפולה (או שחקן+מנחה יחד) לא מדלגת על שחקן.
  on('turn:done', (payload) => {
    const room = getRoom(socket.data.code);
    if (!room || !room.round || room.phase !== 'reveal') return;
    if (typeof payload?.turn === 'number' && payload.turn !== room.round.turnsDone) return;
    const currentTurnId = room.round.order[room.round.turnIndex];
    const isHost = room.hostSocketId === socket.id;
    const isCurrent = !!socket.data.playerId && socket.data.playerId === currentTurnId;
    if (!isHost && !isCurrent) return;
    if (completeTurn(room)) broadcastRoom(room);
  });

  // --- רמז כתוב: השחקן שבתור שולח את המילה שאמר ---
  on('clue:submit', (payload) => {
    const room = getRoom(socket.data.code);
    if (!room || !socket.data.playerId) return;
    if (addClue(room, socket.data.playerId, payload?.text)) {
      broadcastRoom(room);
    }
  });

  // --- מתחזה מנחש את המילה (או מדלג עם text=null) ---
  on('player:guess', (payload) => {
    const room = getRoom(socket.data.code);
    if (!room || !socket.data.playerId) return;
    if (submitGuess(room, socket.data.playerId, payload?.text ?? null)) {
      broadcastRoom(room);
      if (roundComplete(room)) {
        tallyResults(room);
        broadcastRoom(room);
      }
    }
  });

  // --- שחקן מסמן חשודים / מתחזה מנחש שותפים ---
  on('player:vote', (payload) => {
    const room = getRoom(socket.data.code);
    if (!room) return;
    const voterId = socket.data.playerId;
    if (!voterId) return;
    const targets = Array.isArray(payload?.targets) ? payload.targets.slice(0, 3) : [];
    if (submitMarks(room, voterId, targets)) {
      broadcastRoom(room);
      // אם כולם סיימו (סימון + ניחוש) – חשיפה אוטומטית
      if (roundComplete(room)) {
        tallyResults(room);
        broadcastRoom(room);
      }
    }
  });

  socket.on('disconnect', () => {
    try {
      const result = markDisconnected(socket.id, socket.data.code);
      if (result) broadcastRoom(result.room);
    } catch (err) {
      console.error('[disconnect]', err);
    }
  });
});

function respond(cb, data) {
  if (typeof cb === 'function') cb(data);
}

setInterval(cleanupRooms, 10 * 60 * 1000);

httpServer.listen(PORT, () => {
  console.log(`🎭 מתחזה רץ על http://localhost:${PORT}`);
});
