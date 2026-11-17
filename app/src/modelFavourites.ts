import {useSyncExternalStore} from 'react';
import * as SQLite from 'expo-sqlite';
import {modelFavouriteKey,parseModelFavourites} from './components/modelFavouriteCore';
export {modelFavouriteKey} from './components/modelFavouriteCore';
const db=SQLite.openDatabaseSync('hermes-preferences.db');
db.execSync('CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)');
let favourites=parseModelFavourites(db.getFirstSync<{value:string}>('SELECT value FROM preferences WHERE key = ?','model_favourites')?.value);
const listeners=new Set<()=>void>();
export function useModelFavourites(){return useSyncExternalStore(listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},()=>favourites,()=>favourites);}
export function toggleModelFavourite(choice:{provider:string;model:string}) {
  const key=modelFavouriteKey(choice);
  if(!favourites.includes(key)&&favourites.length>=100)throw Error('You can save up to 100 favourite models.');
  const next=favourites.includes(key)?favourites.filter(v=>v!==key):[...favourites,key];
  db.runSync('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)', 'model_favourites',JSON.stringify(next));
  favourites=next;listeners.forEach(listener=>listener());
}
