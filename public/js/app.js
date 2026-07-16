/* לקוח המשחק "מתחזה" — ניהול מסכים, סוקטים והתחברות מחדש. */
(() => {
  'use strict';

  const socket = io();
  const AVATARS = ['🦊', '🐼', '🦁', '🐸', '🦉', '🐙', '🦄', '🐝', '🐨', '🦖', '🐧', '🦋', '🐬', '🦔', '🐢', '🦩', '🐰', '🐷', '🐵', '🦇'];

  const S = {
    role: null,        // 'host' | 'player'
    code: null,
    token: null,       // hostToken (host) / playerId (player)
    myId: null,        // playerId (player)
    pub: null,         // publicState אחרון
    myRole: null,      // {isImposter, word, categoryName, emoji}
    selectedVote: null,
    settings: { imposterCount: 1, categoryId: 'all', imposterSeesCategory: true },
  };

  const SESSION_KEY = 'mithaze_session';
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const el = (id) => document.getElementById(id);

  function avatarFor(id) {
    let h = 0;
    for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return AVATARS[h % AVATARS.length];
  }

  function toast(msg) {
    const t = el('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function showScreen(id) {
    $$('.screen').forEach((s) => s.classList.remove('active'));
    el(id).classList.add('active');
    window.scrollTo(0, 0);
  }

  function saveSession() {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ role: S.role, code: S.code, token: S.token }));
    } catch (_) {}
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
  }

  // ---------- בית ----------
  el('btn-goto-create').addEventListener('click', () => {
    loadCategories();
    showScreen('screen-create');
  });
  el('btn-create-back').addEventListener('click', () => showScreen('screen-home'));

  el('form-join').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = el('join-code').value.trim().toUpperCase();
    const name = el('join-name').value.trim();
    if (!code) return toast('הכניסו קוד משחק');
    if (!name) return toast('הכניסו שם');
    socket.emit('player:join', { code, name }, (res) => {
      if (!res?.ok) return toast(joinError(res?.error));
      S.role = 'player'; S.code = res.code; S.token = res.playerId; S.myId = res.playerId;
      S.pub = res.state; saveSession();
      showScreen('screen-player');
      renderPlayer();
    });
  });

  function joinError(code) {
    return ({
      'room-not-found': 'קוד לא נמצא. בדקו שוב.',
      'game-in-progress': 'המשחק כבר התחיל. חכו לסבב הבא.',
      'player-not-found': 'החיבור פג. הצטרפו מחדש.',
    })[code] || 'שגיאה. נסו שוב.';
  }

  // ---------- הגדרות / יצירה ----------
  async function loadCategories() {
    try {
      const res = await fetch('/api/categories');
      const cats = await res.json();
      const sel = el('set-category');
      sel.innerHTML = '<option value="all">הכול מעורבב 🎲</option>';
      for (const c of cats) {
        const o = document.createElement('option');
        o.value = c.id; o.textContent = `${c.emoji} ${c.name}`;
        sel.appendChild(o);
      }
    } catch (_) {}
  }

  el('set-imposters').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#set-imposters button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    S.settings.imposterCount = parseInt(b.dataset.val, 10);
  });

  // הצגת שדה שם כשהמנחה מסמן שהוא משתתף
  el('set-hostplays').addEventListener('change', (e) => {
    el('set-hostname').classList.toggle('hidden', !e.target.checked);
    if (e.target.checked) el('set-hostname').focus();
  });

  el('btn-create').addEventListener('click', () => {
    S.settings.categoryId = el('set-category').value;
    S.settings.imposterSeesCategory = el('set-seescat').checked;
    const hostPlays = el('set-hostplays').checked;
    const hostName = el('set-hostname').value.trim();
    if (hostPlays && !hostName) return toast('הכניסו את השם שלכם');
    const payload = { ...S.settings, hostPlays, hostName };
    socket.emit('host:create', payload, (res) => {
      if (!res?.ok) return toast('שגיאה ביצירת חדר');
      S.role = 'host'; S.code = res.code; S.token = res.hostToken; S.pub = res.state;
      S.myId = res.hostPlayerId || null;
      saveSession();
      showScreen('screen-host');
      renderHost();
    });
  });

  // ---------- שיתוף (וואטסאפ / לינק) ----------
  function joinUrl() { return `${location.origin}/?c=${S.code}`; }
  function inviteText() {
    return `בואו נשחק מתחזה! 🎭\nהיכנסו למשחק: ${joinUrl()}\nאו הזינו את הקוד: ${S.code}`;
  }
  el('btn-share-wa').addEventListener('click', () => {
    const url = 'https://wa.me/?text=' + encodeURIComponent(inviteText());
    window.open(url, '_blank');
  });
  el('btn-share-link').addEventListener('click', async () => {
    const text = inviteText();
    try {
      if (navigator.share) { await navigator.share({ title: 'מתחזה', text, url: joinUrl() }); return; }
      await navigator.clipboard.writeText(joinUrl());
      toast('הלינק הועתק ✅');
    } catch (_) {
      try { await navigator.clipboard.writeText(joinUrl()); toast('הלינק הועתק ✅'); }
      catch (e) { toast(joinUrl()); }
    }
  });

  // ---------- פעולות מנחה ----------
  el('btn-host-start').addEventListener('click', () => socket.emit('host:start'));
  el('btn-host-vote').addEventListener('click', () => socket.emit('host:beginVoting'));
  el('btn-host-force-reveal').addEventListener('click', () => socket.emit('host:reveal'));
  el('btn-host-again').addEventListener('click', () => socket.emit('host:nextRound'));

  // ---------- רינדור מנחה ----------
  function renderHost() {
    const p = S.pub; if (!p) return;
    showSub('screen-host', {
      'host-lobby': p.phase === 'lobby',
      'host-reveal': p.phase === 'reveal',
      'host-vote': p.phase === 'vote',
      'host-results': p.phase === 'results',
    });
    if (p.phase === 'lobby') renderHostLobby();
    else if (p.phase === 'reveal') renderHostReveal();
    else if (p.phase === 'vote') renderHostVote();
    else if (p.phase === 'results') renderHostResults();
  }

  function renderHostLobby() {
    const p = S.pub;
    const url = `${location.origin}/?c=${p.code}`;
    el('host-url').textContent = location.host;
    el('host-code').textContent = p.code;
    loadQR(url);

    const players = p.players;
    el('host-player-count').textContent = players.length;
    const grid = el('host-players');
    grid.innerHTML = '';
    for (const pl of players) grid.appendChild(playerChip(pl, true));
    if (players.length === 0) {
      grid.innerHTML = '<li class="hint" style="grid-column:1/-1;text-align:center;padding:20px">מחכים לשחקנים… שתפו את הקוד או ה-QR</li>';
    }

    const btn = el('btn-host-start');
    btn.disabled = !p.canStart;
    const need = Math.max(p.minPlayers, p.settings.imposterCount + 1);
    el('host-start-hint').textContent = p.canStart ? 'מוכנים!' : `צריך לפחות ${need} שחקנים`;
  }

  let qrCache = null;
  async function loadQR(url) {
    if (qrCache === url) return;
    qrCache = url;
    try {
      const res = await fetch('/api/qr?url=' + encodeURIComponent(url));
      const { dataUrl } = await res.json();
      if (dataUrl) el('host-qr').src = dataUrl;
    } catch (_) {}
  }

  function renderHostReveal() {
    const p = S.pub;
    el('host-reveal-emoji').textContent = p.round?.emoji || '🎭';

    // כרטיס התפקיד של המנחה עצמו (אם משתתף)
    const card = el('host-role-card');
    if (p.hostPlays && S.myRole) {
      card.classList.remove('hidden');
      const r = S.myRole;
      if (r.isImposter) {
        card.className = 'role-card imposter';
        el('host-role-emoji').textContent = '🕵️';
        el('host-role-label').textContent = 'אתה…';
        el('host-role-word').textContent = 'המתחזה';
        el('host-role-sub').textContent = r.categoryName ? `רמז: "${r.categoryName}". בלף בחוכמה!` : 'אתה לא יודע את המילה. בלף בחוכמה!';
      } else {
        card.className = 'role-card crew';
        el('host-role-emoji').textContent = r.emoji || '🤫';
        el('host-role-label').textContent = 'המילה הסודית שלך';
        el('host-role-word').textContent = r.word;
        el('host-role-sub').textContent = r.categoryName ? `קטגוריה: ${r.categoryName}` : '';
      }
    } else {
      card.classList.add('hidden');
    }

    const order = el('host-turn-order');
    order.innerHTML = '';
    const byId = Object.fromEntries(p.players.map((x) => [x.id, x]));
    (p.round?.order || []).forEach((id, i) => {
      const d = document.createElement('div');
      d.className = 'to-item' + (i === 0 ? ' first' : '');
      const pl = byId[id];
      d.textContent = `${i + 1}. ${avatarFor(id)} ${pl ? pl.name : ''}`;
      order.appendChild(d);
    });
  }

  function renderHostVote() {
    const p = S.pub;
    const voted = p.players.filter((x) => x.hasVoted).length;
    const total = p.players.filter((x) => x.connected).length;
    el('host-vote-text').textContent = `${voted} / ${total} הצביעו`;
    el('host-vote-fill').style.width = total ? `${(voted / total) * 100}%` : '0%';
    const grid = el('host-vote-players');
    grid.innerHTML = '';
    for (const pl of p.players) grid.appendChild(playerChip(pl, false));

    // הצבעת המנחה עצמו (אם משתתף)
    const selfBox = el('host-vote-self');
    if (p.hostPlays && S.myId) {
      selfBox.classList.remove('hidden');
      const iVoted = !!p.players.find((x) => x.id === S.myId)?.hasVoted;
      const list = el('host-vote-list');
      list.innerHTML = '';
      for (const pl of p.players) {
        if (pl.id === S.myId) continue;
        const b = document.createElement('button');
        b.innerHTML = `<span>${avatarFor(pl.id)}</span><span>${escapeHtml(pl.name)}</span>`;
        if (S.selectedVote === pl.id) b.classList.add('selected');
        b.disabled = iVoted;
        b.addEventListener('click', () => {
          S.selectedVote = pl.id;
          socket.emit('player:vote', { targetId: pl.id });
        });
        list.appendChild(b);
      }
      el('host-voted-msg').classList.toggle('hidden', !iVoted);
    } else {
      selfBox.classList.add('hidden');
    }
  }

  function renderHostResults() {
    const p = S.pub, r = p.results; if (!r) return;
    const badge = el('host-outcome-badge');
    if (r.outcome === 'crew') { badge.textContent = '🎉 החבורה ניצחה!'; }
    else { badge.textContent = '🕵️ המתחזה ניצח!'; }
    el('host-outcome-title').textContent = r.crewCaughtImposter
      ? 'תפסתם את המתחזה!'
      : (r.isTie ? 'תיקו — אף אחד לא הודח' : 'הדחתם את האדם הלא נכון…');
    el('host-word').textContent = r.word;

    const byId = Object.fromEntries(p.players.map((x) => [x.id, x]));
    const impNames = r.imposterIds.map((id) => byId[id]?.name || '?').join(', ');
    el('host-imposter-reveal').innerHTML = `המתחזה${r.imposterIds.length > 1 ? 'ים' : ''}: <span class="imp">${impNames}</span>`;

    const tally = el('host-tally');
    tally.innerHTML = '';
    const impSet = new Set(r.imposterIds);
    const entries = Object.entries(r.counts).sort((a, b) => b[1] - a[1]);
    for (const [id, n] of entries) {
      const li = document.createElement('li');
      if (impSet.has(id)) li.classList.add('is-imposter');
      li.innerHTML = `<span>${avatarFor(id)} ${byId[id]?.name || '?'} ${impSet.has(id) ? '🕵️' : ''}</span><span class="count">${n} קולות</span>`;
      tally.appendChild(li);
    }
    if (entries.length === 0) tally.innerHTML = '<li>לא היו הצבעות</li>';

    const sb = el('host-scoreboard');
    sb.innerHTML = '';
    [...p.players].sort((a, b) => b.score - a.score).forEach((pl) => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${avatarFor(pl.id)} ${pl.name}</span><span>${pl.score}</span>`;
      sb.appendChild(li);
    });
  }

  function playerChip(pl, kickable) {
    const li = document.createElement('li');
    li.className = 'player-chip' + (pl.connected ? '' : ' disconnected') + (pl.hasVoted ? ' voted' : '');
    const isHost = pl.id === S.pub?.hostPlayerId;
    li.innerHTML = `
      <span class="avatar">${avatarFor(pl.id)}</span>
      <span class="pname">${isHost ? '👑 ' : ''}${escapeHtml(pl.name)}</span>
      ${pl.score ? `<span class="score">${pl.score} נק'</span>` : ''}
      ${pl.hasVoted ? '<span class="badge-voted">✓</span>' : ''}
    `;
    if (kickable) {
      const k = document.createElement('button');
      k.className = 'kick'; k.textContent = '✕'; k.title = 'הסר';
      k.addEventListener('click', () => socket.emit('host:kick', { playerId: pl.id }));
      li.appendChild(k);
    }
    return li;
  }

  // ---------- רינדור שחקן ----------
  function renderPlayer() {
    const p = S.pub; if (!p) return;
    const phase = p.phase;
    const iVoted = !!p.players.find((x) => x.id === S.myId)?.hasVoted;
    showSub('screen-player', {
      'player-wait': phase === 'lobby',
      'player-role': phase === 'reveal',
      'player-vote': phase === 'vote',
      'player-results': phase === 'results',
      'player-kicked': false,
    });
    if (phase === 'lobby') renderPlayerWait();
    else if (phase === 'reveal') renderPlayerRole();
    else if (phase === 'vote') renderPlayerVote(iVoted);
    else if (phase === 'results') renderPlayerResults();
  }

  function renderPlayerWait() {
    const me = S.pub.players.find((x) => x.id === S.myId);
    el('player-name-hi').textContent = me ? `${avatarFor(me.id)} שלום ${me.name}!` : 'מחכים למנחה…';
    const list = el('player-lobby-list');
    list.innerHTML = '';
    for (const pl of S.pub.players) {
      const s = document.createElement('span');
      s.textContent = `${avatarFor(pl.id)} ${pl.name}`;
      list.appendChild(s);
    }
  }

  function renderPlayerRole() {
    const r = S.myRole;
    const card = el('role-card');
    if (!r) { // עדיין לא הגיע התפקיד
      card.className = 'role-card';
      el('role-emoji').textContent = '⏳';
      el('role-word').textContent = '…';
      el('role-label').textContent = 'מקבל תפקיד';
      el('role-sub').textContent = '';
      return;
    }
    if (r.isImposter) {
      card.className = 'role-card imposter';
      el('role-emoji').textContent = '🕵️';
      el('role-label').textContent = 'אתה…';
      el('role-word').textContent = 'המתחזה';
      el('role-sub').textContent = r.categoryName
        ? `רמז: הקטגוריה היא "${r.categoryName}". בלף בחוכמה!`
        : 'אתה לא יודע את המילה. בלף בחוכמה!';
    } else {
      card.className = 'role-card crew';
      el('role-emoji').textContent = r.emoji || '🤫';
      el('role-label').textContent = 'המילה הסודית';
      el('role-word').textContent = r.word;
      el('role-sub').textContent = r.categoryName ? `קטגוריה: ${r.categoryName}` : '';
    }
  }

  function renderPlayerVote(iVoted) {
    const list = el('player-vote-list');
    list.innerHTML = '';
    for (const pl of S.pub.players) {
      if (pl.id === S.myId) continue; // אי אפשר להצביע לעצמך
      const b = document.createElement('button');
      b.innerHTML = `<span>${avatarFor(pl.id)}</span><span>${escapeHtml(pl.name)}</span>`;
      if (S.selectedVote === pl.id) b.classList.add('selected');
      b.disabled = iVoted;
      b.addEventListener('click', () => {
        S.selectedVote = pl.id;
        socket.emit('player:vote', { targetId: pl.id });
        renderPlayerVote(true);
      });
      list.appendChild(b);
    }
    el('player-voted-msg').classList.toggle('hidden', !iVoted);
  }

  function renderPlayerResults() {
    const r = S.pub.results; if (!r) return;
    const amImposter = r.imposterIds.includes(S.myId);
    const won = (r.outcome === 'crew') ? !amImposter : amImposter;
    el('player-result-emoji').textContent = won ? '🎉' : '😅';
    el('player-result-title').textContent = won ? 'ניצחת בסבב!' : 'הפסדת בסבב הזה';
    el('player-word').textContent = r.word;
    const byId = Object.fromEntries(S.pub.players.map((x) => [x.id, x]));
    const impNames = r.imposterIds.map((id) => byId[id]?.name || '?').join(', ');
    el('player-imposter-reveal').innerHTML = `המתחזה${r.imposterIds.length > 1 ? 'ים' : ''}: <span class="imp">${impNames}</span>` +
      (amImposter ? ' <b>(זה אתה!)</b>' : '');
    const me = S.pub.players.find((x) => x.id === S.myId);
    el('player-my-score').textContent = me ? `הניקוד שלך: ${me.score}` : '';
  }

  // ---------- עזרי תצוגה ----------
  function showSub(screenId, map) {
    for (const [id, on] of Object.entries(map)) {
      const node = el(id);
      if (node) node.classList.toggle('hidden', !on);
    }
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- אירועי סוקט ----------
  socket.on('room:state', (state) => {
    S.pub = state;
    if (S.role === 'host') renderHost();
    else if (S.role === 'player') renderPlayer();
  });

  socket.on('player:role', (role) => {
    S.myRole = role;
    S.selectedVote = null;
    if (S.role === 'player' && S.pub?.phase === 'reveal') renderPlayerRole();
    if (S.role === 'host' && S.pub?.phase === 'reveal') renderHostReveal();
  });

  socket.on('player:kicked', () => {
    clearSession();
    showSub('screen-player', { 'player-wait': false, 'player-role': false, 'player-vote': false, 'player-results': false, 'player-kicked': true });
    showScreen('screen-player');
  });

  socket.on('connect', () => tryReconnect());
  socket.on('disconnect', () => toast('החיבור נותק… מתחבר מחדש'));

  // ---------- התחברות מחדש ----------
  let reconnected = false;
  function tryReconnect() {
    if (reconnected) {
      // חיבור חוזר אחרי ניתוק — שחזר את החדר
      resendReconnect();
      return;
    }
    reconnected = true;
    let sess = null;
    try { sess = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (_) {}
    if (!sess?.code) return;
    doReconnect(sess);
  }

  function resendReconnect() {
    if (!S.code || !S.token) return;
    doReconnect({ role: S.role, code: S.code, token: S.token });
  }

  function doReconnect(sess) {
    if (sess.role === 'host') {
      socket.emit('host:reconnect', { code: sess.code, hostToken: sess.token }, (res) => {
        if (!res?.ok) { clearSession(); return; }
        S.role = 'host'; S.code = res.code; S.token = sess.token; S.pub = res.state;
        S.myId = res.hostPlayerId || null;
        showScreen('screen-host'); renderHost();
      });
    } else if (sess.role === 'player') {
      socket.emit('player:reconnect', { code: sess.code, playerId: sess.token }, (res) => {
        if (!res?.ok) { clearSession(); return; }
        S.role = 'player'; S.code = res.code; S.token = res.playerId; S.myId = res.playerId; S.pub = res.state;
        showScreen('screen-player'); renderPlayer();
      });
    }
  }

  // ---------- אתחול ----------
  function init() {
    const params = new URLSearchParams(location.search);
    const c = params.get('c') || params.get('code');
    if (c) {
      el('join-code').value = c.toUpperCase();
      setTimeout(() => el('join-name').focus(), 300);
    }
  }
  init();
})();
