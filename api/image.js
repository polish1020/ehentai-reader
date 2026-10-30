import {resolveImage,apiError} from '../lib/ehentai.mjs';

export async function GET(request) {
  try {
    const params=new URL(request.url).searchParams;
    const image=await resolveImage(params.get('gid'),params.get('token'),params.get('page'));
    return new Response(null,{status:302,headers:{Location:image,'Cache-Control':'private, max-age=300','Referrer-Policy':'no-referrer'}});
  } catch (error) { return apiError(error); }
}
