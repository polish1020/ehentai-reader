import {listGalleries,json,apiError} from '../lib/ehentai.mjs';
import {requestSource} from '../lib/ex-session.mjs';

export async function GET(request) {
  try {
    const params=new URL(request.url).searchParams;
    return json(await listGalleries({query:params.get('q') || '',next:params.get('next') || '',excludedCategories:params.get('f_cats') || '',...requestSource(request)}));
  } catch (error) { return apiError(error); }
}
