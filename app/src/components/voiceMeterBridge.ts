/** Filters cached hook values until this capture has produced advancing native recording samples. */
export type MeterSnapshot={isRecording:boolean;durationMillis:number;metering?:number};
export class VoiceMeterBridge {
  private baseline:MeterSnapshot|null=null; private previous:MeterSnapshot|null=null;
  private duration:number|null=null; private ready=false; private lastUpdate=0;
  begin(snapshot:MeterSnapshot,now:number){this.baseline=snapshot;this.previous=snapshot;this.duration=null;this.ready=false;this.lastUpdate=now;}
  sample(snapshot:MeterSnapshot,now:number):{now:number;level:number|undefined}|null {
    if(snapshot===this.baseline || snapshot===this.previous)return null;
    this.previous=snapshot;
    if(!snapshot.isRecording || !Number.isFinite(snapshot.durationMillis) || snapshot.durationMillis<=0)return null;
    if(this.duration===null || snapshot.durationMillis<=this.duration){this.duration=snapshot.durationMillis;return null;}
    this.duration=snapshot.durationMillis;this.ready=true;this.lastUpdate=now;return {now,level:snapshot.metering};
  }
  expired(now:number){return now-this.lastUpdate>(this.ready?700:1500);}
}
