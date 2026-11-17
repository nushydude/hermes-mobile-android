/** Foreground file-based voice uses the same interruption mode for capture and playback. */
export const voiceAudioMode=(allowsRecording:boolean)=>({allowsRecording,shouldPlayInBackground:false,interruptionMode:'doNotMix' as const});
