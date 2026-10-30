const storageKey='yijing-navigation-v1';

export class ListStore {
  constructor(storage) {
    this.storage=storage;
    this.lists=new Map();
    this.tabs={};
    try {
      const saved=JSON.parse(storage?.getItem(storageKey));
      if (saved?.version === 1) {
        this.tabs=saved.tabs || {};
        for (const list of saved.lists) {
          list.source ||= 'e-hentai';
          if (list.view === 'discover' && list.discoveryVersion !== 1) {
            Object.assign(list,{sort:'source',discoveryVersion:1,galleries:[],nextCursor:null,initialized:false,isLoading:false,pendingAppend:false,scrollY:0});
          }
          this.lists.set(list.key,list);
        }
      }
    } catch { /* Browsing continues when session storage is unavailable. */ }
  }
  create(view='discover',query='',source='e-hentai') {
    const list={key:crypto.randomUUID(),view,query,source,sort:view === 'discover' ? 'source' : 'newest',discoveryVersion:1,listMode:false,galleries:[],nextCursor:null,isLoading:false,listError:'',scrollY:0,initialized:false,categoryKey:null,pendingAppend:false};
    this.lists.set(list.key,list);
    return list;
  }
  activate(list) { this.tabs[`${list.source}:${list.view}`]=list.key; }
  tab(view,source='e-hentai') {
    const list=this.lists.get(this.tabs[`${source}:${view}`] || this.tabs[view]);
    return list?.source === source ? list : undefined;
  }
  removeSource(source) {
    for (const [key,list] of this.lists) {
      if (list.source === source) this.lists.delete(key);
      else list.galleries=list.galleries.filter(gallery => gallery.source !== source);
    }
    for (const key of Object.keys(this.tabs)) if (!this.lists.has(this.tabs[key])) delete this.tabs[key];
    this.save();
  }
  save() {
    try {
      const lists=[...this.lists.values()].map(({requestId,pendingRequest,...list}) => ({
        ...list,galleries:list.galleries.map(({pages,...gallery}) => gallery)
      }));
      this.storage?.setItem(storageKey,JSON.stringify({version:1,tabs:this.tabs,lists}));
    } catch { /* A full/disabled session store does not discard in-memory lists. */ }
  }
}
