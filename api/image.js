import {resolveImage,apiError} from '../lib/ehentai.mjs';
import {requestSource} from '../lib/ex-session.mjs';

export async function GET(request) {
  try {
    const params=new URL(request.url).searchParams;
    const context=requestSource(request);
    const image=await resolveImage(params.get('gid'),params.get('token'),params.get('page'),context);
    return new Response(null,{status:302,headers:{Location:image,'Cache-Control':'private, max-age=300','Referrer-Policy':'no-referrer',...(context.source === 'exhentai' ? {Vary:'Cookie'} : {})}});
  } catch (error) { return apiError(error); }
}
