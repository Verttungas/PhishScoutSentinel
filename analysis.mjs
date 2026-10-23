import {LIMITS,VERSION,ROUTES,bytesOf,targetNotice,validateDecision} from './core.mjs';
import {inspectHtml,inventory} from './dom-evidence.mjs';
const $=id=>document.getElementById(id);
const api=globalThis.messenger||globalThis.browser;
let evidence=null,selected=null,indicators=[],job=0,worker=null,timer=null,rejectPending=null;
const decisions=new Map(),objectUrls=[];
function status(text){$('status').textContent=text;}
function element(tag,text,className){const el=document.createElement(tag); if(text!=null)el.textContent=text; if(className)el.className=className; return el;}
function revokeImages(){for(const url of objectUrls)URL.revokeObjectURL(url); objectUrls.length=0;}
function stop(){job++;worker?.terminate();worker=null;clearTimeout(timer);if(rejectPending)rejectPending(new Error('Análisis cancelado.'));rejectPending=null;$('cancel').disabled=true;}
function clear(){stop();evidence=null;selected=null;indicators=[];decisions.clear();revokeImages();$('targets').replaceChildren();$('warnings').replaceChildren();$('evidence').hidden=true;$('empty').hidden=false;$('export').disabled=true;$('file').value='';status('Sesión local limpiada.');}
function parse(bytes,filename,id){
  return new Promise((resolve,reject)=>{
    rejectPending=reject;worker=new Worker(new URL('./parse-worker.mjs',import.meta.url),{type:'module'});
    const finish=()=>{clearTimeout(timer);worker?.terminate();worker=null;rejectPending=null;$('cancel').disabled=true;};
    worker.onmessage=({data})=>{if(id!==job||data.id!==id)return;finish();data.error?reject(new Error(data.error)):resolve(data.result);};
    worker.onerror=()=>{if(id!==job)return;finish();reject(new Error('No se pudo iniciar el parser local.'));};
    timer=setTimeout(()=>{finish();reject(new Error('Tiempo de análisis agotado (20 s); no se informa un resultado completo.'));},20000);
    worker.postMessage({id,bytes,filename},[bytes.buffer]);
  });
}
async function load(bytes,filename){
  clear();const id=job;$('cancel').disabled=false;status('Interpretando MIME localmente…');
  try{
    const result=await parse(bytes,filename,id);if(id!==job)return;evidence=result;
    status(`${filename} · ${result.size.toLocaleString()} bytes · ${result.messages.length} mensaje(s) · SHA-256 ${result.sha256}`);
    for(const warning of result.warnings)$('warnings').append(element('p',warning));
    if(result.messages.length>1)$('warnings').prepend(element('p','Hay mensajes adjuntos. Selecciona expresamente el original a analizar.'));
    $('export').disabled=false;$('empty').hidden=true;$('evidence').hidden=false;
    for(const node of result.messages){const btn=element('button',`${'↳ '.repeat(node.depth)}${node.id} · ${node.subject}`,'target');btn.dataset.id=node.id;btn.addEventListener('click',()=>select(node.id));$('targets').append(btn);}
    select(result.messages[0].id);
  }catch(error){if(id===job)status(error.message);}
}
function currentDecision(){return {category:$('category').value,route:$('route').value,synopsis:$('synopsis').value,rationale:$('rationale').value,simulationEvidence:$('simulation').value,marked:$('marked').value,vm:$('vm').value};}
function routes(value=''){const options=[element('option','Selecciona si corresponde')];options[0].value='';for(const route of ROUTES[$('category').value]||[])options.push(element('option',route));$('route').replaceChildren(...options);$('route').value=value;}
function select(id){
  if(selected)decisions.set(selected.id,currentDecision());
  selected=evidence.messages.find(node=>node.id===id);const node=selected;revokeImages();
  $('decision-status').textContent='';for(const btn of $('targets').children)btn.setAttribute('aria-pressed',String(btn.dataset.id===id));
  $('subject').textContent=node.subject;$('target-notice').textContent=targetNotice(node);$('provenance').textContent=`${node.source} · ${node.filename} · SHA-256 ${node.sha256}`;
  $('identity').replaceChildren();
  const address=value=>JSON.stringify(value);
  for(const [key,value] of Object.entries({From:address(node.from),'Reply-To':address(node.replyTo),'Return-Path':node.returnPath,To:address(node.to),Cc:address(node.cc),Date:node.date,'Message-ID':node.messageId}))$('identity').append(element('dt',key),element('dd',value||'(no disponible)'));
  $('headers').textContent=node.rawHeaders;
  $('body').textContent=node.text||inspectHtml(node.html,node.source).text||'(sin texto extraído; revisa adjuntos y cobertura)';
  $('html-source').textContent=node.html||'(sin parte HTML extraída)';
  indicators=inventory(node);$('indicator-count').textContent=`(${indicators.length} ocurrencias)`;$('indicators').replaceChildren();
  for(const warning of indicators.warnings)$('indicators').append(element('p',warning,'notice'));
  if(indicators.length>200)$('indicators').append(element('p',`Vista limitada a 200 de ${indicators.length} ocurrencias. La exportación incluye todas las extraídas.`,'notice'));
  for(const item of indicators.slice(0,200)){
    const row=element('div',null,'indicator');row.append(element('strong',item.type),element('pre',item.value),element('p',item.source,'muted'));
    if(item.visibleText)row.append(element('p',`Texto del enlace: ${item.visibleText}`,'muted'));
    if(item.extraction?.chain.length){const detail=element('details');detail.append(element('summary',`Extracción estática · ${item.extraction.chain.length} capa(s)`),element('pre',JSON.stringify(item.extraction,null,2)));row.append(detail);}
    else if(item.extraction?.note)row.append(element('p',item.extraction.note,'muted'));
    const copy=element('button','Copiar valor exacto');copy.addEventListener('click',()=>copyText(item.value));row.append(copy);$('indicators').append(row);
  }
  if(!indicators.length)$('indicators').append(element('p','Sin indicadores extraídos de los formatos soportados.'));
  $('attachments').replaceChildren();
  for(const att of node.attachments){const row=element('div',null,'attachment');row.append(element('strong',att.filename),element('p',`${att.mimeType} (declarado) · ${att.size} bytes · ${att.source}`,'muted'),element('pre',`SHA-256 ${att.sha256}`));
    // Explicitly raster-only; never load SVG, remote URLs or MIME-declared HTML as an image.
    const raster=att.content[0]===0x89&&att.content[1]===0x50&&att.content[2]===0x4e&&att.content[3]===0x47?'image/png':att.content[0]===0xff&&att.content[1]===0xd8&&att.content[2]===0xff?'image/jpeg':null;
    if(raster&&att.size<=LIMITS.image){const show=element('button','Ver imagen local (sin OCR/QR)');show.addEventListener('click',()=>{show.disabled=true;const url=URL.createObjectURL(new Blob([att.content],{type:raster}));objectUrls.push(url);const image=element('img',null,'image-preview');image.alt=att.filename;image.src=url;row.append(image);});row.append(show);}
    else if(/^image\//.test(att.mimeType))row.append(element('p','Vista omitida: solo PNG/JPEG locales de hasta 5 MiB. El archivo permanece inventariado.','muted'));
    if(att.mimeType==='application/pdf'||/\.pdf$/i.test(att.filename))row.append(element('p','Contenido PDF/QR interno no analizado en esta versión.','muted'));
    $('attachments').append(row);
  }
  if(!node.attachments.length)$('attachments').append(element('p','El parser no identificó adjuntos en esta capa.'));
  const d=decisions.get(id)||{};$('category').value=d.category||'';routes(d.route||'');
  for(const [field,key]of Object.entries({synopsis:'synopsis',rationale:'rationale',simulation:'simulationEvidence',marked:'marked',vm:'vm'}))$(field).value=d[key]||'';
}
async function copyText(value){try{await navigator.clipboard.writeText(value);$('decision-status').textContent='Copiado al portapapeles.';}catch{$('decision-status').textContent='Portapapeles no disponible; copia el texto manualmente.';}}
$('file').addEventListener('change',async()=>{const file=$('file').files[0];if(!file)return;clear();const id=job;if(file.size>LIMITS.raw){status('EML supera 25 MiB; no se ha cargado.');return;}try{const bytes=new Uint8Array(await file.arrayBuffer());if(id===job)await load(bytes,file.name);}catch(error){if(id===job)status(error.message);}});
$('clear').addEventListener('click',clear);$('cancel').addEventListener('click',()=>{stop();status('Análisis cancelado; no se ha producido un resultado.');});$('category').addEventListener('change',()=>routes());
$('copy-report').addEventListener('click',()=>{
  const d=currentDecision();try{validateDecision(d);}catch(error){$('decision-status').textContent=error.message;return;}
  decisions.set(selected.id,d);
  const report=`**Clasificación revisada por el analista:** ${d.category}${d.route?' → '+d.route:''}\n\n**Síntesis:** ${d.synopsis}\n\n**Fundamento:** ${d.rationale}\n${d.category==='Simulation'?'\n**Corroboración:** '+d.simulationEvidence+'\n':''}\n**Marcar como malicioso:** ${d.marked||'Ninguno identificado con evidencia suficiente'}${d.vm?'\n\n**Revisar en VM:** '+d.vm:''}\n\nObjetivo: ${selected.id} · SHA-256 ${selected.sha256}`;
  copyText(report);
});
$('export').addEventListener('click',()=>{
  if(!evidence)return;decisions.set(selected.id,currentDecision());
  const exported={...evidence,messages:evidence.messages.map(node=>{const items=inventory(node);return {...node,attachments:node.attachments.map(({content,...meta})=>meta),indicators:items,indicatorWarnings:items.warnings,decision:{...decisions.get(node.id),status:'borrador del analista; no validado automáticamente'}};})};
  const url=URL.createObjectURL(new Blob([JSON.stringify(exported,null,2)],{type:'application/json'}));const a=element('a');a.href=url;a.download='PhishScoutSentinel-analysis.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('demo').addEventListener('click',()=>load(new TextEncoder().encode(DEMO),'ejemplo-sintetico.eml'));
const DEMO=['From: Reportante <reportante@example.invalid>','To: phishing@cliente.invalid','Subject: Reporte de correo sospechoso','MIME-Version: 1.0','Content-Type: multipart/mixed; boundary="DEMO"','','--DEMO','Content-Type: text/plain; charset=utf-8','','Revisen por favor el original adjunto.','--DEMO','Content-Type: message/rfc822','Content-Disposition: attachment; filename="original.eml"','','From: "Soporte" <sender@example.invalid>','Reply-To: reply@otro.invalid','To: usuario@cliente.invalid','Subject: Verifica tu cuenta (ejemplo sintetico)','Authentication-Results: example.invalid; spf=pass','Content-Type: text/html; charset=utf-8','','<p>Verifica tu cuenta: <a href="https://login.example.invalid/acceso?token=ejemplo%252F#paso">Abrir documento</a></p><img src="https://tracking.example.invalid/pixel"><style>@import url(https://tracking.example.invalid/style);</style><script>fetch("https://tracking.example.invalid/script")</script>','--DEMO--',''].join('\r\n');
async function loadDisplayed(){
  const tabId=Number(new URL(location.href).searchParams.get('sourceTab'));if(!api||!new URL(location.href).searchParams.has('sourceTab')||!Number.isInteger(tabId))return;
  const id=job;status('Leyendo el correo seleccionado en Thunderbird…');
  try{const displayed=await api.messageDisplay.getDisplayedMessages(tabId);const messages=Array.isArray(displayed)?displayed:displayed.messages;
    if(messages?.length!==1)throw new Error('Selecciona un único correo en Thunderbird, o abre un EML desde este panel.');
    const raw=await api.messages.getRaw(messages[0].id,{data_format:'File',decrypt:false});
    if(id!==job)return;if(raw?.size>LIMITS.raw)throw new Error('EML supera 25 MiB; análisis no realizado.');
    const bytes=typeof raw==='string'?bytesOf(raw):new Uint8Array(await raw.arrayBuffer());if(id===job)await load(bytes,'correo-thunderbird.eml');
  }catch(error){if(id===job)status(`No se pudo leer el correo: ${error.message} Puedes abrir el EML manualmente.`);}
}
window.addEventListener('beforeunload',()=>{stop();revokeImages();});
loadDisplayed();
