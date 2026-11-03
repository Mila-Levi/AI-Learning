import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const data = process.env.DATA_DIR || join(root, 'data');
mkdirSync(data, { recursive: true });
const db = new DatabaseSync(join(data, 'game.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, room TEXT NOT NULL REFERENCES rooms(id), name TEXT NOT NULL, role TEXT NOT NULL, faction TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, sharing INTEGER NOT NULL DEFAULT 0, lat REAL, lng REAL, accuracy REAL, located INTEGER);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, room TEXT NOT NULL REFERENCES rooms(id), sender TEXT NOT NULL, recipient TEXT, kind TEXT NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS requests (member TEXT NOT NULL, key TEXT NOT NULL, signature TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(member,key));
CREATE INDEX IF NOT EXISTS messages_room ON messages(room,created);
CREATE INDEX IF NOT EXISTS members_room ON members(room);`);
// Startup never republishes positions collected before this process started.
db.exec('UPDATE members SET sharing=0, lat=NULL, lng=NULL, accuracy=NULL, located=NULL; UPDATE rooms SET version=version+1;');
const pending = new Map();
const rates = new Map();
const query = (sql, ...args) => db.prepare(sql).get(...args);
const all = (sql, ...args) => db.prepare(sql).all(...args);
const run = (sql, ...args) => db.prepare(sql).run(...args);
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const text = (value, max, label) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, `${label}需要 1–${max} 个字符`);
  return value.trim();
};
function transact(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
function addMessage(room, sender, recipient, kind, body) {
  run('INSERT INTO messages VALUES (?,?,?,?,?,?,?)', randomUUID(), room, sender, recipient, kind, body, Date.now());
}
function bump(room) { run('UPDATE rooms SET version=version+1 WHERE id=?', room); }
function notify(room) {
  for (const finish of [...(pending.get(room) || [])]) finish();
}
function snapshot(member) {
  const current = query('SELECT * FROM members WHERE id=?', member.id);
  const members = all('SELECT id,name,role,faction,sharing,lat,lng,accuracy,located FROM members WHERE room=? ORDER BY rowid', member.room).map(m => {
    const fresh = m.sharing === 1 && m.located && Date.now() - m.located < 45000;
    return { id: m.id, name: m.name, role: m.role, faction: m.faction, sharing: !!m.sharing,
      location: fresh ? { lat: m.lat, lng: m.lng, accuracy: m.accuracy, updatedAt: m.located } : null };
  });
  const messages = all(`SELECT id,sender,recipient,kind,body,created FROM messages WHERE room=? AND
    (recipient IS NULL OR recipient=? OR sender=? OR ?='host') ORDER BY created DESC,rowid DESC LIMIT 100`, member.room, member.id, member.id, member.role).reverse();
  return { room: member.room, runtime: { temporaryStorage: process.env.EPHEMERAL_STORAGE === 'true' }, version: query('SELECT version FROM rooms WHERE id=?', member.room).version,
    me: { id: current.id, name: current.name, role: current.role, faction: current.faction, sharing: !!current.sharing }, members, messages, serverTime: Date.now() };
}
async function body(req) {
  let chunks = [], size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) fail(413, '提交内容过大');
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { fail(400, '请求格式错误'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400,'请求必须为 JSON 对象');
  return value;
}
function json(res, status, payload) {
  if (!res.destroyed && !res.writableEnded) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(payload)); }
}
function auth(req) {
  const value = req.headers.authorization;
  if (!value?.startsWith('Bearer ')) fail(401, '请先加入房间');
  const member = query('SELECT * FROM members WHERE token_hash=?', hash(value.slice(7)));
  if (!member) fail(401, '身份已失效，请重新加入');
  return member;
}
function host(member) { if (member.role !== 'host') fail(403, '只有主持人可以执行此操作'); }
function target(member, id) {
  const person = query('SELECT * FROM members WHERE room=? AND id=?', member.room, id || '');
  if (!person) fail(400, '成员不存在');
  return person;
}
function newMember(room, name, role) {
  const token = randomBytes(32).toString('hex'), id = randomUUID();
  run('INSERT INTO members (id,room,name,role,faction,token_hash) VALUES (?,?,?,?,?,?)', id, room, name, role, role === 'host' ? 'observer' : 'human', hash(token));
  return { token, member: query('SELECT * FROM members WHERE id=?', id) };
}
function throttle(req) {
  const key = req.socket.remoteAddress;
  const now = Date.now();
  if (rates.size > 1000) for (const [k,v] of rates) if (now - v.time > 60000) rates.delete(k);
  const entry = rates.get(key);
  if (!entry || now - entry.time > 60000) rates.set(key, { time: now, count: 1 });
  else if (++entry.count > 40) fail(429, '操作过于频繁，请稍后重试');
}
const files = { '/': ['index.html','text/html'], '/app.js': ['app.js','text/javascript'], '/style.css': ['style.css','text/css'] };
const server = http.createServer(async (req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Permissions-Policy','geolocation=(self)');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const path = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && files[path.pathname]) {
      const [name,mime] = files[path.pathname];
      res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8`, 'Cache-Control':'no-cache' });
      res.end(readFileSync(join(root,'public',name))); return;
    }
    if (req.method === 'GET' && path.pathname === '/health') { json(res,200,{ok:query('SELECT 1 AS ok').ok === 1,app:'lake-chase',storage:process.env.EPHEMERAL_STORAGE === 'true' ? 'temporary' : 'local'}); return; }
    if (req.method === 'POST') {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) fail(403, '不允许跨站提交');
      if (!req.headers['content-type']?.startsWith('application/json')) fail(415,'请使用 JSON 提交');
    }
    if (req.method === 'POST' && ['/api/rooms','/api/join'].includes(path.pathname)) {
      throttle(req);
      const input = await body(req);
      const name = text(input.name,16,'昵称');
      const created = transact(() => {
        let room;
        if (path.pathname === '/api/rooms') {
          do { room = String(randomBytes(4).readUInt32BE() % 900000 + 100000); } while(query('SELECT id FROM rooms WHERE id=?',room));
          run('INSERT INTO rooms (id,created) VALUES (?,?)',room,Date.now());
        } else {
          room = text(input.room,6,'房间码');
          if (!/^\d{6}$/.test(room) || !query('SELECT id FROM rooms WHERE id=?',room)) fail(404,'房间不存在，请检查六位房间码');
          if (query('SELECT count(*) AS n FROM members WHERE room=?',room).n >= 10) fail(409,'房间已满（1 名主持人 + 9 名玩家）');
          if (query('SELECT id FROM members WHERE room=? AND name=?',room,name)) fail(409,'昵称已被使用，请换一个');
        }
        const result = newMember(room,name,path.pathname === '/api/rooms' ? 'host' : 'player');
        addMessage(room,result.member.id,null,'system',`${name}加入了房间`); bump(room);
        return { ...result, room };
      });
      notify(created.room); json(res,201,{token:created.token,state:snapshot(created.member)}); return;
    }
    if (!path.pathname.startsWith('/api/')) fail(404,'页面不存在');
    const member = auth(req);
    if (req.method === 'GET' && path.pathname === '/api/state') {
      const after = Number(path.searchParams.get('after'));
      const version = query('SELECT version FROM rooms WHERE id=?',member.room).version;
      if (after === version) {
        if ((pending.get(member.room)?.size || 0) >= 40) fail(429,'连接过多，请稍后再试');
        const set = pending.get(member.room) || new Set(); pending.set(member.room,set);
        let timer;
        const finish = () => { clearTimeout(timer); set.delete(finish); if (!set.size) pending.delete(member.room); json(res,200,snapshot(member)); };
        set.add(finish); timer = setTimeout(finish,20000);
        res.on('close',() => { clearTimeout(timer); set.delete(finish); if (!set.size) pending.delete(member.room); });
      } else json(res,200,snapshot(member));
      return;
    }
    if (req.method !== 'POST') fail(404,'接口不存在');
    const input = await body(req);
    const key = text(req.headers['idempotency-key'],100,'操作编号');
    const signature = hash(path.pathname + JSON.stringify(input));
    const response = transact(() => {
      const previous = query('SELECT * FROM requests WHERE member=? AND key=?',member.id,key);
      if (previous) {
        if (previous.signature !== signature) fail(409,'操作编号已使用');
        return JSON.parse(previous.result);
      }
      if (path.pathname === '/api/messages') {
        const message = text(input.body,500,'消息');
        const recipient = input.recipient ? target(member,input.recipient).id : null;
        addMessage(member.room,member.id,recipient,'chat',message);
      } else if (path.pathname === '/api/faction') {
        host(member);
        const person = target(member,input.target);
        if (person.role === 'host') fail(400,'主持人不参与感染');
        if (!['human','ghost'].includes(input.faction)) fail(400,'身份不正确');
        if (person.faction === input.faction) fail(409,'成员已是该身份，无需重复操作');
        run('UPDATE members SET faction=? WHERE id=?',input.faction,person.id);
        addMessage(member.room,member.id,null,'event',`${person.name}${input.faction === 'ghost' ? '已被感染，变为鬼' : '已被治愈，恢复为人类'}（主持人确认）`);
      } else if (path.pathname === '/api/pause') {
        addMessage(member.room,member.id,null,'safety',`${member.name}发起安全暂停：请立即停止移动与追逐，联系主持人。此版本仅发送通知，不自动冻结计时。`);
      } else if (path.pathname === '/api/sharing') {
        if (typeof input.enabled !== 'boolean') fail(400,'共享状态不正确');
        run('UPDATE members SET sharing=?,lat=NULL,lng=NULL,accuracy=NULL,located=NULL WHERE id=?',input.enabled ? 1 : 0,member.id);
      } else if (path.pathname === '/api/location') {
        const current = query('SELECT sharing FROM members WHERE id=?',member.id);
        if (!current.sharing) fail(409,'位置共享已关闭');
        if (![input.lat,input.lng,input.accuracy].every(Number.isFinite) || Math.abs(input.lat)>90 || Math.abs(input.lng)>180 || input.accuracy<0 || input.accuracy>100000) fail(400,'位置数据不正确');
        run('UPDATE members SET lat=?,lng=?,accuracy=?,located=? WHERE id=?',input.lat,input.lng,input.accuracy,Date.now(),member.id);
      } else fail(404,'接口不存在');
      bump(member.room);
      const result = {ok:true};
      run('INSERT INTO requests VALUES (?,?,?,?)',member.id,key,signature,JSON.stringify(result));
      return result;
    });
    notify(member.room); json(res,200,response);
  } catch (e) { if (!e.status) console.error('Request failed:',e.message); json(res,e.status || 500,{error:e.status ? e.message : '服务暂时不可用，请稍后重试'}); }
});
server.requestTimeout = 30000;
server.headersTimeout = 10000;
server.listen(Number(process.env.PORT || 3000),process.env.HOST || '0.0.0.0',()=>console.log(`Lake Chase listening on port ${server.address().port}`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{
  for (const room of [...pending.keys()]) notify(room);
  server.close(()=>{db.close();process.exit(0);});
});
