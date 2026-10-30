import {listGalleries,json,apiError} from '../lib/ehentai.mjs';
import {requestSource,requireSession} from '../lib/ex-session.mjs';

export async function GET(request) {
  try {
    const params=new URL(request.url).searchParams;
    const feed=params.get('feed') || 'latest',context=requestSource(request);
    if (['watched','favorites'].includes(feed)) Object.assign(context,requireSession(request),{account:true});
    const filters=Object.fromEntries(['f_srdd','f_spf','f_spt','f_sto','f_sh','f_shash','fs_similar','fs_covers','fs_exp','favcat'].filter(name=>params.has(name)).map(name=>[name,params.get(name)]));
    return json(await listGalleries({query:params.get('q') || '',next:params.get('next') || '',excludedCategories:params.get('f_cats') || '',feed,filters,...context}));
  } catch (error) { return apiError(error); }
}
