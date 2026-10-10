const $=s=>document.querySelector(s);
const loginView=$('#loginView'), dashboard=$('#dashboardView'), logoutBtn=$('#logoutBtn');
async function api(url,opts={}) {
  const headers={...(opts.body instanceof FormData?{}:{'Content-Type':'application/json'}),...(opts.headers||{})};
  const r=await fetch(url,{credentials:'same-origin',...opts,headers});
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error||`Request failed (${r.status})`);
  return data;
}
function showDashboard(on){loginView.classList.toggle('hidden',on);dashboard.classList.toggle('hidden',!on);logoutBtn.classList.toggle('hidden',!on);$('#connectionText').textContent=on?'Admin session active':'Private admin console';}
async function checkSession(){try{const s=await api('/api/session');showDashboard(s.authenticated);if(s.authenticated)await refreshAll();}catch{showDashboard(false);}}
$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();$('#loginError').textContent='';const f=new FormData(e.currentTarget);try{await api('/api/login',{method:'POST',body:JSON.stringify({username:f.get('username'),password:f.get('password')})});e.currentTarget.reset();showDashboard(true);await refreshAll();}catch(err){$('#loginError').textContent=err.message;}});
logoutBtn.addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST',body:'{}'});}finally{showDashboard(false);}});
$('#refreshBtn').addEventListener('click',refreshAll);
$('#servicesBtn').addEventListener('click',loadServices);
$('#uploadForm').addEventListener('submit',async e=>{
  e.preventDefault();const msg=$('#uploadMessage');msg.textContent='Uploading archive…';
  const form=new FormData(e.currentTarget);
  try{const d=await api('/api/projects/upload',{method:'POST',body:form});msg.textContent=`Uploaded ${d.project.name} (${formatSize(d.project.size)}). Stored, not yet deployed.`;e.currentTarget.reset();await loadProjects();}
  catch(err){msg.textContent=err.message;}
});
function formatSize(n){return n<1024?`${n} B`:`${(n/1024).toFixed(1)} KB`;}
async function refreshAll(){await Promise.allSettled([loadProjects(),loadRailwayStatus()]);}
async function loadProjects(){const d=await api('/api/projects');const items=d.projects||[];$('#projectCount').textContent=items.length;$('#projectBadge').textContent=`${items.length} PROJECT${items.length===1?'':'S'}`;const root=$('#projectList');root.replaceChildren();if(!items.length){root.innerHTML='<div class="empty">No projects uploaded yet. Add your first ZIP above.</div>';return;}for(const p of items){const row=document.createElement('div');row.className='project-item';const icon=document.createElement('span');icon.className='project-icon';icon.textContent='⌘';const info=document.createElement('div');info.className='project-info';const name=document.createElement('strong');name.textContent=p.name;const small=document.createElement('small');small.textContent=`${p.language||'auto'} · ${formatSize(p.size)} · Stored ${new Date(p.createdAt).toLocaleDateString()}`;info.append(name,small);const del=document.createElement('button');del.textContent='Delete';del.addEventListener('click',async()=>{if(!confirm(`Delete stored archive "${p.name}"?`))return;try{await api(`/api/projects/${encodeURIComponent(p.id)}`,{method:'DELETE'});await loadProjects();}catch(e){alert(e.message);}});row.append(icon,info,del);root.append(row);}}
async function loadRailwayStatus(){try{const d=await api('/api/railway/status');$('#railwayState').textContent='Connected';$('#railwayHint').textContent=`${d.project?.name||'Project'} · API verified`;}catch(e){$('#railwayState').textContent='Setup needed';$('#railwayHint').textContent=e.message;}}
async function loadServices(){const root=$('#serviceList');root.textContent='Loading services…';try{const d=await api('/api/railway/services');root.replaceChildren();if(!d.services?.length){root.textContent='No services found in the configured project.';return;}for(const s of d.services){const row=document.createElement('div');row.className='service-row';const n=document.createElement('span');n.textContent=s.name;const id=document.createElement('small');id.textContent=s.id;id.style.color='#71819b';row.append(n,id);root.append(row);}}catch(e){root.textContent=e.message;}}
checkSession();