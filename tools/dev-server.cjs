const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const policy=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8')).content_security_policy;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json'};
http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  console.log(req.method,pathname);
  const filename=path.resolve(root,'.'+decodeURIComponent(pathname==='/'?'/analysis.html':pathname));
  if(!filename.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  try{const data=fs.readFileSync(filename);res.writeHead(200,{'Content-Type':types[path.extname(filename)]||'application/octet-stream','Content-Security-Policy':policy});res.end(data);}
  catch{res.writeHead(404);res.end('Not found');}
}).listen(8766,'127.0.0.1',()=>console.log('PhishScoutSentinel preview http://127.0.0.1:8766'));
