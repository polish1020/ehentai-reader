"""Download one candidate cosplay gallery into private staging for full visual review.
No download is ever copied to the public directory by this command.
"""
import sys, re, json, time, hashlib, html, subprocess
from pathlib import Path
from urllib.request import Request, urlopen, HTTPRedirectHandler, build_opener
from urllib.parse import urlparse
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parents[1]
POLICY = json.loads(subprocess.run(['node', str(ROOT/'scripts/check-policy.mjs')], check=True, capture_output=True, text=True).stdout)
def check_content(metadata, gid, count):
    gallery={'id':f'eh-{gid}', 'category':metadata.get('category','').lower(), 'source':'e-hentai', 'title':metadata.get('title',''), 'creator':metadata.get('uploader',''), 'description':'', 'tags':metadata.get('tags',[]), 'pageCount':count}
    result=subprocess.run(['node',str(ROOT/'scripts/check-policy.mjs'),'stage'], input=json.dumps({'gallery':gallery,'policy':POLICY}),capture_output=True,text=True)
    if result.returncode: raise ValueError('Candidate rejected by content-policy.json: '+result.stderr.strip())
def allowed(url):
    p = urlparse(url)
    if p.scheme != 'https' or p.username or p.password: return False
    for rule in POLICY['network']['hosts']:
        host=rule['hostname']
        if p.hostname == host or (rule['includeSubdomains'] and (p.hostname or '').endswith('.'+host)):
            if rule['ports']=='any' or (p.port or 443) in rule['ports']: return True
    return False
class Redirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not allowed(newurl): raise ValueError('Redirect outside supported source hosts')
        return super().redirect_request(req,fp,code,msg,headers,newurl)
opener = build_opener(Redirect)
def fetch(url, data=None, image=False):
    if not allowed(url): raise ValueError('Unsupported source host')
    req = Request(url,data=data,headers={'User-Agent':'YijingReader/0.1 (curated non-explicit cosplay)','Content-Type':'application/json'} if data else {'User-Agent':'YijingReader/0.1 (curated non-explicit cosplay)'})
    with opener.open(req,timeout=POLICY['network']['timeoutSeconds']) as r:
        if image and r.headers.get_content_type() not in POLICY['assets']['mimeExtensions']: raise ValueError('Unexpected image content type')
        limit=min(POLICY['network']['maxResponseBytes'],POLICY['assets']['maxImageBytes']) if image else POLICY['network']['maxResponseBytes']
        body=r.read(limit+1)
        if len(body)>limit: raise ValueError('Response exceeds content policy byte limit')
        return body,r.headers.get_content_type()
class Links(HTMLParser):
    def __init__(self): super().__init__();self.links=[];self.image=None
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='a' and re.fullmatch(r'https://e-hentai.org/s/[a-f0-9]+/\d+-\d+',a.get('href','')): self.links.append(a['href'])
        if tag=='img' and a.get('id')=='img': self.image=a.get('src')
def parse(data):
    p=Links();p.feed(data.decode('utf8'));return p
def main():
    if len(sys.argv)!=2 or not re.fullmatch(r'https://e-hentai.org/g/\d+/[a-f0-9]+/',sys.argv[1]): raise ValueError('Usage: npm run stage -- https://e-hentai.org/g/ID/TOKEN/')
    url=sys.argv[1];gid,token=url.split('/')[4:6]
    data,_=fetch('https://e-hentai.org/api.php',json.dumps({'method':'gdata','gidlist':[[int(gid),token]],'namespace':1}).encode())
    metadata=json.loads(data)['gmetadata'][0]
    count=int(metadata.get('filecount',0))
    check_content(metadata,gid,count)
    directory=ROOT/'staging'/f'eh-{gid}'
    if directory.exists(): raise ValueError('Candidate already exists; review it or remove it explicitly before restaging')
    directory.mkdir(parents=True)
    (directory/'metadata.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2))
    links=[];page=0
    while len(links)<count:
        time.sleep(POLICY['network']['requestIntervalSeconds'])
        data,_=fetch(url+f'?p={page}');new=parse(data).links
        before=len(links);links=list(dict.fromkeys(links+new))
        if len(links)==before: raise ValueError('Gallery pagination incomplete or source blocked; nothing approved')
        page+=1
    links.sort(key=lambda s:int(s.rsplit('-',1)[1]));links=links[:count]
    pages=[]
    for index,link in enumerate(links):
        time.sleep(POLICY['network']['requestIntervalSeconds']);data,_=fetch(link);image=parse(data).image
        if not image: raise ValueError('Source image missing or source blocked')
        data,mime=fetch(image,image=True)
        suffix=POLICY['assets']['mimeExtensions'][mime]
        if suffix not in POLICY['assets']['extensionsBySource']['e-hentai']: raise ValueError('Image format blocked by content policy')
        name=f'{index+1:04}.{suffix}';(directory/name).write_bytes(data)
        pages.append({'file':name,'sha256':hashlib.sha256(data).hexdigest()})
        print(f'Staged page {index+1}/{count}',flush=True)
    candidate={'id':f'eh-{gid}','title':metadata.get('title',''),'creator':metadata.get('uploader','Unknown'),'description':'','date':time.strftime('%Y-%m-%d'),'tags':metadata.get('tags',[]),'category':metadata.get('category','').lower(),'source':'e-hentai','sourceUrl':url,'review':{'status':'pending','reviewer':'','reviewedAt':'','allPagesReviewed':False},'pages':pages}
    (directory/'candidate.json').write_text(json.dumps(candidate,ensure_ascii=False,indent=2))
    cards=''.join(f'<section><h2>Page {i+1}</h2><img src="{p["file"]}" style="max-width:95vw;max-height:95vh"></section>' for i,p in enumerate(pages))
    (directory/'review.html').write_text('<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Private full-gallery review</title><h1>'+html.escape(candidate['title'])+'</h1><p>Inspect EVERY image at full resolution. Confirm non-explicit cosplay in candidate.json before approval.</p>'+cards)
    print(f'Pending review only. Open {directory}/review.html and inspect every page. No content has been published.')
if __name__=='__main__':
    try: main()
    except Exception as e: print(f'Staging stopped: {e}',file=sys.stderr);sys.exit(1)
