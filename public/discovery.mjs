export async function discoveryPage({load,append=false,cursor=null,categories,seen=[]}) {
  const visible=page=>page.galleries.filter(gallery=>categories.includes(gallery.category));
  let fallback;
  if (!append) {
    try {
      const page=await load('popular',null),galleries=visible(page);
      if (galleries.length) return {galleries,next:null,continuation:true,popularIds:galleries.map(gallery=>gallery.id),latest:false,fallback:null};
      fallback='empty';
    } catch (error) {
      if ([401,403].includes(error.status) || error.name === 'AbortError') throw error;
      fallback='unavailable';
    }
  }
  const known=new Set(seen);
  // Skip pages containing only already shown popular entries, with bounded requests.
  for (let attempt=0;attempt<3;attempt++) {
    const page=await load('latest',cursor);
    const galleries=visible(page).filter(gallery=>{
      if (known.has(gallery.id)) return false;
      known.add(gallery.id);return true;
    });
    const next=page.next && page.next !== cursor ? page.next : null;
    if (galleries.length || !next || attempt===2) return {galleries,next,continuation:false,latest:true,...(!append ? {popularIds:[],fallback} : {})};
    cursor=next;
  }
}
