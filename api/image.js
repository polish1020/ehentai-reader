import {resolveImage,resolveOriginalImage,apiError} from '../lib/ehentai.mjs';
import {requestSource,requireSession} from '../lib/ex-session.mjs';

export async function GET(request) {
  try {
    const params=new URL(request.url).searchParams;
    const context=requestSource(request);
    if(params.get('quality')==='original') {
      Object.assign(context,requireSession(request),{account:true});
      const src=await resolveOriginalImage(params.get('gid'),params.get('token'),params.get('page'),context);
      return Response.json({src},{headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}});
    }
    const image=await resolveImage(params.get('gid'),params.get('token'),params.get('page'),context);
    return new Response(null,{status:302,headers:{Location:image,'Cache-Control':'private, max-age=300','Referrer-Policy':'no-referrer',...(context.source === 'exhentai' ? {Vary:'Cookie'} : {})}});
  } catch (error) { return apiError(error); }
}
