import PostalMime from './vendor/postal-mime/postal-mime.js';

export const LIMITS = Object.freeze({raw:25*1024*1024, aggregate:75*1024*1024, messages:30, depth:8, parts:1000, image:5*1024*1024});
export const VERSION = '0.1.0';
export function bytesOf(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === 'string') return Uint8Array.from(value, c => c.charCodeAt(0) & 255);
  throw new Error('Formato de bytes no soportado');
}
export async function sha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2,'0')).join('');
}
export function rawHeaders(bytes) {
  const raw = Array.from(bytes.subarray(0, Math.min(bytes.length,2*1024*1024)), c => String.fromCharCode(c)).join('');
  return raw.split(/\r?\n\r?\n/,1)[0];
}
export async function parseEvidence(input, filename='correo.eml') {
  const bytes = bytesOf(input);
  if (!bytes.length) throw new Error('El archivo está vacío.');
  if (bytes.length > LIMITS.raw) throw new Error('EML supera el límite de 25 MiB; análisis no realizado.');
  if (/\.msg$/i.test(filename) || [0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1].every((b,i)=>bytes[i]===b)) throw new Error('MSG/OLE no soportado. Exporta el original como EML.');
  const result = {schemaVersion:1, version:VERSION, filename, sha256:await sha256(bytes), size:bytes.length, messages:[], warnings:[], analyzedAt:new Date().toISOString()};
  let partCount=0, aggregate=0;
  async function walk(raw,name,parentId,depth,source) {
    if (depth>LIMITS.depth || result.messages.length>=LIMITS.messages || aggregate+raw.length>LIMITS.aggregate) {
      result.warnings.push(`${source}: mensaje omitido por límite de profundidad (${LIMITS.depth}), cantidad (${LIMITS.messages}) o tamaño acumulado (75 MiB).`); return;
    }
    aggregate+=raw.length;
    let email;
    try {
      email=await PostalMime.parse(raw,{forceRfc822Attachments:true,attachmentEncoding:'arraybuffer',maxNestingDepth:32,maxHeadersSize:2*1024*1024,maxPartCount:LIMITS.parts,maxRfc822NestingDepth:0});
    } catch(error) {
      if (!parentId) throw new Error(`No se pudo interpretar el EML: ${error.code||error.message}`);
      result.warnings.push(`${source}: EML anidado no interpretado (${error.code||error.message}).`); return;
    }
    const id=`m${result.messages.length+1}`;
    const node={id,parentId,depth,source,filename:name,sha256:await sha256(raw),rawHeaders:rawHeaders(raw),headers:email.headers,
      subject:email.subject||'(sin asunto)',from:email.from||null,replyTo:email.replyTo||[],to:email.to||[],cc:email.cc||[],
      returnPath:email.returnPath||'',date:email.date||'',messageId:email.messageId||'',text:email.text||'',html:email.html||'',attachments:[]};
    result.messages.push(node);
    for (const [index,att] of email.attachments.entries()) {
      if (++partCount>LIMITS.parts) {result.warnings.push(`${source}: adjuntos restantes omitidos por límite global (${LIMITS.parts}).`); break;}
      const content=bytesOf(att.content), path=`${source}/adjunto[${index+1}]`;
      const item={filename:att.filename||'(sin nombre)',mimeType:att.mimeType,size:content.length,contentId:att.contentId||'',source:path,sha256:await sha256(content),content};
      node.attachments.push(item);
      if (att.mimeType==='message/rfc822' || /\.eml$/i.test(att.filename||'')) await walk(content,item.filename,id,depth+1,path);
    }
  }
  await walk(bytes,filename,null,0,'archivo');
  return result;
}
export function collectTextIndicators(text,source) {
  const output=[]; output.warnings=[];
  const input=String(text).slice(0,500000);
  if(String(text).length>input.length)output.warnings.push(`${source}: extracción limitada a 500000 caracteres; la fuente completa se conserva.`);
  for(const match of input.matchAll(/https?:\/\/[^\s<>"']+/gi)) {output.push({type:'URL',value:match[0],source});if(output.length>=2000)break;}
  // Bound each candidate before applying the email pattern: a long word without
  // an @ must not trigger quadratic regex backtracking on hostile body text.
  for(const token of input.split(/[\s<>"(),;]+/)) {
    if(output.length>=2000)break;
    if(token.length>320 || !token.includes('@'))continue;
    for(const match of token.matchAll(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}/gi))output.push({type:'Email address',value:match[0],source});
  }
  if(output.length>=2000)output.warnings.push(`${source}: límite de 2000 indicadores por fuente alcanzado; cobertura parcial.`);
  return output;
}
export function unwrapChain(value,unwrap,max=8) {
  const chain=[],seen=new Set([value]); let current=value;
  for(let i=0;i<max;i++) {
    const step=unwrap(current,true);
    if(!step.changed) return {chain,current,note:step.note||'',stopped:'complete'};
    if(seen.has(step.url)) return {chain,current,stopped:'cycle'};
    chain.push({original:current,extracted:step.url,vendor:step.vendor}); seen.add(step.url); current=step.url;
  }
  return {chain,current,stopped:'limit'};
}
export function targetNotice(node) {
  return node.parentId ? 'Objetivo: mensaje adjunto. Autenticación y headers corresponden a esta capa, no al reportante.' :
    'Objetivo: mensaje externo. Si es un reporte, selecciona su EML adjunto. El buzón de phishing no determina FIR → Internal Communication.';
}
export const ROUTES=Object.freeze({NTD:[],DNE:[],Simulation:[],FIR:['Login Required','Content Encrypted','Content Blocked','Missing Headers','Missing Content','Internal Communication'],
  Malicious:['Link → Phishing','Link → O365','Link → Link to Payload','Payload → Docuphish','Response → 419 Scam','Response → RECON','Response → BEC','Response → Vishing','Response → Job Scam','Response → Tech Support Scam']});
export function validateDecision({category,route,rationale,simulationEvidence}) {
  if(!Object.hasOwn(ROUTES,category)) throw new Error('Selecciona una categoría revisada por el analista.');
  if(ROUTES[category].length && !ROUTES[category].includes(route)) throw new Error('Falta una ruta o subcategoría válida.');
  if(!rationale?.trim()) throw new Error('Añade el fundamento y sus evidencias.');
  if(category==='Simulation' && !simulationEvidence?.trim()) throw new Error('Simulation requiere corroboración del ejercicio y su fuente; un dominio o header aislado no basta.');
  return true;
}
