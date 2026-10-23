import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {deflateSync,constants} from 'node:zlib';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseEvidence,LIMITS,unwrapChain,validateDecision,targetNotice,collectTextIndicators} from '../core.mjs';
const require=createRequire(import.meta.url),unwrap=require('../unwrap.js'),ics=require('../ics.js'),{inflateZlib}=require('../inflate-zlib.js');
const eml=(body='Call me',extra='')=>Buffer.from(`From: sender@example.invalid\r\nReply-To: reply@other.invalid\r\nTo: user@client.invalid\r\nSubject: Evidence\r\nReceived: by first.invalid\r\nReceived: by second.invalid\r\nX-Fold: first\r\n second\r\n${extra}Content-Type: text/plain; charset=utf-8\r\n\r\n${body}`);
test('preserves original hash, headers, duplicate order, folding, Reply-To and short body',async()=>{
  const raw=eml();const copy=Buffer.from(raw);const r=await parseEvidence(raw);
  assert.deepEqual(raw,copy);assert.equal(r.sha256,createHash('sha256').update(raw).digest('hex'));
  const m=r.messages[0];assert.equal(m.replyTo[0].address,'reply@other.invalid');assert.equal(m.text.trim(),'Call me');
  assert.deepEqual(m.headers.filter(h=>h.key==='received').map(h=>h.value),['by first.invalid','by second.invalid']);
  assert.ok(m.rawHeaders.includes('X-Fold: first\r\n second'));
});
test('multiple originals retain parentage and independent headers, no silent five-message cutoff',async()=>{
  const children=Array.from({length:7},(_,i)=>`--B\r\nContent-Type: message/rfc822\r\nContent-Disposition: attachment; filename="original${i}.eml"\r\n\r\n${eml('Original '+i)}`).join('\r\n');
  const raw=Buffer.from(`From: reporter@example.invalid\r\nTo: phishing@client.invalid\r\nContent-Type: multipart/mixed; boundary="B"\r\n\r\n${children}\r\n--B--\r\n`);
  const r=await parseEvidence(raw);assert.equal(r.messages.length,8);assert.ok(r.messages.slice(1).every(m=>m.parentId==='m1'));
  assert.match(targetNotice(r.messages[0]),/no determina/);assert.equal(r.messages[0].replyTo.length,0);assert.equal(r.messages[1].replyTo[0].address,'reply@other.invalid');
});
test('legacy charset and RFC2231 filenames are decoded',async()=>{
  const raw=Buffer.from('Subject: =?iso-8859-1?Q?Revisi=F3n?=\r\nContent-Type: multipart/mixed; boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain; charset=iso-8859-1\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nRevisi=F3n\r\n--b\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename*=utf-8\'\'factura%20uno.txt\r\nContent-Transfer-Encoding: base64\r\n\r\nYWJj\r\n--b--\r\n');
  const r=await parseEvidence(raw);assert.equal(r.messages[0].subject,'Revisión');assert.match(r.messages[0].text,/Revisión/);assert.equal(r.messages[0].attachments[0].filename,'factura uno.txt');
  assert.equal(r.messages[0].attachments[0].sha256,createHash('sha256').update('abc').digest('hex'));
});
test('MIME boundaries only delimit complete lines',async()=>{
  const raw=Buffer.from('Content-Type: multipart/mixed; boundary="B"\r\n\r\npreamble\r\n--B\r\nContent-Type: text/plain\r\n\r\nKeep --B in this text\r\n--B--\r\nepilogue');
  assert.match((await parseEvidence(raw)).messages[0].text,/Keep --B in this text/);
});
test('HTML and embedded scripts remain source, never executed by parser',async()=>{
  globalThis.__payloadExecuted=false;
  const raw=Buffer.from('Content-Type: text/html\r\n\r\n<script>globalThis.__payloadExecuted=true</script><img src="https://tracker.invalid/pixel">');
  const r=await parseEvidence(raw);assert.equal(globalThis.__payloadExecuted,false);assert.match(r.messages[0].html,/tracker.invalid/);
});
test('MSG and oversized raw input fail explicitly',async()=>{
  await assert.rejects(parseEvidence(eml(),'mail.msg'),/MSG/);
  await assert.rejects(parseEvidence(Uint8Array.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1])) ,/MSG/);
  await assert.rejects(parseEvidence(new Uint8Array(LIMITS.raw+1)),/25 MiB/);
});
test('deep MIME is rejected instead of overflowing stack',async()=>{
  let raw='Content-Type: text/plain\r\n\r\nend';
  for(let i=0;i<40;i++)raw=`Content-Type: multipart/mixed; boundary="b${i}"\r\n\r\n--b${i}\r\n${raw}\r\n--b${i}--\r\n`;
  await assert.rejects(parseEvidence(Buffer.from(raw)),/EMAXNESTINGDEPTH/);
});
test('nested message limit produces a visible coverage warning',async()=>{
  let raw=eml().toString();for(let i=0;i<10;i++)raw=`Content-Type: multipart/mixed; boundary="b${i}"\r\n\r\n--b${i}\r\nContent-Type: message/rfc822\r\n\r\n${raw}\r\n--b${i}--\r\n`;
  const r=await parseEvidence(Buffer.from(raw));assert.ok(r.warnings.some(w=>w.includes('omitido')));assert.equal(r.messages.length,9);
});
test('Safe Links preserves signed and nested URL escapes, plus and fragment',()=>{
  const target='https://target.invalid/a?q=%252F&b=x+y&sig=A%2FB#fragment';
  assert.equal(unwrap.unwrapOnce('https://nam01.safelinks.protection.outlook.com/?url='+encodeURIComponent(target)).url,target);
});
test('rejects fake provider in host/path/query/userinfo',()=>{
  for(const value of ['https://attacker.invalid/urldefense.com/v3/__https://target.invalid/__;!','https://evilurlprotect.trendmicro.com/?url=https%3A%2F%2Ftarget.invalid','https://google.attacker.invalid/url?q=https%3A%2F%2Ftarget.invalid','https://urldefense.com@attacker.invalid/v3/__https://target.invalid/__;!'])assert.equal(unwrap.unwrapStep(value,true).changed,false);
});
test('genuine Proofpoint v3 does not decode inner percent escapes',()=>{
  assert.equal(unwrap.unwrapOnce('https://urldefense.com/v3/__https://target.invalid/a?q=%252F__;!').url,'https://target.invalid/a?q=%252F');
});
test('genuine Trend Micro and Google extraction work',()=>{
  assert.equal(unwrap.unwrapStep('https://urlprotect.trendmicro.com/?url=https%3A%2F%2Ftarget.invalid',true).url,'https://target.invalid');
  assert.equal(unwrap.unwrapStep('https://www.google.com/url?q=https%3A%2F%2Ftarget.invalid',true).url,'https://target.invalid');
});
test('unwrap chains stop on cycles and limits',()=>{
  assert.equal(unwrapChain('a',v=>({changed:true,url:v==='a'?'b':'a'})).stopped,'cycle');
  assert.equal(unwrapChain('a',v=>({changed:true,url:v+'a'}),3).chain.length,3);
});
test('calendar preserves semicolon, parameters and attachment URLs',()=>{
  assert.deepEqual(ics.parseIcsUrls('URL:https://example.invalid/a;\r\nATTACH:https://example.invalid/file?token=one%252F#x'),['https://example.invalid/a;','https://example.invalid/file?token=one%252F#x']);
});
test('zlib decodes stored/fixed/dynamic blocks',()=>{
  for(const options of [{level:0},{strategy:constants.Z_FIXED},{level:9}]){
    const input=Buffer.from('https://example.invalid/path?q=abc&x=%252F'.repeat(150));
    assert.deepEqual(Buffer.from(inflateZlib(deflateSync(input,options))),input);
  }
});
test('zlib rejects expansion and corruption',()=>{
  assert.throws(()=>inflateZlib(deflateSync(Buffer.alloc(200000,65))),/limit/);
  const bytes=deflateSync(Buffer.from('hello'));bytes[bytes.length-1]^=255;assert.throws(()=>inflateZlib(bytes),/checksum/);
  assert.throws(()=>inflateZlib(new Uint8Array([0x78,0x9c,0,0,0,0])),/oob|block/);
});
test('decision route validation and simulation corroboration are mandatory',()=>{
  assert.throws(()=>validateDecision({category:'FIR',rationale:'To phishing'}),/subcategoría/);
  assert.throws(()=>validateDecision({category:'Simulation',rationale:'header'}),/corroboración/);
  assert.equal(validateDecision({category:'Malicious',route:'Response → BEC',rationale:'Observed response diversion and impersonation'}),true);
});
test('indicator extraction preserves exact tokens',()=>{
  const url='https://example.invalid/a;?token=x%252F#frag';assert.ok(collectTextIndicators(url,'body').some(i=>i.value===url));
});
test('indicator budgets are explicit rather than silently claiming complete coverage',()=>{
  const many=collectTextIndicators('https://x.invalid/ '.repeat(3000),'body');assert.equal(many.length,2000);assert.ok(many.warnings.length);
  const large=collectTextIndicators('x'.repeat(500001),'body');assert.match(large.warnings[0],/500000/);
});
test('packaged panel denies remote connections and has no legacy content scripts',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../manifest.json',import.meta.url),'utf8'));
  assert.deepEqual(manifest.permissions,['messagesRead']);assert.ok(!manifest.content_scripts);
  assert.match(manifest.content_security_policy,/connect-src 'none'/);assert.match(manifest.content_security_policy,/frame-src 'none'/);
  const ui=await readFile(new URL('../analysis.mjs',import.meta.url),'utf8');assert.ok(!ui.includes('window.open'));assert.ok(!ui.includes('.innerHTML'));
});
test('Thunderbird action opens a dedicated extension tab without injecting into mail',async()=>{
  const events={},opened=[];
  const messenger={runtime:{getURL:p=>'moz-extension://test/'+p},tabs:{create:async details=>opened.push(details)},
    messageDisplayAction:{onClicked:{addListener:f=>events.message=f}},browserAction:{onClicked:{addListener:f=>events.toolbar=f}}};
  vm.runInNewContext(await readFile(new URL('../background.js',import.meta.url),'utf8'),{messenger,URL});
  await events.message({id:123});assert.equal(opened[0].url,'moz-extension://test/analysis.html?sourceTab=123');
  await events.toolbar({});assert.equal(opened[1].url,'moz-extension://test/analysis.html');
});
