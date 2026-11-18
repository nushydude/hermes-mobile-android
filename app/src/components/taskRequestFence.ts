/** Invalidates earlier result/refresh requests when selection or scope changes. */
export class TaskRequestFence {
  private version = 0;
  begin() {
    return ++this.version;
  }
  valid(token: number) {
    return token === this.version;
  }
  invalidate() {
    this.version++;
  }
}
export class TaskRequestFences {
  readonly refresh = new TaskRequestFence();
  readonly result = new TaskRequestFence();
  invalidate() {
    this.refresh.invalidate();
    this.result.invalidate();
  }
}
