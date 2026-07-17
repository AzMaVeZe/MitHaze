// ניהול חדרים ולוגיקת המשחק "מתחזה".
// כל חדר מזוהה בקוד קצר. לשחקנים יש מזהה קבוע (playerId) כדי לאפשר התחברות מחדש.

import { pickWord } from '../data/words.js';

const rooms = new Map();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ללא תווים מבלבלים (O/0, I/1)
const MIN_PLAYERS = 3;

const AVATARS = ['🦊', '🐼', '🦁', '🐸', '🦉', '🐙', '🦄', '🐝', '🐨', '🦖', '🐧', '🦋', '🐬', '🦔', '🐢', '🦩', '🐰', '🐷', '🐵', '🦇'];

// בוחר אווטאר שעוד לא בשימוש בחדר — כך לכל שחקן יש אייקון ייחודי משלו.
function pickAvatar(room) {
  const used = new Set([...room.players.values()].map((p) => p.avatar));
  const free = AVATARS.filter((a) => !used.has(a));
  const pool = free.length ? free : AVATARS; // מעל 20 שחקנים — חוזרים למאגר המלא
  return pool[Math.floor(Math.random() * pool.length)];
}

function genCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

function genId() {
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  );
}

export function createRoom(settings = {}) {
  const code = genCode();
  const room = {
    code,
    createdAt: Date.now(),
    hostToken: genId(),
    hostSocketId: null,
    hostPlays: false,     // האם המנחה משתתף גם כשחקן (מהטלפון שלו)
    hostPlayerId: null,   // מזהה השחקן של המנחה, אם הוא משתתף
    phase: 'lobby', // lobby | reveal | vote | results
    settings: {
      imposterCount: clampInt(settings.imposterCount, 1, 3, 1),
      categoryId: settings.categoryId || 'all',
      imposterSeesCategory: settings.imposterSeesCategory !== false,
      typedClues: settings.typedClues !== false, // רמזים כתובים שכולם רואים (אופציונלי)
    },
    players: new Map(), // playerId -> player
    round: null,
    roundNumber: 0, // מספר הסבב הנוכחי (עולה בכל התחלת סבב)
    history: [],    // תוצאות לפי סבב: {round, word, outcome, deltas}
  };
  rooms.set(code, room);
  return room;
}

export function getRoom(code) {
  if (!code) return null;
  return rooms.get(String(code).toUpperCase()) || null;
}

function clampInt(v, min, max, dflt) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

export function addPlayer(room, name, socketId) {
  const playerId = genId();
  const player = {
    id: playerId,
    name: String(name || '').trim().slice(0, 20) || 'שחקן',
    avatar: pickAvatar(room),
    socketId,
    connected: true,
    isHost: false,
    isImposter: false,
    hasVoted: false,
    votedFor: null,
    score: 0,
  };
  room.players.set(playerId, player);
  return player;
}

export function reconnectPlayer(room, playerId, socketId) {
  const player = room.players.get(playerId);
  if (!player) return null;
  player.socketId = socketId;
  player.connected = true;
  return player;
}

export function markDisconnected(socketId) {
  for (const room of rooms.values()) {
    if (room.hostSocketId === socketId) {
      room.hostSocketId = null;
    }
    for (const p of room.players.values()) {
      if (p.socketId === socketId) {
        p.connected = false;
        p.socketId = null;
        return { room, player: p };
      }
    }
  }
  return null;
}

export function connectedPlayers(room) {
  return [...room.players.values()].filter((p) => p.connected);
}

export function canStart(room) {
  const active = connectedPlayers(room);
  return active.length >= MIN_PLAYERS && active.length > room.settings.imposterCount;
}

// מתחיל סבב חדש: בוחר מילה, מגריל מתחזים ומאפס הצבעות.
export function startRound(room) {
  const active = connectedPlayers(room);
  const { word, categoryName, emoji } = pickWord(room.settings.categoryId);

  // הגרלת מתחזים
  const shuffled = [...active].sort(() => Math.random() - 0.5);
  const imposterCount = Math.min(room.settings.imposterCount, active.length - 1);
  const imposterIds = new Set(shuffled.slice(0, imposterCount).map((p) => p.id));

  for (const p of room.players.values()) {
    p.isImposter = imposterIds.has(p.id);
    p.hasVoted = false;
    p.votedFor = null;
  }

  // סדר תורים אקראי למתן רמזים
  const order = [...active].sort(() => Math.random() - 0.5).map((p) => p.id);

  room.roundNumber += 1;
  room.round = {
    word,
    categoryName,
    emoji,
    imposterIds: [...imposterIds],
    order,
    startingPlayerId: order[0],
    turnIndex: 0, // תור מתן הרמזים הנוכחי (אינדקס ב-order)
    turnsDone: 0, // כמה תורות הושלמו — אחרי 2 סבבים מלאים עוברים להצבעה
    clues: [],    // רמזים כתובים לפי סדר: {playerId, text}
    votes: {}, // voterId -> targetId
    results: null,
  };
  room.phase = 'reveal';
  return room.round;
}

export function beginVoting(room) {
  if (!room.round) return;
  room.phase = 'vote';
}

export const CLUE_CYCLES = 2; // מספר סבבי רמזים לפני מעבר אוטומטי להצבעה

// השחקן שבתור סיים (אמר/כתב) — מקדם את התור,
// ואחרי CLUE_CYCLES סבבים מלאים עובר אוטומטית להצבעה.
export function completeTurn(room) {
  if (!room.round || room.phase !== 'reveal') return false;
  room.round.turnsDone += 1;
  if (room.round.turnsDone >= room.round.order.length * CLUE_CYCLES) {
    beginVoting(room);
  } else {
    advanceTurn(room);
  }
  return true;
}

// רושם רמז כתוב של השחקן שבתור ומעביר את התור הלאה.
export function addClue(room, playerId, text) {
  if (!room.round || room.phase !== 'reveal') return false;
  if (!room.settings.typedClues) return false;
  const currentTurnId = room.round.order[room.round.turnIndex];
  if (playerId !== currentTurnId) return false;
  const clue = String(text || '').trim().slice(0, 24);
  if (!clue) return false;
  room.round.clues.push({ playerId, text: clue });
  completeTurn(room);
  return true;
}

// מעביר את תור הרמזים לשחקן הבא (מדלג על מנותקים).
export function advanceTurn(room) {
  if (!room.round || room.phase !== 'reveal') return false;
  const { order } = room.round;
  for (let step = 1; step <= order.length; step++) {
    const next = (room.round.turnIndex + step) % order.length;
    const p = room.players.get(order[next]);
    if (p && p.connected) {
      room.round.turnIndex = next;
      return true;
    }
  }
  return false;
}

export function castVote(room, voterId, targetId) {
  if (room.phase !== 'vote' || !room.round) return false;
  const voter = room.players.get(voterId);
  const target = room.players.get(targetId);
  if (!voter || !target || !voter.connected) return false;
  // רק משתתפי הסבב הנוכחי מצביעים, ורק על משתתפי הסבב
  if (!room.round.order.includes(voterId) || !room.round.order.includes(targetId)) return false;
  room.round.votes[voterId] = targetId;
  voter.hasVoted = true;
  voter.votedFor = targetId;
  return true;
}

export function allVoted(room) {
  // סופרים רק את משתתפי הסבב הנוכחי (מצטרפים מאוחרים ממתינים לסבב הבא)
  const active = connectedPlayers(room).filter((p) => room.round?.order.includes(p.id));
  return active.length > 0 && active.every((p) => p.hasVoted);
}

// מסכם את הסבב: סופר קולות, מכריע מי הודח, מעדכן ניקוד.
export function tallyResults(room) {
  const { votes, imposterIds } = room.round;
  const counts = {};
  for (const targetId of Object.values(votes)) {
    counts[targetId] = (counts[targetId] || 0) + 1;
  }

  // מציאת המקסימום
  let max = 0;
  for (const c of Object.values(counts)) max = Math.max(max, c);
  const topVoted = Object.keys(counts).filter((id) => counts[id] === max);
  const isTie = topVoted.length !== 1;
  const ejectedId = isTie ? null : topVoted[0];
  const imposterSet = new Set(imposterIds);
  const crewCaughtImposter = ejectedId && imposterSet.has(ejectedId);

  // ניקוד:
  // - צוות שמצביע נכון (למתחזה) מקבל +1
  // - כל מתחזה ששרד (לא הודח יחיד) מקבל +2
  // נאספים כ"דלתא לסבב" כדי לבנות לוח תוצאות מצטבר סבב-אחרי-סבב.
  const deltas = {};
  for (const [voterId, targetId] of Object.entries(votes)) {
    const voter = room.players.get(voterId);
    if (voter && !voter.isImposter && imposterSet.has(targetId)) {
      deltas[voterId] = (deltas[voterId] || 0) + 1;
    }
  }
  for (const impId of imposterIds) {
    const imp = room.players.get(impId);
    if (imp && impId !== ejectedId) deltas[impId] = (deltas[impId] || 0) + 2;
  }
  for (const [pid, d] of Object.entries(deltas)) {
    room.players.get(pid).score += d;
  }

  const results = {
    round: room.roundNumber,
    deltas,
    word: room.round.word,
    categoryName: room.round.categoryName,
    emoji: room.round.emoji,
    counts,
    ejectedId,
    isTie,
    imposterIds,
    crewCaughtImposter,
    outcome: crewCaughtImposter ? 'crew' : 'imposter',
  };
  room.round.results = results;
  room.history.push({
    round: room.roundNumber,
    word: room.round.word,
    outcome: results.outcome,
    imposterIds,
    deltas,
  });
  room.phase = 'results';
  return results;
}

export function resetToLobby(room) {
  room.phase = 'lobby';
  room.round = null;
  for (const p of room.players.values()) {
    p.isImposter = false;
    p.hasVoted = false;
    p.votedFor = null;
  }
}

export function removePlayer(room, playerId) {
  room.players.delete(playerId);
}

export function deleteRoom(code) {
  rooms.delete(code);
}

// ניקוי חדרים ישנים (מעל 6 שעות) כדי לא לצבור זיכרון.
export function cleanupRooms() {
  const now = Date.now();
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  for (const [code, room] of rooms.entries()) {
    if (now - room.createdAt > SIX_HOURS) rooms.delete(code);
  }
}

// ייצוג ציבורי של החדר (ללא מידע סודי כמו מילה/זהות מתחזה בזמן משחק).
export function publicState(room) {
  const players = [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    connected: p.connected,
    hasVoted: p.hasVoted,
    score: p.score,
    inRound: room.round ? room.round.order.includes(p.id) : true,
  }));
  const state = {
    code: room.code,
    phase: room.phase,
    settings: room.settings,
    players,
    minPlayers: MIN_PLAYERS,
    canStart: canStart(room),
    hostPlays: room.hostPlays,
    hostPlayerId: room.hostPlayerId,
    roundNumber: room.roundNumber,
    history: room.history,
  };
  if (room.round) {
    state.round = {
      categoryName: room.settings.imposterSeesCategory ? room.round.categoryName : null,
      emoji: room.round.emoji,
      order: room.round.order,
      startingPlayerId: room.round.startingPlayerId,
      turnIndex: room.round.turnIndex,
      currentTurnId: room.round.order[room.round.turnIndex] || null,
      clues: room.round.clues,
      clueCycle: Math.min(CLUE_CYCLES, Math.floor(room.round.turnsDone / room.round.order.length) + 1),
      clueCycles: CLUE_CYCLES,
    };
  }
  // בשלב התוצאות חושפים הכול
  if (room.phase === 'results' && room.round?.results) {
    state.results = room.round.results;
  }
  return state;
}

// מידע פרטי לשחקן ספציפי (התפקיד שלו).
export function privateRole(room, playerId) {
  const player = room.players.get(playerId);
  if (!player || !room.round) return null;
  // מצטרף מאוחר לא משתתף בסבב הנוכחי — אסור לחשוף לו את המילה
  if (!room.round.order.includes(playerId)) return null;
  if (player.isImposter) {
    return {
      isImposter: true,
      word: null,
      categoryName: room.settings.imposterSeesCategory ? room.round.categoryName : null,
      emoji: room.round.emoji,
    };
  }
  return {
    isImposter: false,
    word: room.round.word,
    categoryName: room.round.categoryName,
    emoji: room.round.emoji,
  };
}

export { MIN_PLAYERS };
