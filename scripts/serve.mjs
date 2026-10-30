import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root = resolve(process.argv[2] || 'public');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.jpg':'image/jpeg','.webp':'image/webp'};
createServer(async (req,res) => {
  try {
    const url = new URL(req.url,'http://localhost'); const path = resolve(root,'.'+decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(root+'/') || !(await stat(path)).isFile()) throw Error();
    res.writeHead(200,{'Content-Type':extname(path)==='.mjs' ? 'text/javascript; charset=utf-8' : types[extname(path)] || 'application/octet-stream','Cache-Control':'no-cache'}); res.end(await readFile(path));
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(3000,'0.0.0.0',() => console.log('Reader available on http://localhost:3000'));
