import {json,apiError} from '../lib/ehentai.mjs';
import {requestSource,requireSession,sameOrigin} from '../lib/ex-session.mjs';
import {galleryInfo,accountTags,favoriteGroups,favoriteInfo,torrents,archive,updateTag,updateFavorite,galleryAction,imageSearch} from '../lib/source-features.mjs';

export async function GET(request) {
  try {
    const input=Object.fromEntries(new URL(request.url).searchParams),context=requestSource(request);
    if (['tags','favorite-groups','favorite-info','archive'].includes(input.action)) Object.assign(context,requireSession(request),{account:true});
    if (input.action==='details') return json(await galleryInfo(input,context));
    if (input.action==='tags') return json(await accountTags(input,context));
    if (input.action==='favorite-groups') return json(await favoriteGroups(context));
    if (input.action==='favorite-info') return json(await favoriteInfo(input,context));
    if (input.action==='torrents') return json(await torrents(input,context));
    if (input.action==='archive') return json(await archive(input,context));
    throw Object.assign(new Error('不支持的源站功能'),{status:400});
  } catch(error) { return apiError(error); }
}
export async function POST(request) {
  try {
    sameOrigin(request);
    const context=requestSource(request);
    if ((request.headers.get('content-type')||'').startsWith('multipart/form-data')) return json(await imageSearch(await request.formData(),context));
    const input=await request.json();Object.assign(context,requireSession(request),{account:true});
    if (input.action==='favorite') return json(await updateFavorite(input,context));
    if (input.action==='tag-preference') return json(await updateTag(input,context));
    if (input.action==='archive') return json(await archive(input,context,true));
    return json(await galleryAction(input,context));
  } catch(error) { return apiError(error); }
}
