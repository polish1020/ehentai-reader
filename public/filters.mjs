export const categories = [
  {name:'Doujinshi',label:'同人志',bit:2},
  {name:'Manga',label:'漫画',bit:4},
  {name:'Artist CG',label:'画师 CG',bit:8},
  {name:'Game CG',label:'游戏 CG',bit:16},
  {name:'Western',label:'西方作品',bit:512},
  {name:'Non-H',label:'非 H',bit:256},
  {name:'Image Set',label:'图片集',bit:32},
  {name:'Cosplay',label:'角色扮演',bit:64},
  {name:'Asian Porn',label:'亚洲成人',bit:128},
  {name:'Misc',label:'其他',bit:1}
];

// E-Hentai's f_cats mask specifies categories to exclude.
export const excludedCategories = selected => categories.reduce((mask,category) => selected.includes(category.name) ? mask : mask | category.bit,0);

export function tagQuery(tag) {
  const colon=tag.indexOf(':');
  const prefix=colon < 0 ? '' : tag.slice(0,colon+1);
  const value=(colon < 0 ? tag : tag.slice(colon+1)).replace(/\\/g,'\\\\').replace(/"/g,'\\"');
  return `${prefix}"${value}$"`;
}
