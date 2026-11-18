export type VoiceCreateFlight={scope:string;owns:()=>boolean};
/** Tracks in-flight and uncertain creation only for its originating navigation. */
export class VoiceCreateFlights {
 private flight:VoiceCreateFlight|null=null;private unknown:string|null=null;
 begin(scope:string,owns:()=>boolean):VoiceCreateFlight|null {if(this.flight?.scope===scope || this.unknown===scope)return null;return this.flight={scope,owns};}
 current(flight:VoiceCreateFlight){return this.flight===flight && flight.owns();}
 markUnknown(flight:VoiceCreateFlight){if(this.current(flight))this.unknown=flight.scope;}
 finish(flight:VoiceCreateFlight){if(this.flight===flight)this.flight=null;}
}
