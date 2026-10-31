import {json,apiError} from '../lib/ehentai.mjs';
import {requestSource,sameOrigin} from '../lib/ex-session.mjs';
import {imageLinks} from '../lib/image-export.mjs';

export async function POST(request) {
  try {
    sameOrigin(request);
    if(!(request.headers.get('content-type')||'').startsWith('application/json'))throw Object.assign(new Error('请使用 JSON 请求'),{status:400});
    const text=await request.text();
    if(text.length>16_384)throw Object.assign(new Error('请求内容过大'),{status:400});
    let input;try{input=JSON.parse(text);}catch{throw Object.assign(new Error('请求内容不正确'),{status:400});}
    const context=requestSource(request);
    const response=json(await imageLinks(input,context,request.signal));
    response.headers.set('Cache-Control','private, no-store');
    if(context.source==='exhentai')response.headers.set('Vary','Cookie');
    return response;
  } catch(error) {return apiError(error);}
}
