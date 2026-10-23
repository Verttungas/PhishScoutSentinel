import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.resolve(process.argv[2]||path.join(root,'dist'));fs.mkdirSync(output,{recursive:true});
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const runtime=['manifest.json','background.js','analysis.html','analysis.css','analysis.mjs','core.mjs','dom-evidence.mjs','parse-worker.mjs','unwrap.js','inflate-zlib.js','ics.js','phones.js','LICENSE','README.md','THIRD_PARTY.md','CHANGELOG.md'];
function walk(dir){return fs.readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(ent=>ent.isDirectory()?walk(dir+'/'+ent.name):[dir+'/'+ent.name]);}
runtime.push(...walk('vendor').filter(name=>name.endsWith('.js')||name.endsWith('LICENSE.txt')||name.endsWith('package.json')));
const table=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function zip(files){const local=[],central=[];let offset=0;
  for(const filename of [...files].sort()){
    const name=Buffer.from(filename),raw=fs.readFileSync(path.join(root,filename)),data=deflateRawSync(raw,{level:9});
    const crc=crc32(raw),head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt16LE(0x800,6);head.writeUInt16LE(8,8);head.writeUInt16LE(33,12);head.writeUInt32LE(crc,14);head.writeUInt32LE(data.length,18);head.writeUInt32LE(raw.length,22);head.writeUInt16LE(name.length,26);
    local.push(head,name,data);const dir=Buffer.alloc(46);dir.writeUInt32LE(0x02014b50);dir.writeUInt16LE(20,4);dir.writeUInt16LE(20,6);dir.writeUInt16LE(0x800,8);dir.writeUInt16LE(8,10);dir.writeUInt16LE(33,14);dir.writeUInt32LE(crc,16);dir.writeUInt32LE(data.length,20);dir.writeUInt32LE(raw.length,24);dir.writeUInt16LE(name.length,28);dir.writeUInt32LE(offset,42);central.push(dir,name);offset+=head.length+name.length+data.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end]);
}
const xpi=`PhishScoutSentinel-${manifest.version}.xpi`;
const sourceFiles=fs.readdirSync(root,{withFileTypes:true}).flatMap(ent=>ent.isDirectory()?['vendor','tools','tests'].includes(ent.name)?walk(ent.name):[]:[ent.name]).filter(name=>!name.startsWith('.git'));
const artifacts=[[xpi,zip(runtime)],[`PhishScoutSentinel-${manifest.version}-source.zip`,zip(sourceFiles)]];
for(const [name,bytes]of artifacts)fs.writeFileSync(path.join(output,name),bytes);
fs.writeFileSync(path.join(output,'SHA256SUMS.txt'),artifacts.map(([name,bytes])=>`${createHash('sha256').update(bytes).digest('hex')}  ${name}`).join('\n')+'\n');
console.log(JSON.stringify({output,artifacts:artifacts.map(([name,bytes])=>({name,bytes:bytes.length})),runtimeFiles:runtime.length},null,2));
