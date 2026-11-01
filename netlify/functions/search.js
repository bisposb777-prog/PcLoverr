const core=require('../../core.js');
const H={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const out=(c,o)=>({statusCode:c,headers:H,body:JSON.stringify(o)});
exports.handler=async(event)=>{
  const p=event.queryStringParameters||{},q=(p.q||'').trim().slice(0,100);
  if(q.length<2)return out(400,{message:'Digite pelo menos 2 caracteres.'});
  try{const d='detail' in p?+p.detail||0:core.DETAIL;
    return out(200,await core.search(q,p.refresh==='1',Math.max(0,Math.min(core.DETAIL,d))))}
  catch(e){return out(e.code===503?503:502,{message:core.clean(e.message||'Erro')})}};
