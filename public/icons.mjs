const paths={
  discover:'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3z',
  heart:'M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 00-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 000-7.8z',
  clock:'M12 8v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  list:'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  back:'M15 5l-7 7 7 7',next:'M9 5l7 7-7 7',close:'M6 6l12 12M18 6L6 18',
  refresh:'M20 7v5h-5M20 12a8 8 0 10-2 5M20 7l-3-3',
  expand:'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',
  sun:'M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5M16 12a4 4 0 11-8 0 4 4 0 018 0z',
  moon:'M20.9 13A9 9 0 0111 3.1 9 9 0 1020.9 13z',
  search:'M21 21l-5-5M18 10.5a7.5 7.5 0 11-15 0 7.5 7.5 0 0115 0z',
  filter:'M4 6h16M7 12h10M10 18h4',
  image:'M3 3h18v18H3zM3 16l5-5 5 5 3-3 5 5M8 7h.01',
  download:'M12 3v12M7 10l5 5 5-5M4 16v5h16v-5',
  star:'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3z',
  'thumb-up':'M7 10v11H3V10h4zM7 10l4-7h2v5h5a3 3 0 012.9 3.8l-2 7A3 3 0 0116 21H7',
  'thumb-down':'M7 14V3H3v11h4zM7 14l4 7h2v-5h5a3 3 0 002.9-3.8l-2-7A3 3 0 0016 3H7',
  tag:'M3 3h8l10 10-8 8L3 11V3zM7 7h.01',
  copy:'M8 8h13v13H8zM16 8V3H3v13h5',
  top:'M5 4h14M12 20V8M7 13l5-5 5 5',
  up:'M6 14l6-6 6 6',down:'M6 10l6 6 6-6',
  trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  settings:'M18.93 9.13L21.29 10.02L21.29 13.98L18.93 14.87L19.97 17.17L17.17 19.97L14.87 18.93L13.98 21.29L10.02 21.29L9.13 18.93L6.83 19.97L4.03 17.17L5.07 14.87L2.71 13.98L2.71 10.02L5.07 9.13L4.03 6.83L6.83 4.03L9.13 5.07L10.02 2.71L13.98 2.71L14.87 5.07L17.17 4.03L19.97 6.83L18.93 9.13zM15 12a3 3 0 1 1-6 0a3 3 0 0 1 6 0z'
};
export function icon(name) {
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${paths[name]||paths.grid}"/></svg>`;
}
const actions={'close-settings':'close','close-detail':'back','exit-reader':'back',prev:'back',next:'next','refresh-list':'refresh'};
export function decorateIcons(root=document) {
  root.querySelectorAll('button[data-action],button[data-favorite]').forEach(button=>{
    if(button.hasAttribute('data-favorite')){
      const busy=button.getAttribute('aria-busy')==='true',compact=button.classList.contains('favorite-button')||button.id==='reader-favorite';
      const label=button.dataset.favoriteLabel||(button.getAttribute('aria-pressed')==='true'?'已收藏':'收藏图集');
      const signature=`favorite:${busy}:${compact?'':label}`;
      if(button.dataset.icon!==signature){button.innerHTML=(busy?'<span class="loading-spinner" aria-hidden="true"></span>':icon('heart'))+(compact?'':`<span>${label}</span>`);button.dataset.icon=signature;}
      return;
    }
    const name=button.dataset.action==='view'?(button.getAttribute('aria-pressed')==='true'?'grid':'list'):button.dataset.action==='settings'&&button.classList.contains('icon-button')?'settings':actions[button.dataset.action];
    if(name && button.dataset.icon!==name){
      button.innerHTML=icon(name);button.dataset.icon=name;
    }
  });
}
