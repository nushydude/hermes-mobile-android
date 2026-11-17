import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, AppState, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { File } from 'expo-file-system';
import * as Clipboard from 'expo-clipboard';
import { conversationDiagnostics } from '../state/conversationDiagnostics';
import Ionicons from '@expo/vector-icons/Ionicons';
import { appManager, useAppStore } from '../state';
import { Button, Card, ui } from './UI';
import { Sheet } from './Sheet';
import { colors } from '../theme';
import { VoiceController, DefiniteVoiceSendError } from './voiceController';
import { VoiceMeterBridge } from './voiceMeterBridge';
import { VoiceCorrelation } from './voiceCorrelation';
import { speechParts, speechText } from './voiceText';
import { voiceLeaseValid, type SpeechOwner, type SpeechLease } from './speechOwner';
import { getSpeakReplies, setSpeakReplies, useSpeakReplies } from '../preferences';
import { randomUUID } from '@hermes-mobile/protocol';
import { TranscriptTransfer } from './transcriptTransfer';
import { voiceAudioMode } from './voiceAudioMode';

type Props={sessionId:string;origin:string;endpointEpoch:number;title:string;model:string;reasoning:string;reply?:string;onClose:()=>void;owner:SpeechOwner;lease:SpeechLease;setPlaybackTrace:(trace:number|null)=>void};
const remove = (uri:string|null|undefined) => {if(!uri)return;try{const file=new File(uri);if(file.exists)file.delete();}catch{}};
export function VoiceSheet({sessionId,origin,endpointEpoch,title,model,reasoning,reply,onClose,owner,lease,setPlaybackTrace}:Props) {
  const traceRef=useRef<number|null>(null);
  const speakReplies=useSpeakReplies();
  const transfer=useRef(new TranscriptTransfer());
  const [transferState,setTransferState]=useState<'idle'|'saving'|'retry'|'recovering'>('idle');
  const [priorTranscriptSaved,setPriorTranscriptSaved]=useState(false);
  const [diagnosticsEnabled,setDiagnosticsEnabled]=useState(()=>conversationDiagnostics.isEnabled());
  const recorder=useAudioRecorder({...RecordingPresets.HIGH_QUALITY,isMeteringEnabled:true});
  const promptCount=useAppStore(s => s.chats[sessionId]?.prompts.length ?? 0);
  const recording=useAudioRecorderState(recorder,100);
  const recordingRef=useRef(recording);recordingRef.current=recording;
  const meterBridge=useMemo(()=>new VoiceMeterBridge(),[recorder]);
  const lastReply=useRef<string|undefined>(reply);
  const recordedFile=useRef<string|null>(null);
  const stopping=useRef<Promise<string|null>|null>(null), watch=useRef<(()=>void)|null>(null);
  const scopeValid=()=>voiceLeaseValid(lease,()=>AppState.currentState==='active' && appManager.getEndpointEpoch()===endpointEpoch && appManager.getConfiguredOrigin()===origin && appManager.getState().activeSessionId===sessionId);
  const playback=owner.playback;
  useEffect(()=>()=>lease.release(),[lease]);
  const controller=useMemo(()=>{
    const stopPlayback=lease.stop;
    const stopRecorder=()=>{if(stopping.current)return stopping.current;const work=(async()=>{try{if(recorder.isRecording)await recorder.stop();}catch{}try{const uri=recorder.uri;if(uri)recordedFile.current=uri;return uri;}catch{return null;}})();stopping.current=work;const clear=()=>{if(stopping.current===work)stopping.current=null;};void work.then(clear,clear);return work;};
    const discard=async()=>{const uri=await stopRecorder();remove(uri);if(recordedFile.current===uri)recordedFile.current=null;};
    let instance:VoiceController;
    instance=new VoiceController({
      valid:scopeValid, shouldSpeak:()=>getSpeakReplies()!==false,
      automaticReady:()=>{const s=appManager.getState(),chat=s.chats[sessionId];return s.connection==='ready' && !!chat && !chat.sessionUnavailable && !chat.prompts.length && !s.secureRequest;},
      captureReady:()=>{const s=appManager.getState(),chat=s.chats[sessionId];return !!chat && !chat.running && !chat.pending.length && !s.outbox.some(item=>item.session_id===sessionId);},
      cancelPendingReply:()=>{watch.current?.();watch.current=null;},
      permission:async()=> (await requestRecordingPermissionsAsync()).granted,
      prepare:async()=>{await setAudioModeAsync(voiceAudioMode(true));await recorder.prepareToRecordAsync();},
      start:()=>{traceRef.current=conversationDiagnostics.begin();meterBridge.begin(recordingRef.current,performance.now());recorder.record({forDuration:60});},
      stop:async()=>{conversationDiagnostics.mark(traceRef.current,'capture_end');return stopRecorder();},
      discard,
      transcribe:async(uri,signal)=>{const trace=traceRef.current;conversationDiagnostics.mark(trace,'transcription_start');const file=new File(uri);if(!file.exists||file.size<128||file.size>5*1024*1024)throw new Error();const b64=await file.base64();if(signal.aborted||!scopeValid())throw new Error();const result=await appManager.transcribeAudio('data:audio/mp4;base64,'+b64,signal,endpointEpoch);if(scopeValid()&&!signal.aborted)conversationDiagnostics.mark(trace,'transcription_end');return result;},
      send:async(text,valid)=>{
        const trace=traceRef.current;conversationDiagnostics.mark(trace,'submission_start');watch.current?.();let timeout:ReturnType<typeof setTimeout>|null=null;let unsubEvent=()=>{},unsubState=()=>{},closed=false;
        const close=()=>{if(closed)return;closed=true;correlation.close();unsubEvent();unsubState();if(timeout)clearTimeout(timeout);if(watch.current===close)watch.current=null;};
        const correlation=new VoiceCorrelation(sessionId,submission=>appManager.getState().chats[sessionId]?.localMessages.find(x=>x.submission_id===submission)?.admission_id,event=>{
          if(!scopeValid()){close();return;}
          const spoken=typeof event.payload?.text==='string'?event.payload.text:'';const status=event.payload?.status;conversationDiagnostics.mark(trace,'reply_complete');setPlaybackTrace(trace);close();
          if(status==='complete'&&spoken.trim()){lastReply.current=spoken;setTimeout(()=>{if(scopeValid() && (instance.isAutomatic() || valid()))void instance.reply(spoken);},0);}
          else instance.settle(instance.isAutomatic()?scopeValid:valid,status==='complete'?'empty':status==='interrupted'||status==='cancelled'?'interrupted':'error');
        });
        unsubEvent=appManager.subscribeVoiceEvents(event=>{if(event.session_id===sessionId && event.type==='session.replay_gap' && instance.isAutomatic())instance.pause('Conversation paused because chat events were missed.');correlation.event(event);});unsubState=appManager.subscribe(()=>correlation.refresh());watch.current=close;
        let submission:string;
        try {const result=await appManager.send(sessionId,text,undefined,{preserveDraft:true,valid});if(!result)throw new Error();submission=result;conversationDiagnostics.mark(trace,'submission_saved');}catch{close();throw new DefiniteVoiceSendError();}
        correlation.bind(submission);if(!closed && valid())timeout=setTimeout(()=>{if(instance.isAutomatic())instance.settle(scopeValid,'timeout');else instance.waitingLonger(valid);},instance.isAutomatic()?120000:30000);else if(!scopeValid())close();
      },
      play:async(text,signal)=>{lastReply.current=text;const parts=speechParts(speechText(text));if(!parts.length)throw new Error('No speakable text');return lease.play(parts,signal);},stopPlayback,
    });return instance;
  },[sessionId,origin,endpointEpoch,recorder,lease]);
  const state=useSyncExternalStore(controller.subscribe,controller.getState,controller.getState);
  const [handsFree,setHandsFree]=useState(false);
  useEffect(()=>{if(handsFree && state.phase==='recording'){const sample=meterBridge.sample(recording,performance.now());if(sample)controller.meter(sample.now,sample.level);}},[controller,handsFree,state.phase,recording,meterBridge]);
  useEffect(()=>{if(!handsFree || state.phase!=='recording')return;const timer=setInterval(()=>{if(meterBridge.expired(performance.now()))controller.pause('Microphone metering is unavailable. Use Review first.');},250);return()=>clearInterval(timer);},[controller,handsFree,state.phase,meterBridge]);
  useEffect(()=>{const unsubscribe=appManager.subscribe(()=>{const s=appManager.getState(),chat=s.chats[sessionId];if(controller.isAutomatic() && controller.getState().phase!=='paused' && (s.connection!=='ready'||!chat||chat.sessionUnavailable||chat.prompts.length>0||s.secureRequest))controller.pause('Conversation paused because the chat needs attention.');});return()=>{unsubscribe();};},[controller,sessionId]);
  useEffect(()=>{const unsubscribe=appManager.subscribeVoiceEvents(event=>{if(event.session_id===sessionId && event.type==='session.replay_gap' && controller.isAutomatic() && controller.getState().phase!=='paused')controller.pause('Conversation paused because chat events were missed.');});return()=>{unsubscribe();};},[controller,sessionId]);
  useEffect(()=>{const closeForLease=onClose;const lifecycle=AppState.addEventListener('change',state=>{if(state!=='active'){watch.current?.();controller.end();closeForLease();}});const unsub=appManager.subscribe(()=>{if(!scopeValid()){watch.current?.();controller.end();closeForLease();}});return()=>{lifecycle.remove();unsub();watch.current?.();controller.end();remove(recordedFile.current);};},[controller]);
  const close=()=>{if(!transfer.current.canLeave())return;watch.current?.();controller.end();onClose();};
  const audio=useSyncExternalStore(playback.subscribe,playback.getState,playback.getState);
  const replay=()=>{const text=lastReply.current;setPlaybackTrace(null);if(text)void controller.replay(text);};
  const [waitingSeconds,setWaitingSeconds]=useState(0);
  useEffect(()=>{setWaitingSeconds(0);if(state.phase!=='sent')return;const timer=setInterval(()=>setWaitingSeconds(n=>n+1),1000);return()=>clearInterval(timer);},[state.phase]);
  const micLevel=state.activity?.level ?? (recording.isRecording ? recording.metering : undefined);
  const meter=typeof micLevel==='number' && Number.isFinite(micLevel)?Math.max(0,Math.min(1,(micLevel+65)/55)):null;
  const clock=(seconds:number)=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
  const canRead=['idle','error','sent'].includes(state.phase);
  const central=state.phase==='recording'?{label:handsFree?'Finish speaking':'Stop recording',icon:'stop' as const,action:()=>void controller.stop()}:handsFree && state.phase!=='playing'?null:state.phase==='playing'?{label:audio.phase==='paused'?'Resume speaking':'Pause speaking',icon:audio.phase==='paused'?'play' as const:'pause' as const,action:lease.toggle}:reply&&canRead?{label:'Read reply',icon:'play' as const,action:replay}:!reply&&['idle','error','sent','review'].includes(state.phase)?{label:state.phase==='review'?'Record again':'Record',icon:'mic' as const,action:()=>void controller.start()}:null;
  const status=state.phase==='recording'?(handsFree && (!state.activity || state.activity.phase==='calibrating')?'Getting the mic ready':handsFree && state.activity?.phase==='pause'?'Finishing your sentence':handsFree && state.activity?.phase==='speaking'?'I hear you':"I'm listening"):state.phase==='transcribing'?'Transcribing':state.phase==='review'?'Review your words':state.phase==='sent'?(waitingSeconds>=20?'Still waiting for the reply':'Waiting for Hermes'):state.phase==='playing'?(audio.phase==='preparing'?'Preparing audio':audio.phase==='paused'?'Paused':"Hermes is speaking"):state.phase==='permission'?'Preparing microphone':state.phase==='sending'?'Saving message':state.phase==='paused'?'Conversation paused':state.phase==='cooldown'?'Getting ready to listen':'Ready when you are';
  return <Sheet visible closeDisabled={transferState!=='idle'} title={reply?'Read this reply':'Talk in this chat'} closeLabel="End voice" onClose={close}><ScrollView keyboardShouldPersistTaps="handled" style={{maxHeight:500}} contentContainerStyle={{gap:12}}>
    <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}><Button secondary label={diagnosticsEnabled?'Disable timing':'Enable timing'} onPress={()=>{const enabled=!diagnosticsEnabled;conversationDiagnostics.setEnabled(enabled);setDiagnosticsEnabled(enabled);}} />{diagnosticsEnabled&&<Button secondary label="Copy timings" onPress={()=>{void Clipboard.setStringAsync(JSON.stringify(conversationDiagnostics.export())).catch(()=>{});}} />}</View>
    <Button secondary label={`Speak replies: ${speakReplies===null?'On for voice':speakReplies?'On':'Off'}`} onPress={()=>{const next=speakReplies===false;setSpeakReplies(next);if(!next)controller.mute();}} />
    <Text style={ui.text}>{title}</Text><Text style={ui.muted}>{model} · {reasoning}</Text>
    {promptCount > 0 && <Card style={{backgroundColor:colors.warningSurface,borderColor:colors.warning,borderWidth:1}}><Text style={{color:colors.warning}}>Hermes needs your response. Return to chat to review it.</Text><Button label="Return to chat" secondary onPress={close} /></Card>}
    <View style={{alignItems:'center',backgroundColor:colors.surface,borderRadius:22,paddingVertical:20,gap:12}}>
      <View style={{width:state.phase==='recording'?80:126,height:state.phase==='recording'?80:126,alignItems:'center',justifyContent:'center'}}>
        <Pressable accessibilityRole="button" accessibilityLabel={central?.label ?? status} accessibilityState={{disabled:!central||audio.phase==='preparing'||transferState!=='idle'}} disabled={!central||audio.phase==='preparing'||transferState!=='idle'} onPress={()=>{if(transfer.current.canLeave())central?.action();}} style={{width:state.phase==='recording'?72:104,height:state.phase==='recording'?72:104,borderRadius:52,alignItems:'center',justifyContent:'center',backgroundColor:colors.accent,opacity:central?1:0.5}}><Ionicons name={central?.icon ?? "mic"} size={state.phase==='recording'?30:40} color={colors.ink} /></Pressable>
      </View>
      <Text accessibilityLiveRegion="polite" style={[ui.heading,{fontSize:22}]}>{status}</Text>
      {state.phase==='recording'&&<Text style={ui.muted}>{clock(recording.durationMillis/1000)} / 1:00</Text>}
      {state.phase==='recording' && <View style={{width:'90%',gap:10}}>
        <View accessible accessibilityLabel={meter===null?'Waiting for microphone readings':'Live microphone level'} style={{flexDirection:'row',gap:4,height:28,alignItems:'center',justifyContent:'center'}}>
          {Array.from({length:16},(_,index)=><View key={index} style={{flex:1,height:8+20*(1-Math.abs(index-7.5)/8),borderRadius:4,backgroundColor:meter!==null && index/16<meter?colors.accent:colors.raised}} />)}
        </View>
        <Text accessibilityLiveRegion="polite" style={[ui.muted,{textAlign:'center'}]}>{handsFree
          ? !state.activity || state.activity.phase==='calibrating' ? 'Stay quiet briefly while I adjust to the room.'
          : state.activity.phase==='speaking' ? 'Speech detected. Keep talking.'
          : state.activity.phase==='pause' ? 'Pause detected. Finishing your recording…'
          : 'Mic ready. Start speaking.'
          : meter===null?'Waiting for microphone readings…':'Live microphone level. Tap Stop when you finish.'}</Text>
        {handsFree && state.activity?.phase==='pause' && <View accessible accessibilityLabel="Pause before automatic transcription" style={{height:5,borderRadius:3,backgroundColor:colors.raised}}><View style={{height:5,borderRadius:3,width:`${state.activity.pauseProgress*100}%`,backgroundColor:colors.accent}} /></View>}
        <Text style={[ui.muted,{textAlign:'center',fontSize:13}]}>Your words appear after recording stops.</Text>
      </View>}
      {state.phase==='transcribing' && <Text style={[ui.muted,{textAlign:'center'}]}>Turning your recording into words…</Text>}
      {state.phase==='sent' && <Text style={[ui.muted,{textAlign:'center',paddingHorizontal:16}]}>Waiting {clock(waitingSeconds)}. Audio starts after Hermes finishes the full reply. Longer tasks can take a while.</Text>}
      {state.phase==='playing'&&<><Text style={ui.muted}>Part {audio.part+1} of {audio.count}</Text><View accessibilityElementsHidden importantForAccessibility="no" style={{height:4,width:'90%',backgroundColor:colors.raised,borderRadius:2}}><View style={{height:4,width:`${audio.duration>0?Math.max(0,Math.min(100,audio.position/audio.duration*100)):0}%`,backgroundColor:colors.accent,borderRadius:2}} /></View><Text style={ui.muted}>{clock(audio.position)} / {audio.duration>0?clock(audio.duration):'—'}</Text></>}
    </View>
    {handsFree && state.phase==='recording' && <Button label="Finish speaking" secondary onPress={()=>void controller.stop()} />}
    {!!state.sentText && ['sent','playing','paused','cooldown'].includes(state.phase) && <Card><Text style={[ui.text,{fontWeight:'700'}]}>You sent</Text><Text selectable style={ui.text}>{state.sentText}</Text></Card>}
    {state.phase==='sent' && <Button label="Continue in chat" secondary onPress={close} />}
    {reply && <Text style={ui.muted} numberOfLines={4}>{reply}</Text>}
    {!reply && <><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}><Button label="Review first" disabled={controller.hasPending() || transferState!=='idle'} secondary={handsFree} onPress={()=>{if(transfer.current.canLeave()){controller.end();setHandsFree(false);}}} /><Button label="Hands-free" disabled={controller.hasPending() || transferState!=='idle'} secondary={!handsFree} onPress={()=>{if(transfer.current.canLeave()){controller.end();setHandsFree(true);}}} /></View>{handsFree ? <><Text style={ui.muted}>Stay quiet for a moment when the mic starts, then speak. Your words send after about 1.3 seconds of quiet. Listening resumes after Hermes finishes speaking. Keep this screen open.</Text><Button label={state.phase==='paused'?'Resume conversation':state.phase==='idle'?'Start conversation':'Pause conversation'} onPress={()=>{if(!transfer.current.canLeave())return;if(state.phase==='paused')controller.resume();else if(state.phase==='idle')controller.startConversation();else controller.pause();}} /></> : <Text style={ui.muted}>Record, review the words, then send. Your typed draft stays in the chat.</Text>}</>}
    {state.phase==='review' && <TextInput accessibilityLabel="Review transcript" multiline value={state.text} onChangeText={text=>{transfer.current.edit(text,controller.edit);}} editable={transferState==='idle'} style={[ui.input,{minHeight:80,maxHeight:160}]} />}
    {state.phase==='review'&&!priorTranscriptSaved&&<Button label={transferState==='retry'?'Retry saving draft':'Type instead'} disabled={transferState==='saving'||transferState==='recovering'} secondary onPress={()=>{if(!scopeValid())return;const text=controller.getState().text;if(text.length>100000){Alert.alert('Transcript is too long','Shorten the transcript to 100,000 characters before adding it to the draft.');return;}if(appManager.getState().chats[sessionId]?.sessionUnavailable){Alert.alert('Chat unavailable','Keep your transcript here or copy it into another chat.');return;}const work=transfer.current.begin(text,randomUUID);if(!work)return;setTransferState('saving');void appManager.importSharedDraft(sessionId,work.id,work.text,[],scopeValid,'transcript').then(()=>{if(!scopeValid())return;const result=transfer.current.finish(work.token,controller.getState().text);if(result==='saved'){controller.end();onClose();}else if(result==='changed'){setPriorTranscriptSaved(true);setTransferState('idle');Alert.alert('Earlier transcript saved','The earlier transcript was added to your draft. Your newer words remain here; copy them and check the draft before pasting.');}}).catch(()=>{if(scopeValid() && transfer.current.fail(work.token)){setTransferState('retry');Alert.alert('Could not save draft','Your transcript is still here. Try again.');}});}} />}
    {state.phase==='review' && (transferState==='retry'||priorTranscriptSaved) && <Button label="Copy transcript and return to chat" disabled={transferState==='recovering'} secondary onPress={()=>{if(!scopeValid()||!transfer.current.canRecover())return;const text=controller.getState().text;setTransferState('recovering');void transfer.current.recover(text,Clipboard.setStringAsync,scopeValid,()=>controller.getState().text).then(copied=>{if(!scopeValid())return;if(copied){controller.end();onClose();Alert.alert('Transcript copied','Check the draft before pasting. The earlier save may already have added words.');}else{setTransferState(priorTranscriptSaved?'idle':'retry');Alert.alert('Could not copy transcript','Your transcript is still here. Try again.');}});}} />}
    {['permission','recording','transcribing'].includes(state.phase)&&<Button label="Type instead" secondary onPress={close} />}
    {state.phase==='review'&&<Button label="Send message" disabled={!state.text.trim() || transferState!=='idle'} onPress={()=>{if(transfer.current.canLeave())void controller.send();}} />}
    {!reply && lastReply.current && canRead && <Button label={state.phase==='error'?'Retry last reply':'Replay last reply'} onPress={replay} />}
    {state.phase==='playing'&&<View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
      {[
        {label:'Replay',accessibilityLabel:'Replay reply',action:replay,availableDuringPreparation:false},
        {label:'Back 10s',accessibilityLabel:'Back 10 seconds',action:()=>void lease.rewind(),availableDuringPreparation:false},
        {label:`${audio.speed}×`,accessibilityLabel:`Playback speed ${audio.speed} times`,action:()=>{const speeds=[0.8,1,1.25,1.5];lease.speed(speeds[(speeds.indexOf(audio.speed)+1)%speeds.length]);},availableDuringPreparation:false},
        {label:'Stop',accessibilityLabel:'Stop speaking',action:controller.stopSpeaking,availableDuringPreparation:true},
      ].map(item=><Pressable key={item.label} accessibilityRole="button" accessibilityLabel={item.accessibilityLabel} accessibilityState={{disabled:audio.phase==='preparing'&&!item.availableDuringPreparation}} disabled={audio.phase==='preparing'&&!item.availableDuringPreparation} onPress={item.action} style={{flexGrow:1,minWidth:100,minHeight:48,alignItems:'center',justifyContent:'center',borderRadius:16,backgroundColor:colors.raised,opacity:audio.phase==='preparing'&&!item.availableDuringPreparation?0.5:1}}><Text style={{color:colors.accent,fontWeight:'700'}}>{item.label}</Text></Pressable>)}
    </View>}
    {!!state.error&&<Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{color:colors.warning}}>{state.error}</Text>}
    {!!state.notice&&<Text accessibilityLiveRegion="polite" style={ui.muted}>{state.notice}</Text>}
  </ScrollView></Sheet>;
}
