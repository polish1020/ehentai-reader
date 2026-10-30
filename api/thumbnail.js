import {requireSession} from '../lib/ex-session.mjs';
import {exThumbnail,apiError} from '../lib/ehentai.mjs';

export async function GET(request) {
  try {
    const session=requireSession(request);
    const response=await exThumbnail(new URL(request.url).searchParams.get('src'),session.credentials);
    return new Response(response.body,{headers:{'Content-Type':response.headers.get('content-type'),'Cache-Control':'private, max-age=86400',Vary:'Cookie','Referrer-Policy':'no-referrer'}});
  } catch (error) { return apiError(error); }
}
