import { requireNativeModule, type EventSubscription } from 'expo-modules-core';

export type IncomingShareImage = { uri:string; name:string; mime:string; size:number };
export type IncomingShare = { id:string; text:string; images:IncomingShareImage[]; createdAt:number; error?:string };
export type IncomingShareEvent = {error?:string | null};

type NativeSharingModule = {
  getPendingShares(): Promise<IncomingShare[]>;
  discardShare(id:string): Promise<void>;
  addListener(name:'onSharesChanged', listener:(event:IncomingShareEvent) => void): EventSubscription;
};

const nativeSharing = requireNativeModule<NativeSharingModule>('HermesSharing');
export const getPendingShares = () => nativeSharing.getPendingShares();
export const discardShare = (id:string) => nativeSharing.discardShare(id);
export const subscribeIncomingShares = (listener:(event:IncomingShareEvent) => void) => nativeSharing.addListener('onSharesChanged', listener);
