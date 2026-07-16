import { io } from 'socket.io-client';
const URL = 'http://localhost:3112';
const conn = () => io(URL, { transports: ['websocket'] });
const once = (s, ev) => new Promise((r) => s.once(ev, r));
const emitCb = (s, ev, data) => new Promise((r) => s.emit(ev, data, r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

(async () => {
  // Host that ALSO plays
  const host = conn();
  await once(host, 'connect');
  let hostState = null, hostRole = null;
  host.on('room:state', (st) => (hostState = st));
  host.on('player:role', (r) => (hostRole = r));
  const created = await emitCb(host, 'host:create', {
    imposterCount: 1, categoryId: 'all', imposterSeesCategory: true,
    hostPlays: true, hostName: 'המנחה-דן',
  });
  log('CREATE hostPlays: ok=', created.ok, 'hostPlayerId=', !!created.hostPlayerId, 'code=', created.code);
  const code = created.code;
  const hostId = created.hostPlayerId;

  // 2 more players (total 3 incl host)
  const players = [];
  for (const name of ['רותם', 'נועה']) {
    const s = conn(); await once(s, 'connect');
    const res = await emitCb(s, 'player:join', { code, name });
    const p = { s, id: res.playerId, name, role: null, state: null };
    s.on('player:role', (r) => (p.role = r));
    s.on('room:state', (st) => (p.state = st));
    players.push(p);
  }
  await sleep(200);
  log('LOBBY players (incl host):', hostState.players.map(p => p.name).join(', '));
  log('canStart with 3 (host+2)?', hostState.canStart);

  // start
  host.emit('host:start');
  await sleep(300);
  const all = [{ id: hostId, name: 'המנחה-דן', role: hostRole }, ...players];
  const imp = all.find(p => p.role?.isImposter);
  log('Host got a role?', !!hostRole, '| host isImposter=', hostRole.isImposter, '| word=', hostRole.word);
  log('Imposter is:', imp.name);

  // voting
  host.emit('host:beginVoting');
  await sleep(200);
  // everyone (incl host) votes for imposter
  const target = imp.id;
  host.emit('player:vote', { targetId: hostId === target ? players[0].id : target });
  for (const p of players) p.s.emit('player:vote', { targetId: p.id === target ? hostId : target });
  await sleep(400);
  log('Results after all voted (incl host)?', !!hostState.results, '| outcome=', hostState.results?.outcome);
  log('Scores:', hostState.players.map(p => `${p.name}:${p.score}`).join(' '));

  // host reconnect keeps host-as-player identity
  host.disconnect();
  await sleep(200);
  const h2 = conn(); await once(h2, 'connect');
  const rc = await emitCb(h2, 'host:reconnect', { code, hostToken: created.hostToken });
  log('HOST reconnect: ok=', rc.ok, '| hostPlayerId back=', rc.hostPlayerId === hostId);

  log('\n✅ host-plays E2E complete');
  process.exit(0);
})().catch(e => { console.error('❌', e); process.exit(1); });
