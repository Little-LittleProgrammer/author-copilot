export class ProjectOperationQueue {
  private readonly queues = new Map<string, Promise<void>>();

  public async run<T>(
    projectId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const predecessor = this.queues.get(projectId) ?? Promise.resolve();
    let release = (): void => undefined;
    const current = new Promise<void>((resolveLock) => {
      release = resolveLock;
    });
    const queued = predecessor.then(() => current);
    this.queues.set(projectId, queued);
    await predecessor;
    try {
      return await operation();
    } finally {
      release();
      if (this.queues.get(projectId) === queued) this.queues.delete(projectId);
    }
  }
}
