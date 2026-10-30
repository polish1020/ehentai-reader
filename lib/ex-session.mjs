import {randomUUID} from 'node:crypto';

const cookieName='__Secure-yijing-ex';
const fields=['ipb_member_id','ipb_pass_hash','ipb_session_id','igneous'];
export function authError(message='请先在阅读偏好中验证 ExHentai 凭证') {
  return Object.assign(new Error(message),{status:401});
}
export function cleanCredentials(input) {
  const result={};
  for (const field of fields) {
    const value=String(input?.[field] || '').trim();
    if (value && !/^[a-zA-Z0-9_-]{1,256}$/.test(value)) throw authError('凭证格式不正确，请只填写 Cookie 的值');
    if (value) result[field]=value;
  }
  if (!result.ipb_member_id || !result.ipb_pass_hash || !result.ipb_session_id) throw authError('请填写会员 ID、密码哈希和会话 ID');
  return result;
}
export const credentialCookie=credentials => fields.filter(field => credentials[field]).map(field => `${field}=${credentials[field]}`).join('; ');
export function readSession(request) {
  try {
    const value=(request.headers.get('cookie') || '').split(';').map(pair => pair.trim()).find(pair => pair.startsWith(cookieName+'='))?.slice(cookieName.length+1);
    if (!value || value.length > 4096) return null;
    const session=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));
    return {credentials:cleanCredentials(session.credentials),scope:session.scope};
  } catch { return null; }
}
export function requireSession(request) {
  const session=readSession(request);
  if (!session?.scope) throw authError();
  return session;
}
export function sessionCookie(credentials) {
  const scope=randomUUID();
  const value=Buffer.from(JSON.stringify({credentials,scope})).toString('base64url');
  return {scope,cookie:`${cookieName}=${value}; Path=/api; HttpOnly; Secure; SameSite=Strict`};
}
export const clearSessionCookie=()=>`${cookieName}=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
export function sameOrigin(request) {
  const origin=request.headers.get('origin');
  if (request.headers.get('sec-fetch-site') === 'cross-site' || origin && origin !== new URL(request.url).origin) throw Object.assign(new Error('不允许跨站修改凭证'),{status:403});
}
export function requestSource(request) {
  if (new URL(request.url).searchParams.get('source') !== 'exhentai') return {source:'e-hentai'};
  return {source:'exhentai',...requireSession(request)};
}
