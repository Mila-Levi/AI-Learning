import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

test('多成员同步、权限隔离、位置关闭和重启恢复', {timeout:30000}, async t => {
  const dir = mkdtempSync(join(tmpdir(),'lake-test-'));
  let process, base;
  async function start() {
    process = spawn(globalThis.process.execPath,['server.js'],{cwd:new URL('../',import.meta.url),env:{...globalThis.process.env,PORT:'0',HOST:'127.0.0.1',DATA_DIR:dir,EPHEMERAL_STORAGE:'true'},stdio:['ignore','pipe','pipe']});
    base = await new Promise((resolve,reject)=>{
      let output = '';
      process.stdout.on('data',chunk=>{output += chunk; const match=output.match(/port (\d+)/); if(match) resolve(`http://127.0.0.1:${match[1]}`);});
      process.stderr.on('data',chunk=>{output += chunk;});
      process.on('exit',code=>reject(new Error(`Server exited ${code}: ${output}`)));
    });
  }
  async function stop() { if (!process || process.exitCode !== null) return; const ended = new Promise(resolve=>process.once('exit',resolve)); process.kill('SIGTERM'); await ended; }
  t.after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
  await start();
  async function request(path, token, input, key=randomUUID()) {
    const res = await fetch(base+path,{method:input === undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(input === undefined?{}:{'Content-Type':'application/json','Idempotency-Key':key})},...(input===undefined?{}:{body:JSON.stringify(input)})});
    return {status:res.status,body:await res.json()};
  }
  const create = await request('/api/rooms',null,{name:'主持人'});
  assert.equal(create.status,201);
  const host=create.body,room=host.state.room;
  const a=(await request('/api/join',null,{name:'小林',room})).body;
  const b=(await request('/api/join',null,{name:'小周',room})).body;
  const c=(await request('/api/join',null,{name:'旁观玩家',room})).body;
  const outsider=(await request('/api/rooms',null,{name:'另一局主持'})).body;
  const aid=a.state.me.id,bid=b.state.me.id;
  await t.test('静态页面可用且无需外部资源',async()=>{
    const res=await fetch(base); assert.equal(res.status,200); assert.match(await res.text(),/湖心追踪/);
    assert.match(res.headers.get('content-security-policy'),/frame-ancestors 'none'/);
    const health=(await request('/health')).body;
    assert.equal(health.ok,true);assert.equal(health.app,'lake-chase');assert.equal(health.storage,'temporary');
    assert.equal((await request('/api/state',host.token)).body.runtime.temporaryStorage,true);
  });
  await t.test('未登录和跨房间操作受限',async()=>{
    assert.equal((await request('/api/state')).status,401);
    assert.equal((await request('/api/messages',a.token,{body:'越界私信',recipient:outsider.state.me.id})).status,400);
    assert.equal((await request('/api/faction',outsider.token,{target:aid,faction:'ghost'})).status,400);
  });
  await t.test('私信只对双方与主持人可见',async()=>{
    await request('/api/messages',a.token,{body:'秘密暗号',recipient:bid});
    for (const user of [a,b,host]) assert.ok((await request('/api/state',user.token)).body.messages.some(m=>m.body==='秘密暗号'));
    for (const user of [c,outsider]) assert.ok(!(await request('/api/state',user.token)).body.messages.some(m=>m.body==='秘密暗号'));
  });
  await t.test('公开通知立即唤醒等待中的其他客户端',async()=>{
    const current=(await request('/api/state',b.token)).body;
    const pending=request(`/api/state?after=${current.version}`,b.token);
    await new Promise(resolve=>setTimeout(resolve,60));
    await request('/api/messages',a.token,{body:'集合通知'});
    const fresh=await pending;
    assert.ok(fresh.body.version>current.version);
    assert.ok(fresh.body.messages.some(m=>m.body==='集合通知'));
  });
  await t.test('同一请求重试不会重复发消息，编号冲突拒绝',async()=>{
    const key=randomUUID();
    assert.equal((await request('/api/messages',a.token,{body:'只发一次'},key)).status,200);
    assert.equal((await request('/api/messages',a.token,{body:'只发一次'},key)).status,200);
    assert.equal((await request('/api/messages',a.token,{body:'篡改重复请求'},key)).status,409);
    assert.equal((await request('/api/state',b.token)).body.messages.filter(m=>m.body==='只发一次').length,1);
  });
  await t.test('玩家无法感染，主持人可确认且不能重复变更',async()=>{
    assert.equal((await request('/api/faction',a.token,{target:bid,faction:'ghost'})).status,403);
    const payload={target:bid,faction:'ghost'},key=randomUUID();
    assert.equal((await request('/api/faction',host.token,payload,key)).status,200);
    assert.equal((await request('/api/faction',host.token,payload,key)).status,200);
    assert.equal((await request('/api/faction',host.token,payload)).status,409);
    const fresh=(await request('/api/state',b.token)).body;
    assert.equal(fresh.me.faction,'ghost');
    assert.equal(fresh.messages.filter(m=>m.kind==='event').length,1);
  });
  await t.test('隐藏自己仍可查看别人，坐标从接口消失',async()=>{
    for (const user of [a,b]) {
      await request('/api/sharing',user.token,{enabled:true});
      assert.equal((await request('/api/location',user.token,{lat:32.07,lng:118.8,accuracy:12})).status,200);
    }
    assert.ok((await request('/api/state',b.token)).body.members.find(m=>m.id===aid).location);
    await request('/api/sharing',a.token,{enabled:false});
    for(const user of [a,b,host]) assert.equal((await request('/api/state',user.token)).body.members.find(m=>m.id===aid).location,null);
    assert.ok((await request('/api/state',a.token)).body.members.find(m=>m.id===bid).location);
    assert.equal((await request('/api/location',a.token,{lat:32,lng:118,accuracy:10})).status,409);
    assert.equal((await request('/api/location',b.token,{lat:1000,lng:118,accuracy:10})).status,400);
  });
  await t.test('内容作为数据保留，跨站提交被拒绝',async()=>{
    await request('/api/messages',a.token,{body:'<img src=x onerror=alert(1)>'});
    assert.ok((await request('/api/state',b.token)).body.messages.some(m=>m.body==='<img src=x onerror=alert(1)>'));
    const res=await fetch(base+'/api/messages',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json',Authorization:`Bearer ${a.token}`},body:JSON.stringify({body:'跨站'})});
    assert.equal(res.status,403);
  });
  await t.test('重启保留身份和消息，并清除过往定位',async()=>{
    await stop(); await start();
    const restored=await request('/api/state',b.token);
    assert.equal(restored.status,200);assert.equal(restored.body.me.faction,'ghost');
    assert.ok(restored.body.messages.some(m=>m.body==='集合通知'));
    assert.ok(restored.body.members.every(m=>!m.sharing && m.location===null));
    await request('/api/faction',host.token,{target:bid,faction:'human'});
    assert.equal((await request('/api/state',b.token)).body.me.faction,'human');
  });
});
