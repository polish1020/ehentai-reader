import {cleanCredentials,readSession,sessionCookie,clearSessionCookie,sameOrigin} from '../lib/ex-session.mjs';
import {verifyExSession,json,apiError} from '../lib/ehentai.mjs';

export function GET(request) {
  try {
    const fillForm=new URL(request.url).searchParams.get('credentials') === '1';
    if (fillForm) sameOrigin(request);
    const session=readSession(request);
    if (!session?.scope) return json({configured:false,scope:null});
    // Only the settings form requests credentials; routine status checks never expose them.
    const saved=sessionCookie(session.credentials,session.scope);
    return Response.json({configured:true,scope:saved.scope,...(fillForm ? {credentials:session.credentials} : {})},{headers:{'Cache-Control':'no-store','Vary':'Cookie','Set-Cookie':saved.cookie}});
  } catch (error) { return apiError(error); }
}
export async function POST(request) {
  try {
    sameOrigin(request);
    let input;
    try { input=await request.json(); } catch { throw Object.assign(new Error('无法读取凭证，请重新填写'),{status:400}); }
    const checked=await verifyExSession(cleanCredentials(input));
    const session=sessionCookie(checked.credentials);
    return Response.json({configured:true,scope:session.scope,refreshedIgneous:checked.refreshedIgneous},{headers:{'Cache-Control':'no-store','Set-Cookie':session.cookie}});
  } catch (error) { return apiError(error); }
}
export function DELETE(request) {
  try {
    sameOrigin(request);
    return Response.json({configured:false},{headers:{'Cache-Control':'no-store','Set-Cookie':clearSessionCookie()}});
  } catch (error) { return apiError(error); }
}
