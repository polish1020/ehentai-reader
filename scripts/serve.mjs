import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {GET as galleries} from '../api/galleries.js';
import {GET as image} from '../api/image.js';
const root=resolve(process.argv[2] || 'public');
const routes={'/api/galleries':galleries,'/api/image':image};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
export function createApp() {
  return createServer(async (req,res) => {
    try {
      const url=new URL(req.url,'http://localhost');
      if (routes[url.pathname]) {
        if (req.method !== 'GET') { res.writeHead(405,{Allow:'GET'});res.end();return; }
        const response=await routes[url.pathname](new Request(url));
        res.writeHead(response.status,Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));return;
      }
      const path=resolve(root,'.'+decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!path.startsWith(root+'/') || !(await stat(path)).isFile()) { res.writeHead(404);res.end('Not found');return; }
      res.writeHead(200,{'Content-Type':types[extname(path)] || 'application/octet-stream','Cache-Control':'no-cache'});
      res.end(await readFile(path));
    } catch { res.writeHead(404);res.end('Not found'); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  createApp().listen(3000,'0.0.0.0',() => console.log('Reader available on http://localhost:3000'));
}
