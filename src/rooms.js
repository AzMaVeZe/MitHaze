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

// ערבוב הוגן (Fisher–Yates). לא להשתמש ב-sort(()=>Math.random()-0.5) — הוא מוטה
// ומשאיר את האיבר הראשון (המנחה, שנוסף ראשון) בראש לעתים קרובות מדי.
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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

  // הגרלת מתחזים (ערבוב הוגן)
  const shuffled = shuffle(active);
  const imposterCount = Math.min(room.settings.imposterCount, active.length - 1);
  const imposterIds = new Set(shuffled.slice(0, imposterCount).map((p) => p.id));

  for (const p of room.players.values()) {
    p.isImposter = imposterIds.has(p.id);
    p.hasVoted = false;
    p.marks = [];           // מי שסימן: צוות=חשודים, מתחזה=ניחוש שותפים
    p.guessed = false;      // האם המתחזה כבר שלח ניחוש/דילג
    p.guess = null;         // תוכן הניחוש (או null אם דילג)
    p.guessCorrect = false; // האם הניחוש היה נכון
  }

  // סדר תורים אקראי למתן רמזים (ערבוב הוגן)
  const order = shuffle(active).map((p) => p.id);

  room.roundNumber += 1;
  room.round = {
    word,
    categoryName,
    emoji,
    imposterIds: [...imposterIds],
    imposterCount: imposterIds.size, // מספר המתחזים בפועל בסבב
    order,
    startingPlayerId: order[0],
    turnIndex: 0, // תור מתן הרמזים הנוכחי (אינדקס ב-order)
    turnsDone: 0, // כמה תורות הושלמו — אחרי 2 סבבים מלאים עוברים להצבעה
    clues: [],    // רמזים כתובים לפי סדר: {playerId, text}
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

// כמה סימונים נדרשים מהשחקן בשלב ההצבעה:
// - צוות: מסמן את כל המתחזים (imposterCount).
// - מתחזה: מנחש את שאר המתחזים (imposterCount - 1). מתחזה יחיד → 0 (רק ניחוש מילה).
export function requiredMarks(room, p) {
  const k = room.round.imposterCount;
  return p.isImposter ? k - 1 : k;
}

// שחקן מסמן את החשודים שלו (צוות) או את השותפים המשוערים (מתחזה).
// targets — מערך מזהים; חייב להיות בדיוק בגודל הנדרש, ייחודי, בסבב, ולא עצמו.
export function submitMarks(room, voterId, targets) {
  if (room.phase !== 'vote' || !room.round) return false;
  const voter = room.players.get(voterId);
  if (!voter || !voter.connected || !room.round.order.includes(voterId)) return false;
  const need = requiredMarks(room, voter);
  if (need === 0) return false; // מתחזה יחיד — אין סימון, רק ניחוש מילה
  const list = Array.isArray(targets) ? [...new Set(targets)] : [];
  if (list.length !== need) return false;
  for (const t of list) {
    if (t === voterId || !room.round.order.includes(t)) return false;
  }
  voter.marks = list;
  voter.hasVoted = true;
  return true;
}

// נרמול מילה להשוואת ניחוש: מסיר רווחים מיותרים, גרשיים ופיסוק.
function normalizeWord(s) {
  return String(s || '')
    .trim()
    .replace(/[׳״'"`.,!?־–-]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

// המתחזה מנסה לנחש את המילה (או מדלג עם text=null). ניחוש נכון יזוכה בתוצאות.
export function submitGuess(room, playerId, text) {
  if (room.phase !== 'vote' || !room.round) return false;
  const player = room.players.get(playerId);
  if (!player || !player.connected) return false;
  if (!player.isImposter || !room.round.order.includes(playerId)) return false;
  const raw = text == null ? null : String(text).trim().slice(0, 30);
  player.guess = raw || null;
  player.guessed = true;
  player.guessCorrect = !!raw && normalizeWord(raw) === normalizeWord(room.round.word);
  return true;
}

// האם שחקן ספציפי סיים את פעולתו בשלב ההצבעה:
// - צוות: הצביע.
// - מתחזה יחיד: ניחש/דילג.
// - מתחזה מרובה: גם הצביע וגם ניחש/דילג.
export function playerDone(room, p) {
  if (!room.round || !room.round.order.includes(p.id)) return false;
  const soleImposter = room.round.imposterIds.length === 1;
  if (p.isImposter) return soleImposter ? p.guessed : (p.hasVoted && p.guessed);
  return p.hasVoted;
}

// השלב מסתיים כשכל שחקן בסבב סיים את פעולתו.
export function roundComplete(room) {
  if (!room.round) return false;
  const active = connectedPlayers(room).filter((p) => room.round.order.includes(p.id));
  if (active.length === 0) return false;
  return active.every((p) => playerDone(room, p));
}

// מסכם את הסבב: סופר את קולות הצוות, מכריע את קבוצת ה"נתפסים", ומעדכן ניקוד.
export function tallyResults(room) {
  const { imposterIds, imposterCount } = room.round;
  const imposterSet = new Set(imposterIds);
  const inRound = (id) => room.round.order.includes(id);

  // ספירת סימוני הצוות בלבד (סימוני המתחזים הם ניחוש שותף — לא נספרים כאן)
  const counts = {};
  for (const p of room.players.values()) {
    if (p.isImposter || !inRound(p.id)) continue;
    for (const t of p.marks || []) counts[t] = (counts[t] || 0) + 1;
  }

  // קבוצת ה"נתפסים" = k השחקנים עם הכי הרבה קולות; תיקו בגבול → פחות מ-k
  const sorted = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const k = imposterCount;
  let caughtIds = [];
  let isTie = false;
  if (sorted.length) {
    const boundary = counts[sorted[Math.min(k, sorted.length) - 1]];
    const above = sorted.filter((id) => counts[id] > boundary);
    const atBoundary = sorted.filter((id) => counts[id] === boundary);
    if (sorted.length >= k && above.length + atBoundary.length === k) {
      caughtIds = [...above, ...atBoundary];
    } else {
      isTie = true;
      caughtIds = above; // רק החד-משמעיים (פחות מ-k)
    }
  }
  const caughtSet = new Set(caughtIds);
  const crewCaughtImposter = caughtIds.length === k && caughtIds.every((id) => imposterSet.has(id));

  // ניקוד (נאסף כ"דלתא לסבב"):
  const deltas = {};
  // צוות: +1 לכל מתחזה אמיתי שסימן
  for (const p of room.players.values()) {
    if (p.isImposter || !inRound(p.id)) continue;
    for (const t of p.marks || []) if (imposterSet.has(t)) deltas[p.id] = (deltas[p.id] || 0) + 1;
  }
  for (const impId of imposterIds) {
    const imp = room.players.get(impId);
    if (!imp) continue;
    // מתחזה: +1 לכל שותף-מתחזה אמיתי שניחש (סעיף א)
    for (const t of imp.marks || []) if (imposterSet.has(t) && t !== impId) deltas[impId] = (deltas[impId] || 0) + 1;
    // מתחזה ששרד (לא נתפס): +2
    if (!caughtSet.has(impId)) deltas[impId] = (deltas[impId] || 0) + 2;
    // ניחוש מילה נכון: +1
    if (imp.guessCorrect) deltas[impId] = (deltas[impId] || 0) + 1;
  }
  for (const [pid, d] of Object.entries(deltas)) {
    room.players.get(pid).score += d;
  }

  // חשיפה: ניחוש מילה + ניחוש שותפים לכל מתחזה
  const guesses = imposterIds.map((id) => {
    const imp = room.players.get(id);
    const partnerMarks = (imp?.marks || []).filter((t) => imposterSet.has(t) && t !== id);
    return {
      id,
      guess: imp?.guess ?? null,
      correct: !!imp?.guessCorrect,
      partnerMarks: imp?.marks || [],
      partnerCorrect: partnerMarks.length,
    };
  });

  const results = {
    round: room.roundNumber,
    deltas,
    word: room.round.word,
    categoryName: room.round.categoryName,
    emoji: room.round.emoji,
    counts,
    caughtIds,
    ejectedId: k === 1 ? (caughtIds[0] || null) : null, // תאימות לאחור
    isTie,
    imposterIds,
    imposterCount: k,
    guesses,
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
    p.marks = [];
    p.guessed = false;
    p.guess = null;
    p.guessCorrect = false;
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
    guessed: p.guessed,
    // "סיים את התור בשלב ההצבעה" — לא חושף אם מתחזה, רק אם השלים פעולה
    done: room.phase === 'vote' ? playerDone(room, p) : p.hasVoted,
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
      imposterCount: room.round.imposterCount,
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
    // המתחזה לא רואה מי חבריו — הוא ינחש בשלב ההצבעה
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
