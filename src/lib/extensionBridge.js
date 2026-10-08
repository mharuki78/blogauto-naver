const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const PORT = 46321;
const STATES = new Set(['valid', 'expired', 'security_check', 'account_mismatch', 'unknown', 'checking']);
const failure = (message, code = 'EXTENSION_DISCONNECTED') => Object.assign(new Error(message), { code });
class ExtensionBridge extends EventEmitter {
  constructor(root, port = PORT) {
    super(); this.root = root; this.port = port; this.clients = new Map(); this.codes = new Map(); this.tasks = new Map(); this.waiters = new Map(); this.lastSeen = new Map(); this.attempts = new Map();
    fs.mkdirSync(root, { recursive: true });
    this.file = path.join(root, 'extension-connections.json');
    try { for (const c of JSON.parse(fs.readFileSync(this.file)).clients || []) this.clients.set(c.token, c); } catch {}
    this.journal = path.join(root, 'extension-tasks.json');
    try { for (const t of JSON.parse(fs.readFileSync(this.journal))) this.tasks.set(t.id, { ...t, state: ['queued','running'].includes(t.state) ? 'interrupted' : t.state }); } catch {}
    this.saveTasks();
    this.monitor = null;
  }
  save() { this.atomic(this.file, { clients: [...this.clients.values()] }); }
  saveTasks() { this.atomic(this.journal, [...this.tasks.values()]); }
  atomic(file, value) {
    const temp = file + '.' + crypto.randomUUID() + '.tmp';
    try {
      const fd = fs.openSync(temp, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temp, file);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  start() {
    if (this.server) return Promise.resolve();
    this.server = http.createServer((req, res) => this.handle(req,res).catch(error => { if (!res.headersSent) this.reply(res, 400, { error: error.message }); else res.end(); }));
    return new Promise((resolve,reject) => { this.server.once('error', reject); this.server.listen(this.port, '127.0.0.1', () => {
      this.port=this.server.address().port;
      this.monitor=setInterval(()=>this.checkDisconnectedTasks(),15000);this.monitor.unref();resolve();
    }); });
  }
  stop() {
    clearInterval(this.monitor);
    for (const task of this.tasks.values()) if (['queued','running'].includes(task.state)) task.state='interrupted';
    this.saveTasks();
    this.server?.close();this.server?.closeAllConnections();this.server=null;
    for (const [id,w] of this.waiters) {
      clearTimeout(w.timer);
      w.reject(failure('앱 연결이 종료되었습니다. Chrome의 작성·발행 상태를 확인하세요.', this.tasks.get(id)?.stage==='final_publish'?'PUBLISH_UNCERTAIN':'EXTENSION_DISCONNECTED'));
    }
    this.waiters.clear();this.lastSeen.clear();
  }
  pairCode(accountId, blogId, label, platform = 'naver') {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(blogId)) throw new Error('블로그 ID를 확인해 주세요.');
    for (const [key,value] of this.codes) if (value.accountId === accountId || value.expires < Date.now()) this.codes.delete(key);
    const code = crypto.randomBytes(5).toString('hex').toUpperCase();
    this.codes.set(code, { accountId, blogId, label, platform, expires: Date.now() + 600000 });
    return { code, expiresAt: new Date(Date.now()+600000).toISOString(), port: this.port };
  }
  clientFor(accountId) { return [...this.clients.values()].find(c => c.accountId === accountId); }
  snapshot(accountId) {
    const c = this.clientFor(accountId); const online = c && Date.now() - (this.lastSeen.get(c.token) || 0) < 75000;
    const fresh = c?.checkedAt && Date.now() - Date.parse(c.checkedAt) < 120000;
    const task=[...this.tasks.values()].find(t=>t.accountId===accountId && ['queued','running'].includes(t.state));
    return { connected: Boolean(online), loginStatus:online ? c.confirmedStatus || (c.status==='valid'?'valid':'unknown') : 'disconnected', rechecking:Boolean(online && (!fresh || ['unknown','checking'].includes(c.status))), status: !online ? 'disconnected' : task?.waiting ? 'waiting_login' : fresh ? c.status || 'unknown' : 'unknown', checkedAt: c?.checkedAt || '', label: c?.label || '', reason: c?.reason || '', busy:Boolean(task), stage:task?.stage || '' };
  }
  revoke(accountId) {
    this.cancelAccount(accountId);
    for (const [code,c] of this.codes) if(c.accountId===accountId) this.codes.delete(code);
    for (const [token,c] of this.clients) if (c.accountId === accountId) { this.clients.delete(token); this.lastSeen.delete(token); }
    this.save();
  }
  cancelAccount(accountId) {
    for(const task of this.tasks.values())if(task.accountId===accountId && ['queued','running'].includes(task.state)){
      task.state='cancelled'; const waiter=this.waiters.get(task.id);
      if(waiter){clearTimeout(waiter.timer);this.waiters.delete(task.id);waiter.reject(failure('계정 작업을 취소했습니다. 작성 중이던 내용은 Chrome에서 확인하세요.',task.stage==='final_publish'?'PUBLISH_UNCERTAIN':'JOB_CANCELLED'));}
    }
    this.saveTasks();this.emit('status',accountId,this.snapshot(accountId));
  }
  checkDisconnectedTasks() {
    for(const task of this.tasks.values()) {
      if(task.state!=='running' || task.waiting || Date.now()-(this.lastSeen.get(task.clientToken)||0)<120000)continue;
      task.state='interrupted';this.saveTasks();const waiter=this.waiters.get(task.id);
      if(waiter){clearTimeout(waiter.timer);this.waiters.delete(task.id);waiter.reject(failure('확장 연결이 끊겼습니다. 작성된 글과 발행 여부를 확인하세요.',task.stage==='final_publish'?'PUBLISH_UNCERTAIN':'EXTENSION_DISCONNECTED'));}
    }
  }
  async request(accountId, type, payload = {}, timeoutMs = 0) {
    const client = this.clientFor(accountId);
    if (!client || !this.snapshot(accountId).connected) throw failure('이 계정으로 연결한 Chrome에서 확장을 열어 주세요. 로그인 정보는 그대로 유지됩니다.');
    const existing = [...this.tasks.values()].find(t => t.accountId === accountId && ['queued','running'].includes(t.state));
    // Login checks may originate from the extension, account card, or job start.
    // Share their outcome instead of blocking a job with its own login check.
    if (existing?.type === 'session' && type === 'session') {
      const waiter = this.waiters.get(existing.id);
      if (waiter?.promise) {
        if(client.platform==='tistory' && ((payload.tistoryBlogId || client.blogId)!==existing.blogId || (payload.category || '')!==(existing.payload.category || ''))){
          await waiter.promise;
          return this.request(accountId,type,payload,timeoutMs);
        }
        return waiter.promise;
      }
    }
    if (existing) throw failure('이 계정에서 발행 또는 다른 작업이 진행 중입니다. 완료를 기다리거나 계정 카드의 대기 취소를 눌러 주세요.', 'ACCOUNT_BUSY');
    const blogId = client.platform === 'tistory' ? require('./tistoryTarget').normalizeTistoryBlogId(payload.tistoryBlogId || client.blogId) : client.blogId;
    if(type==='publish' && [...this.tasks.values()].some(t=>t.accountId===accountId && t.type==='publish' && t.blogId===blogId && t.payload.title===payload.title && t.payload.article===payload.article && ((t.state==='interrupted' && t.stage==='final_publish') || t.code==='PUBLISH_UNCERTAIN' || (t.state==='cancelled' && t.stage==='final_publish'))))throw failure('같은 원고의 이전 발행 결과가 불확실합니다. Chrome에서 게시 여부를 확인해 주세요. 이 원고를 자동 재발행하지 않습니다.','PUBLISH_UNCERTAIN');
    const id = crypto.randomUUID();
    const task = { id, accountId, clientToken: client.token, type, payload, blogId, platform: client.platform, state: 'queued', createdAt: new Date().toISOString() };
    this.tasks.set(id,task); this.saveTasks();
    const promise = new Promise((resolve,reject) => {
      const timer = timeoutMs > 0 ? setTimeout(() => {
        task.state = task.state === 'running' ? 'interrupted' : 'expired'; this.saveTasks(); this.waiters.delete(id);
        reject(failure(type === 'publish' ? '발행 결과를 확인하지 못했습니다. Chrome의 작성·발행 상태를 확인하세요. 중복 방지를 위해 자동 재발행하지 않습니다.' : '확장 응답 시간이 초과되었습니다.', type === 'publish' ? 'PUBLISH_UNCERTAIN' : 'EXTENSION_DISCONNECTED'));
      }, timeoutMs) : null;
      this.waiters.set(id,{ resolve,reject,timer });
    });
    this.waiters.get(id).promise = promise;
    return promise;
  }
  reply(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
  async handle(req,res) {
    // No permissive CORS. Only extension origins, exact loopback host, and bearer tokens.
    if (req.headers.host !== `127.0.0.1:${this.port}`) return this.reply(res,403,{error:'Invalid host'});
    const origin = req.headers.origin || '';
    if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return this.reply(res,403,{error:'Extension origin required'});
    if (origin) { res.setHeader('Access-Control-Allow-Origin',origin); res.setHeader('Vary','Origin'); }
    if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type'); res.setHeader('Access-Control-Allow-Methods','POST, GET'); res.writeHead(204); return res.end(); }
    const url = new URL(req.url, 'http://127.0.0.1');
    let body = {}; let raw = '';
    if (req.method === 'POST') { for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 1024*1024) throw new Error('Request too large'); } body = raw ? JSON.parse(raw) : {}; }
    if (url.pathname === '/pair' && req.method === 'POST') {
      const key = req.socket.remoteAddress; const attempts = this.attempts.get(key) || { count: 0, start: Date.now() };
      if (Date.now()-attempts.start > 60000) { attempts.count=0; attempts.start=Date.now(); }
      this.attempts.set(key,attempts); if (++attempts.count > 15) return this.reply(res,429,{error:'잠시 후 다시 연결하세요.'});
      const entry = this.codes.get(String(body.code || '').toUpperCase());
      if (!entry || entry.expires < Date.now()) return this.reply(res,403,{error:'연결 코드가 잘못되었거나 만료되었습니다.'});
      if (!/^[a-zA-Z0-9-]{20,80}$/.test(body.deviceId || '')) throw new Error('Invalid device');
      const existing=[...this.clients.values()].find(c=>c.deviceId===body.deviceId && c.accountId!==entry.accountId);
      if(existing)return this.reply(res,409,{error:'이 창은 다른 블로그의 로그인 저장 공간입니다. 앱에서 연결할 블로그의 ‘블로그 열기’를 누른 뒤 그 창에 확장을 설치하세요. Google 계정은 필요하지 않습니다.'});
      this.revoke(entry.accountId);
      const token = crypto.randomBytes(32).toString('hex');
      const c = { ...entry, deviceId: body.deviceId, token, origin, status:'unknown' }; delete c.expires;
      this.clients.set(token,c); this.lastSeen.set(token,Date.now()); this.codes.delete(String(body.code).toUpperCase()); this.save();
      this.emit('status',c.accountId,this.snapshot(c.accountId));
      return this.reply(res,200,{ token, accountId:c.accountId, blogId:c.blogId, label:c.label, platform:c.platform });
    }
    const token = String(req.headers.authorization || '').replace(/^Bearer /,''); const c = this.clients.get(token);
    if (!c) return this.reply(res,401,{error:'앱에서 연결 코드를 새로 발급받아 주세요.'});
    if (c.origin && origin && c.origin!==origin) return this.reply(res,403,{error:'Wrong extension origin'});
    this.lastSeen.set(token,Date.now());
    if (url.pathname === '/heartbeat' && req.method === 'POST') return this.reply(res,200,{ok:true});
    if (url.pathname === '/task/status' && req.method === 'POST') {const task=this.tasks.get(body.id);if(!task || task.clientToken!==token)return this.reply(res,404,{error:'Unknown task'});return this.reply(res,200,{state:task.state});}
    if (url.pathname === '/stage' && req.method === 'POST') {const task=this.tasks.get(body.id);if(!task || task.clientToken!==token || task.state!=='running')throw new Error('작업이 취소되었거나 종료되었습니다.');if(!['writing','final_publish'].includes(body.stage))throw new Error('Invalid stage');task.stage=body.stage;task.waiting=false;this.saveTasks();return this.reply(res,200,{ok:true});}
    if (url.pathname === '/progress' && req.method === 'POST') {
      const task=this.tasks.get(body.id);if(!task || task.clientToken!==token || task.state!=='running')throw new Error('종료된 작업입니다.');
      const message=String(body.message || '').slice(0,200);
      if(message && task.progress!==message){task.progress=message;this.emit('progress',task.accountId,message);}
      return this.reply(res,200,{ok:true});
    }
    if (url.pathname === '/session/request' && req.method === 'POST') {
      if(![...this.tasks.values()].some(t=>t.accountId===c.accountId && ['queued','running'].includes(t.state)))this.request(c.accountId,'session',{interactive:true}).catch(()=>{});
      return this.reply(res,200,{ok:true});
    }
    if (url.pathname === '/status' && req.method === 'POST') {this.updateSession(c,body.session);return this.reply(res,200,{ok:true});}
    if (url.pathname === '/waiting' && req.method === 'POST') {
      const t=this.tasks.get(body.id);if(!t || t.clientToken!==token || t.state!=='running')throw new Error('Unknown task');
      const changed=!t.waiting || c.reason!==body.reason;t.waiting=true;c.status=STATES.has(body.status)?body.status:'expired';if(['expired','security_check','account_mismatch'].includes(c.status))c.confirmedStatus=c.status;c.reason=String(body.reason || 'Chrome에서 로그인하면 자동으로 이어집니다.');
      if(changed){this.saveTasks();this.save();this.emit('status',c.accountId,this.snapshot(c.accountId));}return this.reply(res,200,{ok:true});
    }
    if (url.pathname === '/disconnect' && req.method === 'POST') {this.revoke(c.accountId);return this.reply(res,200,{ok:true});}
    if (url.pathname === '/poll' && req.method === 'POST') {
      this.updateSession(c,body.session);
      const busy=[...this.tasks.values()].some(t=>t.state==='running' && this.clients.get(t.clientToken)?.deviceId===c.deviceId);
      const task = !busy && [...this.tasks.values()].find(t => t.clientToken === token && t.state === 'queued');
      if (task) { task.state='running'; this.saveTasks(); }
      return this.reply(res,200,{ task:task ? { id:task.id,type:task.type,payload:this.publicPayload(task),blogId:task.blogId,platform:task.platform } : null });
    }
    if (url.pathname === '/result' && req.method === 'POST') {
      const t = this.tasks.get(body.id); if (!t || t.clientToken !== token) return this.reply(res,404,{error:'Unknown task'});
      if (['done','failed','cancelled','expired'].includes(t.state)) return this.reply(res,200,{ok:true});
      if(t.type==='publish' && !body.error){
        const draft=t.platform==='naver' && t.payload.publishVisibility==='draft';
        const valid=draft ? body.result?.saved===true && body.result.title===t.payload.title && require('./publishRecovery').confirmedPublication(body.result) : body.result?.published===true && body.result?.saved!==true;
        if(!valid)throw new Error('발행 또는 임시저장 완료 확인이 누락되었습니다.');
      }
      t.state = body.error ? 'failed' : 'done'; t.result = body.result || null; t.error = String(body.error || ''); t.code=String(body.code || ''); this.saveTasks();
      if(t.type==='session' && STATES.has(body.result?.status))this.updateSession(c,{...body.result,checkedAt:new Date().toISOString()});
      this.emit('status',c.accountId,this.snapshot(c.accountId));
      const waiter=this.waiters.get(t.id); if (waiter) { clearTimeout(waiter.timer); this.waiters.delete(t.id); body.error ? waiter.reject(failure(body.error,body.code || 'EXTENSION_ERROR')) : waiter.resolve(body.result); }
      return this.reply(res,200,{ok:true});
    }
    if (url.pathname === '/asset' && req.method === 'GET') {
      const t=this.tasks.get(url.searchParams.get('task')); if (!t || t.clientToken !== token || t.state !== 'running') return this.reply(res,403,{error:'Asset unavailable'});
      const i=Number(url.searchParams.get('index')); const files=this.assetPaths(t);
      if (!Number.isInteger(i) || !files[i]) throw new Error('Invalid asset');
      const file=this.resolveAsset(files[i]); const ext=path.extname(file).toLowerCase(); const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[ext];
      if (!mime || fs.statSync(file).size > 25*1024*1024) throw new Error('Unsupported image');
      // Only server-created job image paths are exposed, never an arbitrary requested path.
      return this.reply(res,200,{name:path.basename(file),mime,data:fs.readFileSync(file).toString('base64')});
    }
    this.reply(res,404,{error:'Not found'});
  }
  assetPaths(t) { return [t.payload.titleImagePath, ...(t.payload.bodyImages || []).map(i=>i.path)].filter(Boolean); }
  resolveAsset(file) {
    const resolved=fs.realpathSync(file);
    const allowed=['image','jobs','account-assets','test-assets'].some(folder=>{
      const root=path.join(this.root,folder);
      if(!fs.existsSync(root))return false;
      const relative=path.relative(fs.realpathSync(root),resolved);
      return relative!=='' && !relative.startsWith('..'+path.sep) && relative!=='..' && !path.isAbsolute(relative);
    });
    if(!allowed || !fs.statSync(resolved).isFile()) throw new Error('Image must be inside runtime job/reference image folders');
    return resolved;
  }
  updateSession(c,session) {
    if(!session || !STATES.has(session.status))return;
    const checked=Date.parse(session.checkedAt);if(!Number.isFinite(checked)||checked>Date.now()+5000||Date.now()-checked>120000)return;
    if(checked<Date.parse(c.checkedAt || ''))return;
    if(c.status===session.status && c.checkedAt===session.checkedAt)return;
    if(['valid','expired','security_check','account_mismatch'].includes(session.status))c.confirmedStatus=session.status;
    else if(c.status==='valid' && !c.confirmedStatus)c.confirmedStatus='valid';
    Object.assign(c,{status:session.status,checkedAt:session.checkedAt,reason:String(session.reason || '').slice(0,500)});this.save();this.emit('status',c.accountId,this.snapshot(c.accountId));
  }
  publicPayload(t) {
    const files=this.assetPaths(t); return { ...t.payload, titleImagePath:undefined, titleImageName:t.payload.titleImagePath ? path.basename(t.payload.titleImagePath) : '', titleImageIndex:t.payload.titleImagePath ? files.indexOf(t.payload.titleImagePath) : null,
      bodyImages:(t.payload.bodyImages || []).map(i=>({sequence:i.sequence,index:files.indexOf(i.path),name:path.basename(i.path),isReferenceOriginal:i.isReferenceOriginal===true})) };
  }
}
let bridge;
function configureBridge(root, port=PORT) { if (!bridge) bridge=new ExtensionBridge(root,port); return bridge; }
function getBridge() { if (!bridge) throw failure('앱을 먼저 실행해 주세요.'); return bridge; }
module.exports={ExtensionBridge, configureBridge, getBridge, PORT};
