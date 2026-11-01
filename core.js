
'use strict';
/* PC Loverr: núcleo da busca de preços (usado pelo servidor local e pelas funções do Netlify).
   Node 18+, sem dependências. As chaves ficam SÓ aqui (variáveis de ambiente / .env). */
const http=require('http'),fs=require('fs'),path=require('path');
try{for(const l of fs.readFileSync(path.join(__dirname,'.env'),'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2].replace(/^["']|["']$/g,'')}}catch{}
const E=process.env,PORT=+E.PORT||3000,TTL=(+E.CACHE_TTL_MIN||60)*60000,DETAIL=Math.min(+E.MAX_PRODUCTS_DETAIL||3,6);
const SERP=E.SERPAPI_KEY,SERP_BASE=E.SERPAPI_BASE||'https://serpapi.com';
const ML_ID=E.ML_APP_ID,ML_SECRET=E.ML_CLIENT_SECRET,ML_BASE=E.ML_BASE||'https://api.mercadolibre.com';
const AI_KEY=E.ANTHROPIC_API_KEY,AI_MODEL=E.ANTHROPIC_MODEL||'claude-sonnet-4-6';
const SECRETS=[SERP,ML_SECRET,AI_KEY].filter(Boolean);
const clean=s=>SECRETS.reduce((a,k)=>a.split(k).join('***'),String(s));
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const num=v=>{if(typeof v==='number')return isFinite(v)?v:null;if(v==null)return null;const s=String(v).replace(/[^\d.,]/g,'');if(!s)return null;const n=parseFloat(s.includes(',')?s.replace(/\./g,'').replace(',','.'):s);return isFinite(n)?n:null};
const safeUrl=u=>{try{const x=new URL(u);return /^https?:$/.test(x.protocol)?x.href:null}catch{return null}};
const urlType=u=>{if(!u)return null;const h=new URL(u).hostname,p=new URL(u).pathname;return /(^|\.)google\.[a-z.]+$/.test(h)?(/^\/(aclk|url)/.test(p)?'redirect':'google'):'loja'};
async function getJSON(url,opts={}){const c=new AbortController(),t=setTimeout(()=>c.abort(),+E.TIMEOUT_MS||((E.NETLIFY||E.AWS_LAMBDA_FUNCTION_NAME)?8000:25000));
  try{const r=await fetch(url,{...opts,signal:c.signal}),txt=await r.text();let j=null;try{j=JSON.parse(txt)}catch{}
    if(!r.ok){const e=new Error((j&&(j.error&&j.error.message||j.error||j.message))||('HTTP '+r.status));e.status=r.status;throw e}return j}
  catch(e){e.message=clean(e.name==='AbortError'?'tempo esgotado':e.message);throw e}finally{clearTimeout(t)}}

/* ---- reconhecimento de fabricante / categoria / modelo / specs (a partir do título real do anúncio) ---- */
const BRANDS=['ASUS','Gigabyte','MSI','Corsair','Kingston','AMD','Intel','NVIDIA','Galax','PNY','Zotac','Gainward','Sapphire','XFX','PowerColor','ASRock','Redragon','Husky','Mancer','Crucial','Samsung','Western Digital','WD','Seagate','XPG','Adata','Cooler Master','DeepCool','NZXT','Thermaltake','Lian Li','EVGA','Fortrek','Gamdias','Pichau','Afox','Palit','Colorful','Biostar','Patriot','HyperX','Lexar','Netac','TeamGroup','Sentey','Aigo','Rise Mode','Brazil PC','Pcyes'];
const CATS=[['Placa de vídeo',/\b(rtx|gtx|geforce|radeon|rx ?\d{3,4}|placa de v[ií]deo|arc a\d)/i],['Processador',/\b(ryzen|core i[3579]|core ultra|processador|athlon|xeon|pentium)\b/i],['Placa-mãe',/placa[- ]m[ãa]e|motherboard|\b[abhxz][3-9]\d0m?\b/i],['Memória RAM',/mem[óo]ria|\bddr[345]\b|\bram\b/i],['SSD/HD',/\bssd\b|nvme|\bhd\b|m\.2|disco/i],['Fonte',/\bfonte\b|\bpsu\b|80 ?plus/i],['Cooler',/cooler|water ?cooler|\baio\b/i],['Gabinete',/gabinete|\bcase\b/i]];
const MODELS=[/\b(?:RTX|GTX|RX)\s?\d{3,4}(?:\s?(?:Ti|Super|XTX|XT|GRE))*/i,/Ryzen\s?\d\s?\d{4}[A-Z0-9]*/i,/Core\s?(?:i[3579]|Ultra\s?\d)[- ]?\d{4,5}[A-Z]{0,2}/i,/\b[ABHXZ]\d{3}[A-Z]?M?(?:-[A-Z]+)?\b/,/\b(?:SN|P3|NV|A400|980|990|870)\s?[A-Za-z0-9]*/];
const SPECRX=[/\b\d{1,3}\s?(?:GB|TB)\b/gi,/\bDDR[345]\b/gi,/\b\d{3,4}\s?W\b/gi,/\b(?:AM[45]|LGA\s?\d{3,4})\b/gi,/\b\d{3,4}\s?MHz\b/gi,/\bNVMe\b/gi,/\bPCIe\s?\d(?:\.\d)?/gi,/\b80\s?Plus\s?\w+/gi,/\b(?:GDDR\d\w?)\b/gi];
function parseTitle(t){const brand=BRANDS.find(b=>new RegExp('\\b'+b.replace(/ /g,'\\s')+'\\b','i').test(t))||null;
  const cat=(CATS.find(c=>c[1].test(t))||[null])[0];const hints=[];for(const m of MODELS){const x=t.match(m);if(x)hints.push(x[0].replace(/\s+/g,' ').trim())}
  const specs=[...new Set(SPECRX.flatMap(r=>t.match(r)||[]).map(s=>s.replace(/\s+/g,' ').trim()))];return{brand,category:cat,modelHints:hints,specs}}
const availFrom=o=>/esgotad|indispon|sem estoque|fora de estoque/i.test(JSON.stringify([o.tag,o.details_and_offers,o.badge,o.snippet,o.delivery]))?'indisponivel':'desconhecida';
const mkOffer=o=>{if(!o.store||o.price==null||!(o.price>0))return null;const url=safeUrl(o.url);return{store:String(o.store),price:o.price,total:o.total??null,currency:'BRL',url,urlType:urlType(url),availability:o.avail||'desconhecida',condition:o.cond||null,note:o.note||null,title:o.title||null,source:o.source}};

/* ---- Provedor 1: Google Shopping via SerpApi ---- */
async function serpSearch(q,detail){
  const base=`${SERP_BASE}/search.json?gl=br&hl=pt-br&google_domain=google.com.br&api_key=${encodeURIComponent(SERP)}`;
  const j=await getJSON(`${base}&engine=google_shopping&q=${encodeURIComponent(q)}`);
  if(j.error)throw new Error(j.error);
  const map=new Map();
  for(const r of (j.shopping_results||[]).slice(0,25)){
    const key=r.product_id?'g'+r.product_id:'t'+norm(r.title).slice(0,70);let p=map.get(key);
    if(!p){p={id:key,title:r.title,thumbnail:r.thumbnail||null,...parseTitle(r.title||''),offers:[],detail:false,token:r.immersive_product_page_token,pid:r.product_id};map.set(key,p)}
    const o=mkOffer({store:r.source,price:num(r.extracted_price??r.price),url:r.link||r.product_link,title:r.title,cond:r.second_hand_condition,avail:availFrom(r),note:r.delivery,source:'google_shopping'});if(o)p.offers.push(o)}
  const list=[...map.values()].filter(p=>p.token||p.pid).slice(0,detail);
  await Promise.allSettled(list.map(async p=>{let st=null;
    if(p.token){try{const d=await getJSON(`${base}&engine=google_immersive_product&page_token=${encodeURIComponent(p.token)}`);st=d.product_results&&d.product_results.stores}catch{}}
    if(!(st&&st.length)&&p.pid){try{const d=await getJSON(`${base}&engine=google_product&product_id=${encodeURIComponent(p.pid)}&offers=1`);st=d.sellers_results&&d.sellers_results.online_sellers}catch{}}
    const offs=(st||[]).map(s=>mkOffer({store:s.name,price:num(s.extracted_price??s.base_price??s.price),total:num(s.total_price??s.total),url:s.link,avail:availFrom(s),note:s.shipping&&String(s.shipping),source:'google_shopping'})).filter(Boolean);
    if(offs.length){p.offers=offs;p.detail=true}}));
  return [...map.values()].map(({token,pid,...p})=>p)}

/* ---- Provedor 2: Mercado Livre ---- */
let mlTok=null;
async function mlToken(){if(mlTok&&mlTok.exp>Date.now()+60000)return mlTok.v;
  const j=await getJSON(`${ML_BASE}/oauth/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:new URLSearchParams({grant_type:'client_credentials',client_id:ML_ID,client_secret:ML_SECRET})});
  mlTok={v:j.access_token,exp:Date.now()+(j.expires_in||21600)*1000};return mlTok.v}
async function mlSearch(q){const t=await mlToken();
  const j=await getJSON(`${ML_BASE}/sites/MLB/search?q=${encodeURIComponent(q)}&limit=10`,{headers:{Authorization:'Bearer '+t,Accept:'application/json'}});
  return (j.results||[]).map(r=>{const o=mkOffer({store:'Mercado Livre',price:num(r.price),url:r.permalink,title:r.title,cond:r.condition==='used'?'usado':'novo',avail:r.available_quantity===0?'indisponivel':r.available_quantity>0?'disponivel':'desconhecida',note:'Marketplace'+(r.seller&&r.seller.nickname?' · vendedor '+r.seller.nickname:'')+(r.official_store_id?' · loja oficial':''),source:'mercadolivre'});
    return o&&{id:'ml'+r.id,title:r.title,thumbnail:r.thumbnail||null,...parseTitle(r.title||''),offers:[o],detail:false}}).filter(Boolean)}

/* ---- IA opcional: só normaliza o texto digitado ---- */
async function aiNormalize(q){if(!AI_KEY)return null;
  try{const j=await getJSON('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':AI_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:AI_MODEL,max_tokens:200,system:'Você normaliza buscas de peças de computador para pesquisa em lojas brasileiras. Responda SOMENTE JSON: {"query":"fabricante + modelo completo","brand":"","category":""}. Corrija erros de digitação e abreviações. Nunca invente preços nem modelos inexistentes: se não tiver certeza, devolva o texto original.',messages:[{role:'user',content:q}]})});
    const o=JSON.parse((j.content||[]).map(c=>c.text||'').join('').replace(/```json|```/g,'').trim());return o&&typeof o.query==='string'&&o.query.length<120?o:null}catch{return null}}

const cache=new Map();
async function search(q,refresh,detail){
  const key=norm(q)+'|'+detail,c=cache.get(key),age=c?Date.now()-c.t:0;
  if(c&&age<TTL&&!(refresh&&age>30000))return{...c.data,cached:true,cacheAgeSec:Math.round(age/1000)};
  const provs=[];if(SERP)provs.push(['serpapi','Google Shopping (SerpApi)',n=>serpSearch(n,detail)]);if(ML_ID&&ML_SECRET)provs.push(['mercadolivre','Mercado Livre (API oficial)',n=>mlSearch(n)]);
  if(!provs.length){const e=new Error('Nenhuma fonte de preços configurada no servidor. Veja o LEIA-ME.');e.code=503;throw e}
  const ai=await aiNormalize(q),nq=ai?ai.query:q;
  const res=await Promise.allSettled(provs.map(p=>p[2](nq)));
  const status=[];let prods=[];
  res.forEach((r,i)=>{const[id,name]=provs[i];if(r.status==='fulfilled'){status.push({id,name,ok:true,count:r.value.length});prods.push(...r.value.map(p=>({...p,_s:id})))}else status.push({id,name,ok:false,error:clean(r.reason&&r.reason.message||'falha')+(r.reason&&r.reason.status?' (HTTP '+r.reason.status+')':'')})});
  const base=prods.filter(p=>p._s==='serpapi'),mls=prods.filter(p=>p._s!=='serpapi'),rest=[];
  for(const m of mls){const t=norm(m.title),host=base.find(b=>b.modelHints.length&&b.modelHints.every(h=>t.includes(norm(h))));host?host.offers.push({...m.offers[0],note:(m.offers[0].note||'')+' · agrupado por código do modelo'}):rest.push(m)}
  const products=[...base,...rest].map(({_s,...p})=>{const seen=new Set();p.offers=p.offers.filter(o=>{const k=norm(o.store)+'|'+o.price;if(seen.has(k))return false;seen.add(k);return true}).sort((a,b)=>a.price-b.price);return p}).filter(p=>p.offers.length);
  const data={query:q,searchedAs:nq,aiNormalized:!!ai,fetchedAt:new Date().toISOString(),providers:status,products,cached:false,cacheAgeSec:0};
  if(status.some(s=>s.ok))cache.set(key,{t:Date.now(),data});return data}

const health=()=>({ok:true,providers:{serpapi:!!SERP,mercadolivre:!!(ML_ID&&ML_SECRET),ia_normalizacao:!!AI_KEY},cacheTtlMin:TTL/60000});
module.exports={search,health,clean,DETAIL};
