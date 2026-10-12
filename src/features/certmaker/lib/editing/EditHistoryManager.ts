/** Unlimited session history. Immutable snapshots share unchanged artwork strings. No disk persistence. */
export class EditHistoryManager<T> {
  private entries: T[];
  private cursor = 0;
  constructor(initial: T) {
    this.entries = [initial];
  }
  get present(): T {
    return this.entries[this.cursor]!;
  }
  get canUndo() {
    return this.cursor > 0;
  }
  get canRedo() {
    return this.cursor < this.entries.length - 1;
  }
  get position() {
    return this.cursor;
  }
  get length() {
    return this.entries.length;
  }
  commit(next: T): T {
    if (Object.is(next, this.present)) return this.present;
    this.entries = this.entries.slice(0, this.cursor + 1);
    this.entries.push(next);
    this.cursor++;
    return next;
  }
  undo(): T {
    if (this.canUndo) this.cursor--;
    return this.present;
  }
  redo(): T {
    if (this.canRedo) this.cursor++;
    return this.present;
  }
  rollback(position: number): T {
    if (!Number.isInteger(position) || position < 0 || position >= this.entries.length)
      throw new Error("Invalid history position.");
    this.cursor = position;
    return this.present;
  }
  reset(next: T) {
    this.entries = [next];
    this.cursor = 0;
  }
}
