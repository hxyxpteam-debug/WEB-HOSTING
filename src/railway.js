const ENDPOINT='https://backboard.railway.com/graphql/v2';
async function gql(query, variables={}) {
  if(!process.env.RAILWAY_API_TOKEN) throw new Error('Set RAILWAY_API_TOKEN in Railway service variables.');
  const r=await fetch(ENDPOINT,{method:'POST',headers:{
    'Authorization':`Bearer ${process.env.RAILWAY_API_TOKEN}`,
    'Content-Type':'application/json'
  },body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(15000)});
  const body=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(`Railway API HTTP ${r.status}`);
  if(body.errors?.length) throw new Error(body.errors.map(e=>e.message).join('; '));
  if(!body.data) throw new Error('Railway API returned no data');
  return body.data;
}
const requireEnv=(k)=>{if(!process.env[k])throw new Error(`Set ${k} in environment variables.`);return process.env[k];};
const railway={
  async status(){
    const projectId=requireEnv('RAILWAY_PROJECT_ID');
    const environmentId=requireEnv('RAILWAY_ENVIRONMENT_ID');
    const data=await gql(`query PanelStatus($projectId:String!,$environmentId:String!){
      project(id:$projectId){id name}
      environment(id:$environmentId){id name}
    }`,{projectId,environmentId});
    return {configured:true,project:data.project,environment:data.environment};
  },
  async services(){
    const projectId=requireEnv('RAILWAY_PROJECT_ID');
    const data=await gql(`query PanelServices($projectId:String!){project(id:$projectId){id name services{edges{node{id name}}}}}`,{projectId});
    return {services:(data.project?.services?.edges||[]).map(e=>e.node)};
  },
  async action({action,serviceId,environmentId}){
    // Railway's public GraphQL schema evolves. Avoid guessing mutation names and
    // accidentally changing the wrong service. Use the verified service/deployment
    // ids from your Railway project and validate mutations against the current API docs.
    if(!serviceId) throw new Error('serviceId is required.');
    if(action==='deploy') {
      throw new Error('Connect this project service to a GitHub repository in Railway first, then deploy from Railway. Automatic per-upload service creation is not enabled in this safe starter.');
    }
    if(action==='logs') return this.logs('');
    throw new Error(`Action "${action}" needs a schema-verified Railway mutation. Use Railway dashboard for ${action} until you add the current mutation from the official API cookbook. No action was sent.`);
  },
  async logs(deploymentId){
    if(!deploymentId) throw new Error('Enter a Railway deployment ID to query logs. Deployment log streaming differs by API operation; no fabricated logs are shown.');
    throw new Error('Wire the current deployment log query from Railway API cookbook for your account schema. No fabricated logs are shown.');
  }
};
module.exports={railway};
