import {listGalleries,json,apiError} from '../lib/ehentai.mjs';

export async function GET(request) {
  try {
    const params=new URL(request.url).searchParams;
    return json(await listGalleries({query:params.get('q') || '',next:params.get('next') || '',excludedCategories:params.get('f_cats') || ''}));
  } catch (error) { return apiError(error); }
}
