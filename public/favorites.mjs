import {galleryReference} from './source.mjs';

export class Favorites {
  constructor({state,save,getScope,ensureScope,request,onChange=()=>{}}) {
    Object.assign(this,{state,save,getScope,ensureScope,request,onChange});
    state.favorites=[...new Set(Array.isArray(state.favorites)?state.favorites:[])];
    for(const key of ['favoriteMeta','favoritePending'])if(!state[key]||typeof state[key]!=='object'||Array.isArray(state[key]))state[key]={};
    this.pending=new Map();this.remoteEntries=new Map();this.scope=null;
    for(const id of Object.keys(state.favoriteMeta)){if(!state.favorites.includes(id))delete state.favoriteMeta[id];else delete state.favoriteMeta[id].scope;}
  }
  remoteCache() {
    const scope=this.getScope();
    if(scope!==this.scope){this.remoteEntries.clear();this.scope=scope;}
    return this.remoteEntries;
  }
  meta(id) {return this.state.favoriteMeta[id]||this.remoteCache().get(id)||{};}
  remote(id) {return !!this.getScope()&&this.remoteCache().has(id);}
  forgetLocal(id) {this.state.favorites=this.state.favorites.filter(value=>value!==id);delete this.state.favoriteMeta[id];delete this.state.favoritePending[id];}
  hidden(id) {const op=this.state.favoritePending[id];return !!op?.remove&&(!op.scope||op.scope===this.getScope());}
  has(id) {return !this.hidden(id)&&(this.state.favorites.includes(id)||this.remote(id));}
  localOnly(id) {return this.has(id)&&!this.remote(id);}
  busy(id) {return this.pending.has(id);}
  remember(gallery) {
    if(!gallery?.id||!this.state.favorites.includes(gallery.id))return;
    const {pages,...snapshot}=gallery;
    const {scope,...local}=this.state.favoriteMeta[gallery.id]||{};
    this.state.favoriteMeta[gallery.id]={...local,gallery:snapshot};
  }
  galleries(source) {
    return [...new Map([...this.remoteCache(),...Object.entries(this.state.favoriteMeta)])].filter(([id,meta])=>meta.gallery?.source===source&&this.has(id)).map(([,meta])=>meta.gallery);
  }
  ids(source) {return [...new Set([...this.state.favorites,...this.remoteCache().keys()])].filter(id=>galleryReference(id).source===source&&this.has(id));}
  changed() {this.save();this.onChange();}
  ingest(galleries,scope) {
    if(!scope||scope!==this.getScope())return;
    for(const gallery of galleries){const {pages,...snapshot}=gallery;this.remoteCache().set(gallery.id,{gallery:snapshot});if(!this.busy(gallery.id)&&!this.hidden(gallery.id))this.forgetLocal(gallery.id);}
    this.changed();
  }
  resetRemote(source) {for(const [id,meta] of this.remoteCache())if(meta.gallery?.source===source)this.remoteEntries.delete(id);}
  info(id) {const meta=this.meta(id);return {group:meta.group??0,note:meta.note||''};}
  confirm(gallery,info,scope) {
    if(!scope||scope!==this.getScope()||!Number.isInteger(info.group))return;
    const {pages,...snapshot}=gallery;this.remoteCache().set(gallery.id,{gallery:snapshot,group:info.group,note:info.note||''});if(!this.busy(gallery.id)&&!this.hidden(gallery.id))this.forgetLocal(gallery.id);this.changed();
  }
  set(gallery,{remove=false,group,note}={}) {
    const id=gallery.id;
    if(this.pending.has(id))return this.pending.get(id);
    const current=this.info(id);
    this.state.favorites=remove?this.state.favorites.filter(value=>value!==id):[...new Set([...this.state.favorites,id])];
    this.remember(gallery);if(remove)delete this.state.favoriteMeta[id];
    const op={remove,group:group??current.group,note:note??current.note,explicit:group!==undefined||note!==undefined||!!this.state.favoritePending[id]?.explicit,scope:this.getScope()||null};
    if(!remove)Object.assign(this.state.favoriteMeta[id],{group:op.group,note:op.note});
    this.state.favoritePending[id]=op;
    // Register the operation before notifying the view so all matching buttons lock.
    const task=Promise.resolve().then(()=>this.sync(id,op)).finally(()=>{this.pending.delete(id);this.changed();});
    this.pending.set(id,task);this.changed();return task;
  }
  async sync(id,op) {
    try {
      const scope=await this.ensureScope();
      if(!scope)throw new Error('未登录源站');
      if(op.scope&&op.scope!==scope)throw new Error('账号已切换，请重新操作');
      op.scope=scope;this.save();
      const ref=galleryReference(id),input={source:ref.source,gid:ref.gid,token:ref.token};
      if(!op.remove&&!op.explicit){
        const info=await this.request('/api/source?'+new URLSearchParams({action:'favorite-info',...input}));
        if(scope!==this.getScope()){if(Number.isInteger(info.group)){this.forgetLocal(id);return {synced:true,remove:false};}throw new Error('账号已切换，请重新操作');}
        if(Number.isInteger(info.group)){op.group=info.group;op.note=info.note||'';op.existing=true;}
      }
      if(!op.existing)await this.request('/api/source?'+new URLSearchParams({source:ref.source}),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'favorite',...input,remove:op.remove,group:op.group,note:op.note})});
      if(scope===this.getScope()){
        if(op.remove)this.remoteCache().delete(id);
        else {const gallery=this.state.favoriteMeta[id]?.gallery;this.remoteCache().set(id,{gallery,group:op.group,note:op.note});}
      }
      this.forgetLocal(id);
      return {synced:true,remove:op.remove};
    }catch(error){const remoteSaved=!op.remove&&this.remote(id);if(remoteSaved)this.forgetLocal(id);return {synced:false,remove:op.remove,remoteSaved,error:error.message||'网络请求失败'};}
  }
}

export function favoriteMatches(gallery,query='') {
  const values=[gallery.title,gallery.description,gallery.creator,...(gallery.tags||[])].map(value=>String(value).toLowerCase());
  const tokens=query.match(/-?(?:[\w-]+:)?"[^"]*"|\S+/g)||[];
  return tokens.every(token=>{
    const excluded=token.startsWith('-');if(excluded)token=token.slice(1);
    token=token.toLowerCase().replace(/"/g,'');
    const exact=token.endsWith('$');if(exact)token=token.slice(0,-1);
    const match=token.startsWith('uploader:')?String(gallery.creator||'').toLowerCase()===token.slice(9):values.some(value=>exact?value===token:value.includes(token));
    return excluded?!match:match;
  });
}
