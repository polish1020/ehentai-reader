import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {GET as galleries} from '../api/galleries.js';
import {GET as image} from '../api/image.js';
import * as exSession from '../api/ex-session.js';
import * as metadata from '../api/metadata.js';
import {GET as thumbnail} from '../api/thumbnail.js';
const root=resolve(process.argv[2] || 'public');
const routes={'/api/galleries':{GET:galleries},'/api/image':{GET:image},'/api/thumbnail':{GET:thumbnail},'/api/ex-session':exSession,'/api/metadata':metadata};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
export function createApp() {
  return createServer(async (req,res) => {
    try {
      const url=new URL(req.url,`http://${req.headers.host || 'localhost'}`);
      if (routes[url.pathname]) {
        const handler=routes[url.pathname][req.method];
        if (!handler) { res.writeHead(405,{Allow:Object.keys(routes[url.pathname]).join(', ')});res.end();return; }
        const chunks=[];for await (const chunk of req) chunks.push(chunk);
        const body=Buffer.concat(chunks);
        const response=await handler(new Request(url,{method:req.method,headers:req.headers,...(body.length ? {body} : {})}));
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
