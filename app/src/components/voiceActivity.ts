/** Timestamp-based metering endpoint detector. A gap cannot establish silence. */
export type VadResult = 'calibrating'|'listening'|'speech'|'endpoint'|'no-speech'|'unavailable';
export type VadFeedback = {
  phase:'calibrating'|'listening'|'speaking'|'pause';
  level:number;
  threshold:number;
  pauseProgress:number;
};

const CALIBRATION_MS=500, VOICE_MS=250, SILENCE_MS=1300, NO_SPEECH_MS=8000;
const floorLevel=(level:number)=>Math.max(-80,Math.min(0,level));
// A loud floor may put the threshold above 0 dB: in that case speech cannot
// be reliably distinguished from the calibrated noise, so fail closed.
const startThreshold=(floor:number)=>Math.max(-65,floor+10);
const endThreshold=(floor:number)=>Math.max(-69,floor+6);

export class VoiceActivity {
  private first:number|null=null;
  private last:number|null=null;
  private floor=-60;
  private calibration:number[]=[];
  private calibrated=false;
  private activity:number|null=null;
  private silence:number|null=null;
  private voiced=false;
  private lastLevel=-80;
  private currentFeedback:VadFeedback={phase:'calibrating',level:-80,threshold:startThreshold(-60),pauseProgress:0};

  sample(now:number, level:number|undefined):VadResult {
    if (!Number.isFinite(now) || level === undefined || !Number.isFinite(level)) return 'unavailable';
    if (this.last !== null && (now <= this.last || now-this.last > 500)) return 'unavailable';
    this.first ??= now;
    this.last=now;
    // Android reports -160 dB for zero amplitude; treat that as a quiet floor, not a broken meter.
    this.lastLevel=Math.max(-80,Math.min(0,level));
    if (!this.calibrated) {
      this.calibration.push(floorLevel(level));
      if (now-this.first<CALIBRATION_MS) {
        this.currentFeedback={phase:'calibrating',level:this.lastLevel,threshold:startThreshold(this.floor),pauseProgress:0};
        return 'calibrating';
      }
      const sorted=this.calibration.sort((a,b)=>a-b);
      this.floor=sorted[Math.floor(sorted.length/2)];
      this.calibration=[];
      this.calibrated=true;
      this.currentFeedback={phase:'listening',level:this.lastLevel,threshold:startThreshold(this.floor),pauseProgress:0};
      return 'listening';
    }
    const threshold=this.voiced?endThreshold(this.floor):startThreshold(this.floor);
    if (level >= threshold) {
      this.silence=null;
      this.activity ??= now;
      if (now-this.activity>=VOICE_MS) this.voiced=true;
    } else {
      this.activity=null;
      if (!this.voiced) this.floor=floorLevel(this.floor*0.9+floorLevel(level)*0.1);
      else this.silence ??= now;
    }
    const progress=this.silence===null?0:Math.min(1,(now-this.silence)/SILENCE_MS);
    this.currentFeedback={
      phase:this.silence!==null?'pause':this.voiced?'speaking':'listening',
      level:this.lastLevel,
      threshold:this.voiced?endThreshold(this.floor):startThreshold(this.floor),
      pauseProgress:progress,
    };
    if (this.silence!==null && progress>=1) return 'endpoint';
    if (!this.voiced && now-this.first>=NO_SPEECH_MS) return 'no-speech';
    return this.voiced?'speech':'listening';
  }
  feedback():VadFeedback {return this.currentFeedback;}
  hasSpeech(){return this.voiced;}
}
