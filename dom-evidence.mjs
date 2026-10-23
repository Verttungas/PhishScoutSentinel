import {collectTextIndicators,unwrapChain} from './core.mjs';
// Template contents are inert; never attach this template or its children to the page.
export function inspectHtml(html,source,doc=document) {
  const warnings=[],input=html.slice(0,100000);
  if(html.length>input.length)warnings.push(`${source}: HTML inspeccionado limitado a 100000 caracteres; fuente completa conservada.`);
  const template=doc.createElement('template'); template.innerHTML=input;
  const output=[];
  for(const el of template.content.querySelectorAll('[href],[src],[action],[formaction],[poster],[data]')) {
    for(const name of ['href','src','action','formaction','poster','data']) {
      const value=el.getAttribute(name);
      if(value && /^https?:\/\//i.test(value)) output.push({type:'URL',value,source:`${source} / ${el.localName}[${name}]`,visibleText:el.textContent||''});
    }
  }
  for(const el of template.content.querySelectorAll('script,style')) el.remove();
  const text=template.content.textContent||'';
  const extracted=collectTextIndicators(text,`${source} / texto (incluye oculto)`);
  output.push(...extracted);warnings.push(...extracted.warnings);
  return {text,indicators:output,warnings};
}
export function inventory(node) {
  const html=inspectHtml(node.html,`${node.source}/html`);
  const textIndicators=collectTextIndicators(node.text,`${node.source}/text`);
  const warnings=[...html.warnings,...textIndicators.warnings],list=[...textIndicators,...html.indicators];
  function append(values){list.push(...values);warnings.push(...values.warnings||[]);}
  for(const header of node.headers)append(collectTextIndicators(header.value,`${node.source}/header/${header.originalKey||header.key}`));
  const phoneText=node.text.slice(0,500000)+'\n'+html.text;
  for(const value of globalThis.PeelPhones.extractPhones(phoneText)) list.push({type:'Cellphone',value,source:`${node.source}/cuerpo; candidato sin validar`});
  for(const att of node.attachments) {
    if(att.mimeType==='text/calendar' || /\.ics$/i.test(att.filename)) {
      const text=new TextDecoder().decode(att.content.subarray(0,500000));
      if(att.content.length>500000)warnings.push(`${att.source}: calendario limitado a 500000 bytes; cobertura parcial.`);
      for(const value of globalThis.IcsLinks.parseIcsUrls(text))list.push({type:'URL',value,source:att.source});
    } else if(/^text\//.test(att.mimeType) && att.mimeType!=='text/html')append(collectTextIndicators(new TextDecoder().decode(att.content),att.source));
    else if(att.mimeType==='text/html'){const part=inspectHtml(new TextDecoder().decode(att.content),att.source);list.push(...part.indicators);warnings.push(...part.warnings);}
  }
  if(list.length>5000)warnings.push(`${node.source}: inventario limitado a 5000 ocurrencias; cobertura parcial.`);
  const output=list.slice(0,5000).map(item=>({...item,...(item.type==='URL'?{extraction:unwrapChain(item.value,globalThis.WrapperUnwrap.unwrapStep)}:{})}));
  output.warnings=warnings;return output;
}
