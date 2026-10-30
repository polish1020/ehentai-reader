import {galleryThumbnails,json,apiError} from '../lib/ehentai.mjs';
import {requestSource} from '../lib/ex-session.mjs';

export async function GET(request) {
  try {
    const params=new URL(request.url).searchParams;
    return json(await galleryThumbnails(params.get('gid'),params.get('token'),Number(params.get('p') || 0),requestSource(request)));
  } catch (error) { return apiError(error); }
}
