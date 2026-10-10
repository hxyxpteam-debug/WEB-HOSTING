const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { railway } = require('./railway');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOADS = path.join(DATA, 'uploads');
const META = path.join(DATA, 'metadata');
for (const dir of [DATA, UPLOADS, META]) fs.mkdirSync(dir, {recursive:true});
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be set to a random string of at least 32 characters.');
  process.exit(1);
}
if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD_HASH) {
  console.error('Set ADMIN_USERNAME and ADMIN_PASSWORD_HASH. See .env.example.');
  process.exit(1);
}
const sessions = new Map(); // Memory sessions intentionally expire on restart; no session DB needed.
const SESSION_MS = 8 * 60 * 60 * 1000;
const sign = value => crypto.createHmac('sha256', process.env.SESSION_SECRET).update(value).digest('hex');
function setSession(res, sid) {
  res.cookie('panel_session', sid + '.' + sign(sid), {
    httpOnly:true, secure:process.env.NODE_ENV === 'production', sameSite:'strict',
    maxAge:SESSION_MS, path:'/'
  });
}
function isAuthed(req) {
  const raw = req.cookies?.panel_session;
  if (!raw) return false;
  const [sid, mac] = raw.split('.');
  if (!sid || !mac || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(sign(sid)))) return false;
  const session = sessions.get(sid);
  if (!session || session.expires < Date.now()) { sessions.delete(sid); return false; }
  session.expires = Date.now() + SESSION_MS;
  return true;
}
function auth(req,res,next) { if (!isAuthed(req)) return res.status(401).json({error:'Login required'}); next(); }
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({contentSecurityPolicy:{directives:{
  defaultSrc:["'self'"], styleSrc:["'self'","'unsafe-inline'"], scriptSrc:["'self'"],
  imgSrc:["'self'","data:"], connectSrc:["'self'"], objectSrc:["'none'"], frameAncestors:["'none'"]
}}}));
app.use(express.json({limit:'64kb'}));
app.use(cookieParser());
app.use('/api/login', rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:true,legacyHeaders:false}));
app.use(express.static(path.join(__dirname,'..','public'), {index:'index.html'}));
app.get('/api/health', (req,res)=>res.json({ok:true, timestamp:new Date().toISOString()}));
app.get('/api/session', (req,res)=>res.json({authenticated:isAuthed(req), username:isAuthed(req)?process.env.ADMIN_USERNAME:null}));
app.post('/api/login', async (req,res)=>{
  const username = String(req.body?.username || '');
  const password = String(req.body?.password || '');
  const goodUser = crypto.timingSafeEqual(Buffer.from(username.padEnd(128).slice(0,128)), Buffer.from(String(process.env.ADMIN_USERNAME).padEnd(128).slice(0,128)));
  const goodPass = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH).catch(()=>false);
  if (!goodUser || !goodPass) return res.status(401).json({error:'Invalid credentials'});
  const sid = crypto.randomBytes(32).toString('hex');
  sessions.set(sid,{expires:Date.now()+SESSION_MS});
  setSession(res,sid);
  res.json({ok:true,username:process.env.ADMIN_USERNAME});
});
app.post('/api/logout', (req,res)=> {
  const raw=req.cookies?.panel_session; if(raw) sessions.delete(raw.split('.')[0]);
  res.clearCookie('panel_session',{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/'});
  res.json({ok:true});
});
const upload = multer({
  storage:multer.memoryStorage(),
  limits:{fileSize:(Number(process.env.MAX_UPLOAD_MB)||10)*1024*1024, files:1},
  fileFilter:(req,file,cb)=>{
    if (!/\.zip$/i.test(file.originalname)) return cb(new Error('Upload a .zip project archive.'));
    cb(null,true);
  }
});
function safeId(){return crypto.randomBytes(8).toString('hex');}
function safeName(s){return String(s||'project').toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40)||'project';}
app.get('/api/projects',auth,(req,res)=>{
  const items=fs.readdirSync(META).filter(x=>x.endsWith('.json')).map(f=>{
    try { return JSON.parse(fs.readFileSync(path.join(META,f),'utf8')); } catch { return null; }
  }).filter(Boolean).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  res.json({projects:items});
});
app.post('/api/projects/upload',auth,upload.single('project'),async(req,res)=>{
  try {
    if(!req.file) return res.status(400).json({error:'Choose a ZIP file.'});
    // We deliberately do not execute uploaded code inside this control-panel process.
    const id=safeId(), name=safeName(req.body.name || path.basename(req.file.originalname,'.zip'));
    const archivePath=path.join(UPLOADS,`${id}.zip`);
    fs.writeFileSync(archivePath,req.file.buffer,{flag:'wx',mode:0o600});
    const record={id,name,language:String(req.body.language||'auto'),originalName:path.basename(req.file.originalname),
      size:req.file.size,createdAt:new Date().toISOString(),status:'uploaded',
      archivePath, note:'Stored only. Deploy requires the Railway/GitHub integration to be configured.'};
    fs.writeFileSync(path.join(META,`${id}.json`),JSON.stringify(record,null,2),{mode:0o600,flag:'wx'});
    res.status(201).json({project:{...record,archivePath:undefined}});
  } catch(e) { console.error(e); res.status(500).json({error:'Could not store project.'}); }
});
app.delete('/api/projects/:id',auth,(req,res)=>{
  const id=String(req.params.id);
  if(!/^[a-f0-9]{16}$/.test(id)) return res.status(400).json({error:'Invalid project id'});
  const mf=path.join(META,id+'.json');
  if(!fs.existsSync(mf)) return res.status(404).json({error:'Project not found'});
  const p=JSON.parse(fs.readFileSync(mf,'utf8'));
  if(p.archivePath && fs.existsSync(p.archivePath)) fs.unlinkSync(p.archivePath);
  fs.unlinkSync(mf);
  res.json({ok:true});
});
app.get('/api/railway/status',auth,async(req,res)=>{
  try { res.json(await railway.status()); }
  catch(e) { res.status(502).json({error:e.message}); }
});
app.get('/api/railway/services',auth,async(req,res)=>{
  try { res.json(await railway.services()); }
  catch(e) { res.status(502).json({error:e.message}); }
});
app.post('/api/railway/action',auth,async(req,res)=>{
  const {action,serviceId,environmentId}=req.body||{};
  if(!['deploy','restart','stop','start','logs'].includes(action)) return res.status(400).json({error:'Unsupported action'});
  try {
    const result=await railway.action({action,serviceId,environmentId});
    res.json(result);
  } catch(e) { res.status(502).json({error:e.message}); }
});
app.get('/api/railway/logs',auth,async(req,res)=>{
  try { res.json(await railway.logs(String(req.query.deploymentId||''))); }
  catch(e) { res.status(502).json({error:e.message}); }
});
app.use((err,req,res,next)=>{
  if (err instanceof multer.MulterError) return res.status(400).json({error:err.code==='LIMIT_FILE_SIZE'?'File too large':err.message});
  if (err) return res.status(400).json({error:err.message || 'Bad request'});
  next();
});
app.listen(PORT,'0.0.0.0',()=>console.log(`Hosting panel listening on ${PORT}`));
