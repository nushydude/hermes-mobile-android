import {useEffect,useRef,useState} from 'react';
import {Pressable,Text,View} from 'react-native';
import {appManager} from '../state';
import {colors} from '../theme';
import {Button,ui} from './UI';
import {reasoningLabel,reasoningLevels,reasoningProjection,type ReasoningLevel} from './reasoningLevels';

export function ReasoningPicker({sessionId,endpointEpoch,disabled,onBusyChange}:{sessionId:string;endpointEpoch:number;disabled:boolean;onBusyChange:(busy:boolean)=>void}) {
  const [selected,setSelected]=useState<ReasoningLevel|null>(null),[current,setCurrent]=useState<ReturnType<typeof reasoningProjection>|null>(null);
  const [loading,setLoading]=useState(true),[retry,setRetry]=useState(0),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const live=useRef(false),flight=useRef<object|null>(null),notifyBusy=useRef(onBusyChange);notifyBusy.current=onBusyChange;
  const valid=()=>live.current&&appManager.getEndpointEpoch()===endpointEpoch&&appManager.getState().activeSessionId===sessionId;
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  useEffect(()=>{
    let active=true;setLoading(true);setNotice('');setCurrent(null);
    void appManager.request('session.info',{session_id:sessionId}).then(info=>{if(active&&valid()){const value=reasoningProjection(info);setCurrent(value);setSelected(value.requested);}})
      .catch(()=>{if(active&&valid())setNotice('Could not load current reasoning. Try again.');})
      .finally(()=>{if(active&&valid())setLoading(false);});
    return()=>{active=false;};
  },[sessionId,endpointEpoch,retry]);
  async function apply(){
    if(flight.current||disabled||loading||!current||!valid())return;
    const work={};flight.current=work;setBusy(true);notifyBusy.current(true);setNotice('');
    try{
      const result=await appManager.mutate(sessionId,'reasoning',{effort:selected});if(!valid())return;
      const info=await appManager.request('session.info',{session_id:sessionId});if(!valid())return;
      setCurrent(reasoningProjection(info));
      setNotice(result?.status==='deferred'?'Reasoning will change after the current turn.':'Reasoning updated for this chat.');
    }catch{if(valid())setNotice('Could not update reasoning. Check the connection and try again.');}
    finally{if(flight.current===work){flight.current=null;if(valid()){setBusy(false);notifyBusy.current(false);}}}
  }
  return <View style={{gap:10}}>
    <Text style={ui.label}>Reasoning</Text>
    {loading?<Text style={ui.muted}>Loading current reasoning…</Text>:current?<Text style={ui.muted}>Current: {current.requested===null?'Not reported':reasoningLabel(current.requested)}{current.wire&&current.wire!==current.requested?` · provider uses ${reasoningLabel(current.wire)}`:''}</Text>:<Button secondary label="Retry reasoning" onPress={()=>setRetry(n=>n+1)}/>}
    <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{[null,...reasoningLevels].map(value=><Pressable key={value ?? 'default'} accessibilityRole="radio" accessibilityState={{checked:selected===value,disabled:disabled||busy||loading||!current}} disabled={disabled||busy||loading||!current} onPress={()=>setSelected(value)} style={{minHeight:48,paddingHorizontal:14,justifyContent:'center',borderRadius:16,backgroundColor:selected===value?colors.accent:colors.raised,opacity:disabled||loading?0.5:1}}><Text style={{color:selected===value?colors.ink:colors.text}}>{reasoningLabel(value)}</Text></Pressable>)}</View>
    <Text style={ui.muted}>These are Hermes reasoning levels. The provider may adjust the effective level. Gateway default restores the profile setting.</Text>
    <Button label={busy?'Applying reasoning…':'Apply reasoning'} secondary disabled={disabled||busy||loading||!current} onPress={()=>void apply()}/>
    {!!notice&&<Text accessibilityLiveRegion="polite" style={ui.muted}>{notice}</Text>}
  </View>;
}
