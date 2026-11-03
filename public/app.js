const $ = id => document.getElementById(id);
let mode = 'join', state = null, token = sessionStorage.getItem('lake-token'), polling = false;
let geoWatch = null, lastGeoSent = 0, geoBusy = false, geoGeneration = 0, toastTimer;
const displayName = member => member.role === 'host' ? '主持人' : member.faction === 'ghost' ? '鬼' : '人类';
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true,4000); }
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return [...crypto.getRandomValues(new Uint8Array(16))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function api(path, input, requestKey) {
  const response = await fetch(path, { method: input === undefined ? 'GET' : 'POST', cache: 'no-store',
    headers: { ...(token ? {Authorization:`Bearer ${token}`} : {}), ...(input === undefined ? {} : {'Content-Type':'application/json','Idempotency-Key':requestKey || uuid()}) },
    ...(input === undefined ? {} : {body:JSON.stringify(input)}) });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('服务可能正在唤醒或暂时不可用，请稍后重试');
  }
  const payload = await response.json();
  if (!response.ok) { const error = new Error(payload.error || '请求失败'); error.status = response.status; throw error; }
  return payload;
}
function setMode(next) {
  mode = next;
  $('join-tab').classList.toggle('active',mode === 'join'); $('create-tab').classList.toggle('active',mode === 'create');
  $('join-tab').setAttribute('aria-selected',mode === 'join'); $('create-tab').setAttribute('aria-selected',mode === 'create');
  $('room-field').hidden = mode === 'create'; $('room-code').required = mode === 'join';
  $('enter-button').textContent = mode === 'join' ? '加入房间 ↗' : '创建游戏房间 ↗'; $('entry-error').textContent = '';
}
$('join-tab').onclick = () => setMode('join'); $('create-tab').onclick = () => setMode('create');
$('entry-form').onsubmit = async event => {
  event.preventDefault(); $('enter-button').disabled = true; $('entry-error').textContent = '';
  const previousLabel = $('enter-button').textContent;
  $('enter-button').textContent = '正在连接，首次打开可能稍慢…';
  try {
    const result = await api(mode === 'join' ? '/api/join' : '/api/rooms',{name:$('nickname').value,room:$('room-code').value});
    token = result.token; sessionStorage.setItem('lake-token',token); render(result.state); startPolling();
  } catch(e) { $('entry-error').textContent = e.message; }
  finally { $('enter-button').disabled = false; $('enter-button').textContent = previousLabel; }
};
function element(tag, className, value) {
  const node = document.createElement(tag); if (className) node.className = className; if (value !== undefined) node.textContent = value; return node;
}
function render(next) {
  const previous = state; state = next;
  $('storage-warning').hidden = !state.runtime?.temporaryStorage;
  connection(true);
  $('entry').hidden = true; $('game').hidden = false; $('room-id').textContent = `#${state.room}`;
  $('my-faction').textContent = displayName(state.me); $('my-name').textContent = state.me.name;
  $('member-count').replaceChildren(document.createTextNode(`${state.members.length} `), element('em','', '/ 10'));
  $('people-label').textContent = `${state.members.length} 名成员`;
  $('sharing-stat').textContent = state.me.sharing ? '已开启' : '已关闭';
  $('toggle-sharing').textContent = state.me.sharing ? '关闭我的位置共享' : '开启我的位置共享';
  $('host-tip').hidden = state.me.role !== 'host';
  if (!state.me.sharing && geoWatch !== null) stopGeo();
  // Do not overwrite selections or recreate buttons on an unchanged snapshot.
  const rosterChanged = !previous || JSON.stringify(previous.members.map(m=>[m.id,m.name,m.faction,m.sharing])) !== JSON.stringify(state.members.map(m=>[m.id,m.name,m.faction,m.sharing]));
  if (rosterChanged) {
    $('members').replaceChildren();
    for (const person of state.members) {
      const row = element('div','member');
      row.append(element('div',`avatar ${person.faction}`,person.name.slice(0,1)));
      const info = element('div','member-info'), name = element('div','member-name',person.name);
      if (person.id === state.me.id) name.append(element('small','', '你'));
      info.append(name,element('div','member-sub',person.sharing ? '位置共享开启' : '位置共享关闭'));
      row.append(info,element('span',`badge ${person.faction}`,displayName(person)));
      if (state.me.role === 'host' && person.role !== 'host') {
        const btn = element('button','member-action',person.faction === 'human' ? '确认感染' : '确认治愈');
        btn.onclick = () => changeFaction(person,btn); row.append(btn);
      }
      $('members').append(row);
    }
    const selected = $('recipient').value;
    $('recipient').replaceChildren(new Option('全体成员 · 公开',''));
    state.members.filter(m=>m.id !== state.me.id).forEach(m=>$('recipient').add(new Option(`${m.name} · 私信`,m.id)));
    if ([...$('recipient').options].some(o=>o.value === selected)) $('recipient').value = selected;
    updateSendHint();
  }
  renderLocations();
  if (!previous || JSON.stringify(previous.messages) !== JSON.stringify(state.messages)) {
    const list = $('messages'), nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 70;
    list.replaceChildren();
    if (!state.messages.length) list.append(element('div','empty','还没有消息，和同伴打个招呼吧。'));
    for (const message of state.messages) {
      const sender = state.members.find(m=>m.id === message.sender), recipient = state.members.find(m=>m.id === message.recipient);
      const item = element('article',`message ${message.kind}`), meta = element('div','message-meta');
      meta.append(element('strong','',sender?.name || '系统'));
      const visibility = message.recipient ? `私信 → ${recipient?.name || '成员'}` : message.kind === 'safety' ? '安全暂停' : message.kind === 'event' ? '状态变更' : '公开';
      meta.append(element('span',`visibility ${message.recipient ? 'private' : ''}`,visibility));
      const time = element('time','',new Date(message.created).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}));
      time.dateTime = new Date(message.created).toISOString(); meta.append(time);
      item.append(meta,element('p','',message.body)); list.append(item);
    }
    if (!previous || nearBottom || state.messages.at(-1)?.sender === state.me.id) list.scrollTop = list.scrollHeight;
  }
}
function renderLocations() {
  if (!state) return;
  $('locations').replaceChildren();
  for (const person of state.members.filter(m=>m.sharing)) {
    const row = element('div','location-row'), loc = person.location;
    const fresh = loc && Date.now() - loc.updatedAt < 45000;
    row.append(element('strong','',person.name),element('span','',fresh ? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)} · 精度约 ${Math.round(loc.accuracy)}m` : '等待定位 / 位置已过期'));
    $('locations').append(row);
  }
  if (!state.members.some(m=>m.sharing)) $('locations').append(element('p','section-note','暂无成员共享位置。'));
}
async function changeFaction(person,button) {
  const action = person.faction === 'human' ? '感染' : '治愈';
  if (!confirm(`确认${action}「${person.name}」？\n此版本不会自动结算技能、守卫或免疫，请先线下确认。结果将公开通知全员。`)) return;
  button.disabled = true;
  try { await api('/api/faction',{target:person.id,faction:person.faction === 'human' ? 'ghost' : 'human'}); toast(`已确认${action}`); }
  catch(e) { toast(e.message); }
  finally { button.disabled = false; }
}
function updateSendHint() { $('send-hint').textContent = $('recipient').value ? '私信仅双方和主持人可见' : '公开消息对房间内所有成员可见'; }
$('recipient').onchange = updateSendHint;
let draftRequest = null;
$('message-form').onsubmit = async event => {
  event.preventDefault(); $('send-button').disabled = true; $('message-error').textContent = '';
  const input = {body:$('message-body').value,recipient:$('recipient').value || null};
  const signature = JSON.stringify(input);
  if (!draftRequest || draftRequest.signature !== signature) draftRequest = {signature,key:uuid()};
  try { await api('/api/messages',input,draftRequest.key); $('message-body').value = ''; draftRequest = null; }
  catch(e) { $('message-error').textContent = `${e.message}。未确认发送时，请直接重试，系统会避免重复发送。`; }
  finally { $('send-button').disabled = false; }
};
$('pause').onclick = async () => {
  if (!confirm('请先现场喊“暂停”并举手！\n是否同时向房间内所有成员发送安全暂停通知？')) return;
  $('pause').disabled = true;
  try { await api('/api/pause',{}); toast('安全暂停通知已发送，请联系主持人'); } catch(e) { toast(`${e.message}，请直接现场喊停！`); }
  finally { $('pause').disabled = false; }
};
$('copy-room').onclick = async () => {
  const invitation = window.lakeLocalDemo ? state.room : `${location.origin}/?room=${encodeURIComponent(state.room)}`;
  try { await navigator.clipboard.writeText(invitation); toast(window.lakeLocalDemo ? '房间码已复制' : '邀请链接已复制，请发给其他玩家'); }
  catch { prompt(window.lakeLocalDemo ? '请复制房间码' : '请复制邀请链接并发给手机',invitation); }
};
function stopGeo() {
  geoGeneration++;
  if (geoWatch !== null) navigator.geolocation.clearWatch(geoWatch);
  geoWatch = null; geoBusy = false;
}
$('toggle-sharing').onclick = async () => {
  const button = $('toggle-sharing'); button.disabled = true;
  try {
    if (state.me.sharing) {
      stopGeo();
      await api('/api/sharing',{enabled:false});
      $('geo-status').textContent = '位置共享已关闭，你仍可查看其他成员的位置。';
    } else {
      if (!window.isSecureContext || !navigator.geolocation) throw new Error('位置共享需要 HTTPS 和浏览器定位权限');
      if (!confirm('开启后，房间内所有成员都可以看到你的设备坐标。\n位置不保存历史轨迹。你可以随时关闭；切后台后定位可能中断。')) return;
      await api('/api/sharing',{enabled:true});
      const generation = ++geoGeneration; lastGeoSent = 0;
      $('geo-status').textContent = '正在请求定位授权…';
      geoWatch = navigator.geolocation.watchPosition(async position => {
        if (generation !== geoGeneration || geoBusy || Date.now()-lastGeoSent<5000) return;
        geoBusy = true;
        try {
          await api('/api/location',{lat:position.coords.latitude,lng:position.coords.longitude,accuracy:position.coords.accuracy});
          if (generation === geoGeneration) {lastGeoSent = Date.now(); $('geo-status').textContent = '位置共享中 · 每次更新至少间隔 5 秒';}
        } catch(e) { if (generation === geoGeneration) $('geo-status').textContent = `位置未确认更新：${e.message}`; }
        finally { if (generation === geoGeneration) geoBusy = false; }
      },async error => {
        if (generation !== geoGeneration) return;
        stopGeo();
        $('geo-status').textContent = error.code === 1 ? '定位授权被拒绝，未共享位置。' : '暂时无法获取位置，请移到开阔处后重新开启。';
        try { await api('/api/sharing',{enabled:false}); } catch { toast('共享状态尚未确认关闭，请重试关闭'); }
      },{enableHighAccuracy:true,maximumAge:0,timeout:15000});
    }
  } catch(e) { $('geo-status').textContent = e.message; toast(e.message); }
  finally { button.disabled = false; }
};
$('leave').onclick = async () => {
  if (!confirm('退出后本设备不再保留身份，原昵称仍留在房间。\n主持人退出前请注意：基础版暂不支持身份转交。确认退出？')) return;
  if (state.me.sharing) {
    try { await api('/api/sharing',{enabled:false}); }
    catch { toast('位置共享未确认关闭，请先关闭共享再退出'); return; }
  }
  stopGeo(); sessionStorage.removeItem('lake-token'); location.reload();
};
function connection(online) {
  $('connection').textContent = online ? '● 已同步' : '● 连接中断，正在重连';
  $('connection').classList.toggle('offline',!online);
}
async function startPolling() {
  if (polling) return; polling = true;
  while (token) {
    try {
      const result = await api(`/api/state${state ? `?after=${state.version}` : ''}`);
      connection(true); render(result);
    } catch(e) {
      connection(false);
      if (e.status === 401) { sessionStorage.removeItem('lake-token'); token = null; $('game').hidden = true; $('entry').hidden = false; $('entry-error').textContent = e.message; break; }
      await new Promise(resolve=>setTimeout(resolve,2000));
    }
  }
  polling = false;
}
setInterval(renderLocations,5000);
// Restoring a page does not silently resume collection of location data.
async function restore() {
  if (!token) return;
  try {
    const initial = await api('/api/state');
    if (initial.me.sharing) { await api('/api/sharing',{enabled:false}); render(await api('/api/state')); }
    else render(initial);
    startPolling();
  } catch(e) {
    if (e.status === 401) {sessionStorage.removeItem('lake-token');token = null;}
    $('entry-error').textContent = e.message;
    if (token) { $('entry-error').textContent += '，正在尝试恢复原身份…'; startPolling(); }
  }
}
const invitedRoom = new URLSearchParams(location.search).get('room');
if (/^\d{6}$/.test(invitedRoom || '')) $('room-code').value = invitedRoom;
restore();
