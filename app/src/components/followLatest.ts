export function isNearBottom(geometry: {
  contentOffset: { y: number };
  layoutMeasurement: { height: number };
  contentSize: { height: number };
}) {
  return (
    geometry.contentSize.height - geometry.layoutMeasurement.height - geometry.contentOffset.y < 100
  );
}
/** Owns follow-latest intent and invalidates stale animation-frame work. */
export class FollowLatest {
  private following = true;
  private dragging = false;
  private momentum = false;
  private prepending = false;
  private frame: number | null = null;
  private generation = 0;
  constructor(
    private schedule: (fn: () => void) => number,
    private cancel: (id: number) => void,
    private scroll: () => void,
  ) {}
  private invalidate() {
    this.generation++;
    if (this.frame !== null) this.cancel(this.frame);
    this.frame = null;
  }
  dragStart() {
    this.dragging = true;
    this.following = false;
    this.invalidate();
  }
  dragEnd(nearBottom = false) {
    this.dragging = false;
    if (nearBottom && !this.prepending) this.following = true;
  }
  momentumStart() {
    this.momentum = true;
    this.invalidate();
  }
  momentumEnd(nearBottom: boolean) {
    this.momentum = false;
    this.following = nearBottom && !this.prepending;
  }
  position(nearBottom: boolean) {
    if (!this.dragging && !this.momentum && !this.prepending && nearBottom) this.following = true;
    else if (!nearBottom) this.following = false;
  }
  prependStart() {
    this.prepending = true;
    this.following = false;
    this.invalidate();
  }
  prependEnd() {
    this.prepending = false;
  }
  jump() {
    this.invalidate();
    this.following = true;
    this.dragging = false;
    this.momentum = false;
    this.prepending = false;
    this.scroll();
  }
  changed() {
    if (!this.following || this.dragging || this.momentum || this.prepending || this.frame !== null)
      return;
    const generation = this.generation;
    this.frame = this.schedule(() => {
      this.frame = null;
      if (
        generation === this.generation &&
        this.following &&
        !this.dragging &&
        !this.momentum &&
        !this.prepending
      )
        this.scroll();
    });
  }
  dispose() {
    this.invalidate();
  }
}
