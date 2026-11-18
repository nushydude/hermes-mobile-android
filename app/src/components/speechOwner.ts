import { VoicePlayback } from "./voicePlayback";

/** One playback program; old leases cannot control a newer owner. */
export class SpeechOwner {
  private current: object | null = null;
  constructor(readonly playback: VoicePlayback) {}
  acquire() {
    const token = {};
    this.current = token;
    this.playback.stop();
    const owns = () => this.current === token;
    return {
      owns,
      play: (parts: string[], signal: AbortSignal) =>
        owns() ? this.playback.play(parts, signal) : Promise.resolve("stopped" as const),
      stop: () => {
        if (owns()) this.playback.stop();
      },
      toggle: () => {
        if (owns()) this.playback.toggle();
      },
      rewind: () => (owns() ? this.playback.rewind() : Promise.resolve()),
      speed: (speed: number) => {
        if (owns()) this.playback.speed(speed);
      },
      release: () => {
        if (owns()) {
          this.current = null;
          this.playback.stop();
        }
      },
    };
  }
  dispose() {
    this.current = null;
    this.playback.stop();
  }
}
export type SpeechLease = ReturnType<SpeechOwner["acquire"]>;

export const voiceLeaseValid = (lease: SpeechLease, scope: () => boolean) =>
  lease.owns() && scope();
