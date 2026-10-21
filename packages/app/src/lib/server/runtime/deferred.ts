// work that finishes after the response has gone: a cache write behind a miss, a mail the answer
// does not wait on. the process owns one tracker, created by the server entry, so that shutdown can
// wait for what is still running before the database closes under it.

/** what a request may hand work to. the work's result is dropped, and a throw is logged. */
export interface Deferred {
	waitUntil(work: Promise<unknown>): void;
}

/** the process's tracker: `Deferred`, plus what shutdown reads. */
export interface DeferredWork extends Deferred {
	/** how many handed-over promises have not settled yet. */
	pending(): number;
	/**
	 * resolves once every promise handed over — including ones handed over while waiting — has
	 * settled. never rejects.
	 */
	settled(): Promise<void>;
}

export function createDeferredWork(
	log: (error: unknown) => void = (error) => console.error('deferred work threw', error)
): DeferredWork {
	const running = new Set<Promise<void>>();

	return {
		waitUntil(work) {
			const tracked: Promise<void> = work.then(
				() => {},
				(error: unknown) => log(error)
			);
			running.add(tracked);
			void tracked.finally(() => running.delete(tracked));
		},
		pending: () => running.size,
		async settled() {
			while (running.size > 0) await Promise.allSettled([...running]);
		}
	};
}
