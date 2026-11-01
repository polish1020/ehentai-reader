import {icon} from './icons.mjs';
import {feeds,feedFor} from './source-options.mjs';
import {ManifestExport,exportLimit,exportRange} from './download-manifest.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const field=(name,label,value='',type='text',extra='')=>`<label class="feature-field">${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const button=(action,label,extra='')=>`<button type="button" class="outline-button" data-feature="${action}" ${extra}>${label}</button>`;
export class SourceFeatures {
  constructor(callbacks) {
    Object.assign(this,callbacks);this.groups=[];this.tags={tags:[],sets:[]};this.sequence=0;
    this.dialog=document.createElement('dialog');this.dialog.className='feature-dialog';document.body.append(this.dialog);
    this.dialog.addEventListener('close',()=>{this.clearImageExport();this.sequence++;this.dialog.replaceChildren();});
    document.addEventListener('click',event=>{
      const target=event.target.closest('[data-feature]');if(!target)return;
      event.preventDefault();this.handle(target.dataset.feature,target).catch(error=>this.error(error));
    });
    document.addEventListener('submit',event=>{
      const form=event.target.closest('[data-feature-form]');if(!form)return;
      event.preventDefault();this.submit(form,event.submitter).catch(error=>this.error(error));
    });
    document.addEventListener('change',event=>{
      if(event.target.matches('[data-feature-select="tag-set"]'))this.openTags(Number(event.target.value)).catch(error=>this.error(error));
    });
  }
  controls(list) {
    const advanced=list.filters||{};
    const tabs=list.view==='discover'?`<nav class="feed-tabs" aria-label="发现内容"><div role="tablist">${feeds.map(([id,label])=>`<button role="tab" aria-selected="${feedFor(list)===id}" data-feature="feed" data-feed="${id}">${label}</button>`).join('')}</div></nav>`:'';
    return tabs;
  }
  tools(list,content,categoryFiltered=false) {
    const advanced=list.filters||{};
    const active=categoryFiltered||Object.entries(advanced).some(([key,value])=>key!=='favcat'&&value);
    return `<details class="advanced-tools"><summary aria-label="筛选与列表选项">${icon('filter')}<span>筛选</span>${active?'<small>已启用</small>':''}</summary><div class="list-tools-panel">${content}<div class="source-tools">${button('advanced',`${icon('filter')}高级搜索`)}${button('image-search',`${icon('image')}以图搜图`)}${button('tags',`${icon('tag')}标签偏好`)}</div>${advanced.f_shash?`<p class="feature-note">正在显示图片搜索结果 ${button('clear-image','退出以图搜图')}</p>`:''}<div class="suggested-tags"><span>快捷标签</span><div id="tag-filters" class="chips"></div></div></div></details>`;
  }
  mountGallery(gallery,root) {
    this.gallery=gallery;
    root.querySelector('.album-header-actions').innerHTML=`<button type="button" class="album-header-button" data-feature="community" aria-label="评分与评论">${icon('comment')}评论</button><details class="album-menu"><summary aria-label="更多图册操作" title="更多操作">${icon('more')}</summary><div class="album-menu-panel"><button type="button" data-feature="downloads">${icon('download')}下载</button><button type="button" data-feature="gallery-tags">${icon('tag')}标签操作</button><button type="button" data-action="copy-gallery-link">${icon('copy')}复制图册链接</button><button type="button" data-action="gallery-debug">${icon('info')}查看调试信息</button></div></details>`;
  }
  modal(title,body) {
    this.clearImageExport();
    this.sequence++;
    this.dialog.innerHTML=`<div class="dialog-header"><h2>${esc(title)}</h2><button type="button" class="icon-button" data-feature="close" aria-label="关闭">${icon('close')}</button></div><div class="feature-body">${body}<p class="feature-status" role="status"></p></div>`;
    if(!this.dialog.open)this.dialog.showModal();this.dialog.scrollTop=0;
    return this.sequence;
  }
  status(message) {const node=this.dialog.querySelector('.feature-status');if(node)node.textContent=message;}
  cancel() {this.sequence++;if(this.dialog.open)this.dialog.close();}
  error(error) {this.status(error.message);this.toast(error.message);}
  params(action,gallery=this.gallery,extra={}) {return {action,source:gallery?.source||this.getList().source,...(gallery?{gid:gallery.gid,token:gallery.token}:{}),...extra};}
  get(action,gallery,extra) {return this.request('/api/source?'+new URLSearchParams(this.params(action,gallery,extra)));}
  post(action,data={},gallery=this.gallery) {return this.request('/api/source?'+new URLSearchParams({source:gallery?.source||this.getList().source}),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...this.params(action,gallery),...data})});}
  async account() {if(!await this.ensureAccount())throw new Error('请先在阅读偏好最底部验证账号凭证');}
  clearPrivate() {this.groups=[];this.tags={tags:[],sets:[]};this.tagSynced=false;if(this.dialog.open)this.dialog.close();}
  async handle(action,target) {
    if(action==='close')return this.dialog.close();
    if(action==='search')return this.onOpenSearch();
    if(action==='feed'){
      const intent=++this.sequence;
      if(target.dataset.feed==='watched'){
        await this.account();if(intent!==this.sequence)return;
        if(!this.tagSynced){const result=await this.get('tags',null);if(intent!==this.sequence)return;this.tags=result;this.onPreferences(result.tags);this.tagSynced=true;}
      }
      return this.onFeed(target.dataset.feed);
    }
    if(action==='advanced')return this.openAdvanced();
    if(action==='advanced-clear'){const form=target.closest('form');for(const input of form.querySelectorAll('input,select')){if(input.name==='query')continue;if(input.type==='checkbox')input.checked=false;else input.value='';}return;}
    if(action==='image-search')return this.openImageSearch();
    if(action==='clear-image') {const filters={...this.getList().filters};delete filters.f_shash;return this.onSearch('',filters);}
    if(action==='tags')return this.openTags();
    if(action==='tag-edit') {
      const tag=this.tags.tags.find(tag=>String(tag.id)===target.dataset.id),form=this.dialog.querySelector('form');
      for(const input of form.querySelectorAll('[name]'))if(input.type==='checkbox')input.checked=!!tag[input.name];else input.value=tag[input.name]??'';
      form.scrollIntoView({block:'nearest'});return;
    }
    if(action==='tag-delete') {
      const tag=this.tags.tags.find(tag=>String(tag.id)===target.dataset.id),sequence=this.sequence,scope=this.getScope();target.disabled=true;
      try{await this.post('tag-preference',{...tag,set:this.tagSet,remove:true},null);if(!this.dialog.open||sequence!==this.sequence||scope!==this.getScope())return;await this.openTags(this.tagSet);this.toast('已删除标签偏好');}finally{target.disabled=false;}
      return;
    }
    if(action==='community')return this.openCommunity();
    if(action==='gallery-favorite')return this.openFavorite();
    if(action==='gallery-tags')return this.openGalleryTags();
    if(action==='downloads')return this.openDownloads();
    if(action==='image-list')return this.openImageList();
    if(action==='image-list-cancel'){this.imageExport?.cancel();return;}
    if(action==='image-list-fresh')return this.generateImageList(this.dialog.querySelector('form'),true);
    if(action==='image-list-share')return this.shareImageList();
    if(action==='archive-options')return this.openArchive();
    if(action==='archive-check')return this.openArchive();
    if(action==='archive-prepare') {
      const sequence=this.sequence,scope=this.getScope();target.disabled=true;
      try{const result=await this.post('archive',{kind:target.dataset.kind});if(this.dialog.open&&sequence===this.sequence&&scope===this.getScope())this.renderArchive(result);}
      finally{target.disabled=false;}return;
    }
    if(action==='comment-vote'){
      await this.account();const sequence=this.sequence,scope=this.getScope();target.disabled=true;
      try{const result=await this.post('comment-vote',{commentId:target.dataset.id,vote:Number(target.dataset.vote)});if(!this.dialog.open||sequence!==this.sequence||scope!==this.getScope())return;target.closest('.comment-actions').querySelector('.comment-score').textContent=String(result.score??'已投票');this.status('评论投票已保存');}
      finally{target.disabled=false;}return;
    }
  }
  openAdvanced() {
    const list=this.getList(),f=list.filters||{};
    this.modal('高级搜索',`<form data-feature-form="advanced" class="feature-form">${field('query','关键词或搜索语法',list.query)}${field('artist','作者标签',f.artist)}${field('uploader','上传者',f.uploader)}${field('language','语言标签',f.language,'text','placeholder="chinese / english / japanese"')}${field('exclude','排除标签（逗号分隔）',f.exclude)}<label class="feature-field">最低评分<select name="f_srdd">${[['','不限'],[2,'2 星'],[3,'3 星'],[4,'4 星'],[5,'5 星']].map(([value,label])=>`<option value="${value}" ${String(f.f_srdd||'')===String(value)?'selected':''}>${label}</option>`).join('')}</select></label><div class="feature-columns">${field('f_spf','最少页数',f.f_spf,'number','min="1" max="9999"')}${field('f_spt','最多页数',f.f_spt,'number','min="1" max="9999"')}</div><label><input name="f_sto" type="checkbox" ${f.f_sto?'checked':''}> 只看有种子的图集</label><label><input name="f_sh" type="checkbox" ${f.f_sh?'checked':''}> 包含已下架图集</label><div class="source-actions"><button class="primary-button" type="submit">应用搜索</button><button class="outline-button" type="button" data-feature="advanced-clear">清空筛选</button></div></form>`);
  }
  openImageSearch() {
    this.modal('以图搜图',`<form data-feature-form="image" class="feature-form"><label class="feature-field">选择图片<input name="file" type="file" accept="image/*" required></label><label><input name="similar" type="checkbox" checked> 查找相似图片</label><label><input name="covers" type="checkbox"> 只搜索图集封面</label><p class="feature-note">相似搜索最多 3 MB；精确搜索可使用更大的图片。</p><button class="primary-button" type="submit">搜索图片</button></form>`);
  }
  async openTags(set=1) {
    const intent=++this.sequence;await this.account();if(intent!==this.sequence)return;this.tagSet=set;
    const sequence=this.modal('标签偏好','<p class="loading">正在读取标签…</p>');
    const result=await this.get('tags',null,{set});if(sequence!==this.sequence)return;
    this.tags=result;this.onPreferences(result.tags);this.tagSynced=true;
    this.modal('标签偏好',`<label class="feature-field">标签集<select data-feature-select="tag-set">${(result.sets.length?result.sets:[{id:1,name:'默认标签集'}]).map(item=>`<option value="${item.id}" ${item.id===set?'selected':''}>${esc(item.name)}</option>`).join('')}</select></label><form data-feature-form="tag" class="feature-form"><input type="hidden" name="id">${field('tag','完整标签','','text','placeholder="artist:作者名 / language:chinese" required') }<div class="feature-columns">${field('weight','权重',10,'number','min="-99" max="99"')}${field('color','高亮颜色','','text','placeholder="RRGGBB（选填）" pattern="#?[a-fA-F0-9]{6}"')}</div><div class="feature-columns"><label><input name="watch" type="checkbox" checked> 关注</label><label><input name="hidden" type="checkbox"> 屏蔽</label></div><button class="primary-button" type="submit">保存</button></form><div class="tag-preference-list">${result.tags.map(tag=>`<article><div><b>${esc(tag.tag)}</b><small>${tag.watch?'已关注 · ':''}${tag.hidden?'已屏蔽 · ':''}权重 ${tag.weight}</small></div>${button('tag-edit','编辑',`data-id="${tag.id}"`)}${button('tag-delete','删除',`data-id="${tag.id}"`)}</article>`).join('')||'<p class="feature-note">当前标签集还没有标签。</p>'}</div>`);
  }
  async openCommunity() {
    const gallery=this.gallery,sequence=this.modal('评分与评论','<p class="loading">正在读取评论…</p>');
    const info=await this.get('details',gallery);if(sequence!==this.sequence)return;
    this.modal('评分与评论',`<p>${esc(info.rating || gallery.rating+' 星')} · ${info.ratingCount} 人评分</p><form data-feature-form="rating" class="feature-form"><label class="feature-field">我的评分<select name="rating">${Array.from({length:10},(_,i)=>(i+1)/2).map(value=>`<option value="${value}" ${value===5?'selected':''}>${value} 星</option>`).join('')}</select></label><button type="submit" class="primary-button">提交评分</button></form><div class="source-comments">${info.comments.map(comment=>`<article><header><b>${esc(comment.author||'用户')}</b><small>${esc(comment.posted)}</small></header><p>${esc(comment.text)}</p>${comment.id>0?`<div class="comment-actions"><button type="button" class="comment-vote" data-feature="comment-vote" data-id="${comment.id}" data-vote="1" aria-label="赞同评论">${icon('thumb-up')}</button><span class="comment-score">${esc(comment.score)}</span><button type="button" class="comment-vote" data-feature="comment-vote" data-id="${comment.id}" data-vote="-1" aria-label="反对评论">${icon('thumb-down')}</button></div>`:''}</article>`).join('')||'<p class="feature-note">暂无评论。</p>'}</div><form data-feature-form="comment" class="feature-form"><label class="feature-field">发表评论<textarea name="text" required maxlength="20000" rows="4"></textarea></label><button type="submit" class="primary-button">发布评论</button></form>`);
  }
  async openFavorite() {
    const gallery=this.gallery,sequence=this.modal('收藏设置','<p class="loading">正在读取收藏信息…</p>');
    const groups=Array.from({length:10},(_,id)=>({id,name:`收藏分组 ${id+1}`}));
    let result={groups,...this.favoriteInfo(gallery)},message='';
    try {
      if(await this.ensureAccount()){
        const scope=this.getScope();result=await this.get('favorite-info',gallery);
        if(scope!==this.getScope())return;
        this.onFavoriteKnown(gallery,result,scope);
      }
    }catch{message='暂时无法读取收藏分组，可先保存在本地。';}
    if(sequence!==this.sequence||!this.dialog.open)return;
    this.modal('收藏设置',`${message?`<p class="feature-note">${esc(message)}</p>`:''}<form data-feature-form="favorite" class="feature-form"><label class="feature-field">收藏分组<select name="group">${result.groups.map(group=>`<option value="${group.id}" ${group.id===(result.group??0)?'selected':''}>${esc(group.name)}</option>`).join('')}</select></label><label class="feature-field">备注（最多 200 字节）<textarea name="note" rows="3">${esc(result.note)}</textarea></label><div class="source-actions"><button type="submit" class="primary-button">保存收藏</button><button type="submit" name="remove" value="true" class="outline-button">取消收藏</button></div></form>`);
  }
  openGalleryTags() {
    this.modal('图集标签',`<form data-feature-form="tag-vote" class="feature-form"><label class="feature-field">选择标签<select name="tag">${this.gallery.tags.map(tag=>`<option>${esc(tag)}</option>`).join('')}</select></label><div class="source-actions"><button type="submit" name="vote" value="1" class="primary-button">赞同标签</button><button type="submit" name="vote" value="-1" class="outline-button">反对标签</button></div></form>${button('tags','管理关注与屏蔽')}`);
  }
  async openDownloads() {
    const exportButton=button('image-list',`${icon('download')}导出下载清单`);
    const gallery=this.gallery,sequence=this.modal('图集下载',exportButton+'<p class="loading">正在读取种子…</p>');
    let result,note='';try{result=await this.get('torrents',gallery);}catch(error){result={torrents:[]};note=error.message;}if(sequence!==this.sequence||!this.dialog.open)return;
    const page=(this.state.progress[gallery.id]?.page||0)+1;
    const image='/api/image?'+new URLSearchParams({gid:gallery.gid,token:gallery.token,page,source:gallery.source});
    this.modal('图集下载',`<div class="source-actions">${exportButton}<a class="outline-button" href="${esc(image)}" target="_blank" rel="noreferrer">打开第 ${page} 张图片</a>${button('archive-options','压缩包下载')}</div><h3>种子文件</h3>${result.torrents.map(torrent=>`<article class="torrent-card"><b>${esc(torrent.title)}</b><p>${esc(torrent.info)}</p><div class="source-actions"><a class="outline-button" href="${esc(torrent.url)}" target="_blank" rel="noreferrer">下载种子</a>${torrent.magnet?`<a class="outline-button" href="${esc(torrent.magnet)}">磁力链接</a>`:''}</div></article>`).join('')||`<p class="feature-note">${esc(note||'此图集暂无种子。')}</p>`}`);
  }
  clearImageExport() {
    this.imageExport?.cancel();this.imageExport=null;
    if(this.exportBlobURL)URL.revokeObjectURL(this.exportBlobURL);
    this.exportBlobURL=null;this.exportFile=null;
  }
  openImageList() {
    const gallery=this.gallery,scope=this.getScope();
    const sequence=this.modal('导出下载清单',`<p class="feature-note">选择图片范围，生成下载清单。每次最多 ${exportLimit} 张。</p><form data-feature-form="image-list" class="feature-form"><div class="feature-columns">${field('start','开始页',1,'number',`min="1" max="${gallery.pageCount}" required`)}${field('end','结束页',Math.min(exportLimit,gallery.pageCount),'number',`min="1" max="${gallery.pageCount}" required`)}</div><div class="source-actions"><button class="primary-button" type="submit" data-export-run>生成清单</button>${button('image-list-cancel','停止','data-export-stop hidden')}${button('image-list-fresh','重新生成全部链接','data-export-fresh hidden')}</div></form><div data-export-result role="status" aria-live="polite"></div><p class="feature-note">链接可能过期，请尽快下载。失效后可重新生成，导入下载器并选择“继续已有任务”。</p>`);
    this.imageExport=new ManifestExport(gallery,{
      request:this.request,pageLinks:this.exportPageLinks,
      changed:()=>{if(this.dialog.open&&sequence===this.sequence&&scope===this.getScope())this.renderImageList();}
    });
    this.renderImageList();
  }
  renderImageList() {
    const task=this.imageExport;if(!task)return;
    const root=this.dialog,total=task.pages.length,done=task.items.size;
    const run=root.querySelector('[data-export-run]');if(!run)return;
    root.querySelectorAll('input').forEach(input=>{input.disabled=task.running;});
    run.disabled=task.running;run.innerHTML=task.running?'<span class="loading-spinner" aria-hidden="true"></span>正在生成…':done&&done<total?'继续 / 重试失败项':done===total&&total?'重新生成':'生成清单';
    root.querySelector('[data-export-stop]').hidden=!task.running;
    root.querySelector('[data-export-fresh]').hidden=task.running||!done||done===total;
    if(task.running){root.querySelector('[data-export-result]').innerHTML=`<p class="feature-note">已解析 ${done} / ${total} 张</p><progress class="export-progress" max="${total||1}" value="${done}"></progress>`;return;}
    if(this.exportBlobURL)URL.revokeObjectURL(this.exportBlobURL);this.exportBlobURL=null;this.exportFile=null;
    let actions='';
    if(done){
      const title=String(task.gallery.title||`gallery-${task.gallery.gid}`).replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,60);
      const name=`${title}-${task.pages[0]}-${task.pages.at(-1)}${done<total?'-partial':''}.json`;
      const blob=new Blob([JSON.stringify(task.manifest(),null,2)],{type:'application/json'});
      this.exportFile=new File([blob],name,{type:'application/json'});this.exportBlobURL=URL.createObjectURL(blob);
      actions=`<div class="source-actions"><a class="primary-button" href="${esc(this.exportBlobURL)}" download="${esc(name)}">${done<total?'保存已成功部分':'保存 JSON 文件'}</a>${navigator.canShare?.({files:[this.exportFile]})?button('image-list-share','分享给下载器'):''}</div>`;
    }
    root.querySelector('[data-export-result]').innerHTML=total?`<p class="feature-note">${done===total?'清单已生成':'尚未全部完成'} · ${done} / ${total} 张${task.failures.size?` · ${task.failures.size} 张失败`:''}</p>${actions}${task.failures.size?`<details class="export-failures"><summary>查看失败页码</summary><p class="feature-note">${[...task.failures].map(([page,error])=>`第 ${page} 页：${esc(error)}`).join('<br>')}</p></details>`:''}`:'';
  }
  async generateImageList(form,fresh=false) {
    const task=this.imageExport;if(!task)return;
    const start=form.elements.start.value,end=form.elements.end.value;
    exportRange(start,end,task.gallery.pageCount);this.status('');
    try{await task.run(start,end,{fresh:fresh||!!task.pages.length&&task.items.size===task.pages.length});}
    catch(error){if(this.imageExport!==task)return;if(error.name==='AbortError')this.status('已停止，可继续生成未完成的链接');else this.error(error);}
  }
  async shareImageList() {
    if(!this.exportFile)return;
    try{await navigator.share({files:[this.exportFile]});}catch(error){if(error.name!=='AbortError')this.error(error);}
  }
  async openArchive() {
    const intent=++this.sequence;await this.account();if(intent!==this.sequence)return;const sequence=this.modal('压缩包下载','<p class="loading">正在读取压缩包选项和费用…</p>');
    const result=await this.get('archive',this.gallery);if(sequence!==this.sequence)return;this.renderArchive(result);
  }
  renderArchive(result) {
    this.modal('压缩包下载',`${result.links.map(link=>`<p><a class="primary-button" href="${esc(link.url)}" target="_blank" rel="noreferrer">${esc(link.label||'下载压缩包')}</a></p>`).join('')}${result.options.map(option=>`<article class="torrent-card"><b>${option.label}</b><p>${esc(option.description)}</p>${button('archive-prepare','生成并下载'+option.label,`data-kind="${option.kind}"`)}</article>`).join('')}<p class="feature-note">${esc(result.message)}</p>${button('archive-check','检查下载状态')}<p class="feature-note">生成前请确认上方费用，可能消耗 GP 或 Credits。</p>`);
  }
  async submit(form,submitter) {
    const sequence=this.sequence,valid=()=>this.dialog.open&&this.sequence===sequence;
    const kind=form.dataset.featureForm,data=Object.fromEntries(new FormData(form));
    if(kind==='image-list')return this.generateImageList(form);
    if(submitter?.name)data[submitter.name]=submitter.value;
    if(kind==='advanced') {
      const {query,...fields}=data,filters={...this.getList().filters,...fields};
      filters.f_sto=form.elements.f_sto.checked;filters.f_sh=form.elements.f_sh.checked;
      if(filters.f_spf&&filters.f_spt&&Number(filters.f_spf)>Number(filters.f_spt))throw new Error('最少页数不能大于最多页数');
      this.dialog.close();return this.onSearch(query,filters);
    }
    const submitHTML=submitter?.innerHTML;
    if(kind==='favorite'&&submitter){submitter.setAttribute('aria-busy','true');submitter.innerHTML='<span class="loading-spinner" aria-hidden="true"></span><span>正在提交…</span>';}
    const buttons=[...form.querySelectorAll('button')];buttons.forEach(button=>{button.disabled=true;});this.status('正在提交…');
    try {
      if(kind==='image') {
        const file=form.elements.file.files[0];if(!file || !/^image\//.test(file.type))throw new Error('请选择图片');
        let hash,imageFilters={};
        if(!form.elements.similar.checked){hash=[...new Uint8Array(await crypto.subtle.digest('SHA-1',await file.arrayBuffer()))].map(value=>value.toString(16).padStart(2,'0')).join('');}
        else {
          if(file.size>3*1024*1024)throw new Error('相似搜索图片最大 3 MB，可关闭相似搜索进行精确匹配');
          const body=new FormData();body.set('file',file);body.set('similar','true');body.set('covers',String(form.elements.covers.checked));
          const result=await this.request('/api/source?'+new URLSearchParams({source:this.getList().source}),{method:'POST',body});hash=result.hash;imageFilters=result.filters||{};
        }
        if(!valid())return;this.dialog.close();return this.onSearch('',{f_shash:hash,...imageFilters},'library');
      }
      if(kind==='favorite'){const result=await this.onFavoriteSave(this.gallery,{remove:data.remove==='true',group:Number(data.group),note:data.note});if(valid())this.status(this.favoriteMessage(result));return;}
      await this.account();if(!valid())return;
      const scope=this.getScope();
      if(kind==='tag') {
        await this.post('tag-preference',{...data,set:this.tagSet,watch:form.elements.watch.checked,hidden:form.elements.hidden.checked},null);
        if(!valid()||scope!==this.getScope())return;await this.openTags(this.tagSet);this.status('标签偏好已保存');return;
      }
      await this.post(kind,data);if(!valid()||scope!==this.getScope())return;
      if(kind==='comment'){await this.openCommunity();this.status('评论已发布');}
      else this.status(kind==='rating'?'评分已保存':'标签投票已保存');
    }finally{buttons.forEach(button=>{button.disabled=false;});if(kind==='favorite'&&submitter?.isConnected){submitter.setAttribute('aria-busy','false');submitter.innerHTML=submitHTML;}}
  }
}
