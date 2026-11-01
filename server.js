/* Servidor local (npm start). No Netlify quem responde são as funções em netlify/functions. */
'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),core=require('./core.js');
const PORT=+process.env.PORT||3000;
const hdr={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const send=(res,code,obj)=>{res.writeHead(code,hdr);res.end(JSON.stringify(obj))};
http.createServer(async(req,res)=>{const u=new URL(req.url,'http://x');
  try{
    if(u.pathname==='/api/health')return send(res,200,core.health());
    if(u.pathname==='/api/search'){const q=(u.searchParams.get('q')||'').trim().slice(0,100);if(q.length<2)return send(res,400,{message:'Digite pelo menos 2 caracteres.'});
      const d=u.searchParams.has('detail')?+u.searchParams.get('detail')||0:core.DETAIL;return send(res,200,await core.search(q,u.searchParams.get('refresh')==='1',Math.max(0,Math.min(core.DETAIL,d))))}
    if(u.pathname==='/'||u.pathname==='/index.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(fs.readFileSync(path.join(__dirname,'public','index.html')))}
    send(res,404,{message:'Não encontrado'})}
  catch(e){send(res,e.code===503?503:502,{message:core.clean(e.message||'Erro')})}
}).listen(PORT,()=>console.log('PC Loverr em http://localhost:'+PORT));
