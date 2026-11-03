// This adapter belongs ONLY to the exported, explicitly labelled local demo.
// The multi-user application continues to use the real authenticated server.
(() => {
  window.lakeLocalDemo = true;
  const key = 'lake-local-demo-v1';
  const uid = () => [...crypto.getRandomValues(new Uint8Array(12))].map(x=>x.toString(16).padStart(2,'0')).join('');
  let fallback = null;
  function load() {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
  }
  function save(value) {
    fallback = value;
    try { localStorage.setItem(key,JSON.stringify(value)); } catch { /* Some file viewers do not support storage. */ }
  }
  const newRoom = (id,name) => ({id,version:1,members:[{id:uid(),name,role:'host',faction:'observer',sharing:false,location:null}],messages:[],requests:{}});
  let initial=load();
  if (!initial) {
    const room=newRoom('628391','体验主持人');
    room.members.push({id:uid(),name:'小林',role:'player',faction:'human',sharing:false,location:null},{id:uid(),name:'小周',role:'player',faction:'human',sharing:false,location:null});
    room.messages.push({id:uid(),sender:room.members[0].id,recipient:null,kind:'system',body:'欢迎体验！你可以发送公开消息、选择成员私信，或由主持人确认感染。此页面只在本机演示，不连接其他手机。',created:Date.now()});
    initial={rooms:{[room.id]:room}}; save(initial);
  }
  function find(db,token) {
    for(const room of Object.values(db.rooms)) {
      const me=room.members.find(m=>m.id===token);
      if(me)return {room,me};
    }
    return {};
  }
  // First open goes straight into the sample room, without registration or setup.
  if (!sessionStorage.getItem('lake-demo-token') && !sessionStorage.getItem('lake-demo-show-entry')) {
    const sample = initial.rooms['628391'] || Object.values(initial.rooms)[0];
    sessionStorage.setItem('lake-demo-token', sample.members[0].id);
  }
  function snapshot(room,me) {
    return {room:room.id,version:room.version,me:{...me},serverTime:Date.now(),members:room.members.map(m=>({...m,location:m.sharing && m.location && Date.now()-m.location.updatedAt<45000 ? m.location:null})),messages:room.messages.filter(m=>!m.recipient || m.sender===me.id || m.recipient===me.id || me.role==='host').slice(-100)};
  }
  function event(room,me,recipient,kind,body) {room.messages.push({id:uid(),sender:me.id,recipient:recipient || null,kind,body,created:Date.now()});}
  function error(message,status=400) {throw Object.assign(new Error(message),{status});}
  window.fetch = async (url,options={}) => {
    const path=new URL(url,'https://local-demo.invalid');
    if(path.pathname==='/api/state')await new Promise(resolve=>setTimeout(resolve,path.searchParams.has('after')?600:0));
    try {
      const db=load(); let {room,me}=find(db,(options.headers?.Authorization || '').replace('Bearer ',''));
      const input=JSON.parse(options.body || '{}');
      let result;
      if(['/api/rooms','/api/join'].includes(path.pathname)) {
        const name=String(input.name || '').trim();
        if(!name || name.length>16)error('请输入 1–16 字昵称');
        if(path.pathname==='/api/rooms') {
          let id;do{id=String(crypto.getRandomValues(new Uint32Array(1))[0]%900000+100000);}while(db.rooms[id]);
          room=newRoom(id,name);db.rooms[id]=room;me=room.members[0];
        } else {
          room=db.rooms[input.room];if(!room)error('本机没有这个房间。可加入示例房间 628391，或创建新房间。',404);
          if(room.members.length>=10)error('房间已满');
          if(room.members.some(m=>m.name===name))error('昵称已被使用，请换一个');
          me={id:uid(),name,role:'player',faction:'human',sharing:false,location:null};room.members.push(me);
        }
        event(room,me,null,'system',`${name}加入了本机体验房间`);room.version++;save(db);
        result={token:me.id,state:snapshot(room,me)};
      } else {
        if(!room || !me)error('请先加入本机体验房间',401);
        if(path.pathname==='/api/state')result=snapshot(room,me);
        else {
          const requestId=options.headers?.['Idempotency-Key'];
          if(room.requests[requestId])return {ok:true,status:200,headers:new Headers({'Content-Type':'application/json'}),json:async()=>({ok:true})};
          if(path.pathname==='/api/messages') {
            if(!String(input.body || '').trim() || input.body.length>500)error('消息需要 1–500 个字符');
            if(input.recipient && !room.members.some(m=>m.id===input.recipient))error('收件人不存在');
            event(room,me,input.recipient,'chat',input.body.trim());
          } else if(path.pathname==='/api/faction') {
            if(me.role!=='host')error('只有主持人可以执行',403);
            const person=room.members.find(m=>m.id===input.target && m.role!=='host');
            if(!person || !['ghost','human'].includes(input.faction))error('目标或身份不正确');
            if(person.faction===input.faction)error('已经是该身份',409);
            person.faction=input.faction;event(room,me,null,'event',`${person.name}${input.faction==='ghost'?'已被感染，变为鬼':'已被治愈，恢复为人类'}（本机演示）`);
          } else if(path.pathname==='/api/pause')event(room,me,null,'safety',`${me.name}发起安全暂停（本机演示，不通知其他设备）。真实活动请先现场喊停。`);
          else if(path.pathname==='/api/sharing') {me.sharing=!!input.enabled;me.location=null;}
          else if(path.pathname==='/api/location') {
            if(!me.sharing)error('共享已关闭',409);
            me.location={lat:input.lat,lng:input.lng,accuracy:input.accuracy,updatedAt:Date.now()};
          } else error('体验版没有该接口',404);
          room.version++;room.requests[requestId]=true;save(db);result={ok:true};
        }
      }
      return {ok:true,status:200,headers:new Headers({'Content-Type':'application/json'}),json:async()=>JSON.parse(JSON.stringify(result))};
    }catch(e){return {ok:false,status:e.status || 400,headers:new Headers({'Content-Type':'application/json'}),json:async()=>({error:e.message})};}
  };
  const bar=document.createElement('aside');bar.className='demo-bar';
  const description=document.createElement('div');
  const title=document.createElement('strong');title.textContent='本机网页体验版';
  const note=document.createElement('span');note.textContent='无需安装 · 不联网 · 不跨设备同步 · 私信仅演示界面可见性，请勿填入敏感信息';description.append(title,note);
  const controls=document.createElement('div');controls.className='demo-controls';
  const label=document.createElement('label');label.textContent='体验身份';label.htmlFor='demo-person';
  const select=document.createElement('select');select.id='demo-person';select.setAttribute('aria-label','切换本机体验身份');
  const button=document.createElement('button');button.className='secondary';button.textContent='进入示例房间';
  const clear=document.createElement('button');clear.className='text-button';clear.textContent='清空本机数据';
  function refresh() {
    const db=load(),selected=sessionStorage.getItem('lake-demo-token'), context=find(db,selected);
    const room=context.room || db.rooms['628391'] || Object.values(db.rooms)[0];
    const signature=JSON.stringify(room.members.map(m=>[m.id,m.name]));
    if(select.dataset.signature!==signature) {
      select.replaceChildren();
      for(const member of room.members)select.add(new Option(`${member.name}${member.role==='host'?'（主持人）':''}`,member.id));
      select.dataset.signature=signature;
    }
    if(selected && room.members.some(m=>m.id===selected))select.value=selected;
    button.textContent=context.me?'切换到所选身份':'进入示例房间';
  }
  select.onchange=()=>{select.dataset.chosen=select.value;};
  button.onclick=()=>{
    sessionStorage.removeItem('lake-demo-show-entry');
    sessionStorage.setItem('lake-demo-token',select.dataset.chosen || select.value);
    location.reload();
  };
  clear.onclick=()=>{
    if(!confirm('仅清空此浏览器保存的体验数据并重新开始？'))return;
    try{localStorage.removeItem(key);}catch{}
    sessionStorage.removeItem('lake-demo-token');sessionStorage.removeItem('lake-demo-show-entry');location.reload();
  };
  controls.append(label,select,button,clear);bar.append(description,controls);document.body.prepend(bar);
  refresh();setInterval(()=>{if(document.activeElement!==select && !select.dataset.chosen)refresh();},1000);
})();
