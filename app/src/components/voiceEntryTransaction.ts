import { cancelVoiceEntry, reserveVoiceEntry, targetVoiceEntry } from "./newSessionIntent";
type Scope = { epoch: number; origin: string; revision: number; session: string | null };
/** A create/open owns only the navigation revision it most recently activated. */
export class VoiceEntryTransaction {
  readonly token: object;
  private revision: number;
  constructor(
    private readonly epoch: number,
    private readonly origin: string,
    private readonly scope: () => Scope,
  ) {
    this.revision = scope().revision;
    this.token = reserveVoiceEntry(epoch, origin);
  }
  owns = () => {
    const s = this.scope();
    return s.epoch === this.epoch && s.origin === this.origin && s.revision === this.revision;
  };
  activated = (revision: number) => {
    this.revision = revision;
  };
  publish = (target: string) => {
    const s = this.scope();
    if (!this.owns() || s.session !== target) {
      this.cancel();
      return false;
    }
    targetVoiceEntry(this.token, target, this.revision);
    return true;
  };
  cancel = () => cancelVoiceEntry(this.token);
}
