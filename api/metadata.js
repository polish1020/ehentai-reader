import {requireSession,sameOrigin} from '../lib/ex-session.mjs';
import {exMetadata,json,apiError} from '../lib/ehentai.mjs';

export async function POST(request) {
  try {
    sameOrigin(request);
    const session=requireSession(request);
    const {ids}=await request.json();
    return json(await exMetadata(ids,session.credentials));
  } catch (error) { return apiError(error); }
}
