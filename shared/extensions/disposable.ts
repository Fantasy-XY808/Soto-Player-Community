/** 可释放资源句柄 */
export interface Disposable {
  dispose(): void;
}

/** 多个 Disposable 的聚合句柄，dispose 时倒序释放 */
export class CompositeDisposable implements Disposable {
  private readonly children: Disposable[] = [];
  private disposed = false;

  add(d: Disposable): void {
    if (this.disposed) {
      d.dispose();
      return;
    }
    this.children.push(d);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (let i = this.children.length - 1; i >= 0; i--) {
      this.children[i].dispose();
    }
    this.children.length = 0;
  }
}

/** 创建一个简单的 Disposable */
export const disposable = (fn: () => void): Disposable => ({ dispose: fn });
