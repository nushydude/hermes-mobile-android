export const modelFavouriteKey = (choice:{provider:string;model:string}) => JSON.stringify([choice.provider,choice.model]);
export function parseModelFavourites(raw:unknown):readonly string[] {
  if(typeof raw!=='string')return [];
  try {
    const values:unknown=JSON.parse(raw);if(!Array.isArray(values))return [];
    return [...new Set(values.filter((value):value is string=>{
      if(typeof value!=='string'||value.length>2100)return false;
      try{const pair:unknown=JSON.parse(value);return Array.isArray(pair)&&pair.length===2&&pair.every(p=>typeof p==='string'&&p.trim().length>0&&p.length<=512);}catch{return false;}
    }))].slice(0,100);
  }catch{return [];}
}
export function favouritesFirst<T extends {provider:string;model:string}>(options:readonly T[],favourites:readonly string[]):T[] {
  const keys=new Set(favourites);
  return [...options.filter(o=>keys.has(modelFavouriteKey(o))),...options.filter(o=>!keys.has(modelFavouriteKey(o)))];
}
