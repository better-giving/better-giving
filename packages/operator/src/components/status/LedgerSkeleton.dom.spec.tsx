import { type ComponentType, Suspense, act, use } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { render } from '../render.testing';
import { LedgerSkeleton, SkeletonStatus } from './LedgerSkeleton.jsx';

// what a reader who cannot see the placeholder is given: the wait, in words, and none of the bars
// standing in for lines that have not arrived.

/** the one status region under `root`. */
function region(root: HTMLElement): HTMLElement {
	const found = root.querySelectorAll<HTMLElement>('[role="status"]');
	if (found.length !== 1) throw new Error(`expected one status region, found ${found.length}`);
	return found[0] as HTMLElement;
}

/** a promise a case settles when it chooses. */
function reading(): { promise: Promise<string>; land: (said: string) => Promise<void> } {
	let settle: (said: string) => void = () => {};
	const promise = new Promise<string>((resolve) => {
		settle = resolve;
	});
	return {
		promise,
		land: async (said) => {
			await act(async () => settle(said));
		}
	};
}

/**
 * `mount` from ../render.testing, awaited: react leaves a suspended draw's passive effects — a
 * fallback's included — unflushed inside a synchronous `act`, so a case reading what a skeleton
 * caused has to wait the draw out.
 */
async function suspending<P extends object>(
	part: ComponentType<P>,
	props: P
): Promise<{ root: HTMLElement; again: (props: P) => Promise<void> }> {
	const root = document.createElement('div');
	document.body.append(root);
	const mounted = createRoot(root);
	const Part = part;
	const again = async (next: P): Promise<void> => {
		await act(async () => mounted.render(<Part {...next} />));
	};
	await again(props);
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return { root, again };
}

/** a task's worth of time, for the words written a task after what earned them. */
const aTaskLater = (): Promise<void> =>
	act(async () => {
		vi.advanceTimersByTime(0);
	});

type SectionProps = { answer: Promise<string> | null };

/** what a section draws: its words held over a boundary whose fallback is the skeleton. */
function Section({ answer }: SectionProps) {
	return (
		<SkeletonStatus label="Asking this deployment…">
			{answer === null ? null : (
				<Suspense fallback={<LedgerSkeleton blocks={[2, 1]} />}>
					<Answer answer={answer} />
				</Suspense>
			)}
		</SkeletonStatus>
	);
}

function Answer({ answer }: { answer: Promise<string> }) {
	return <p>{use(answer)}</p>;
}

describe('the words over a ledger skeleton', () => {
	beforeEach(() => {
		// the timers the words are written on, and only those: react's own scheduling stays real.
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('stands in the document before the reading suspends, and the skeleton brings no region of its own', async () => {
		// a live region reports a change to its contents and never its own arrival, so one inserted
		// with the fallback is one a reader commonly has not registered by the time its words land
		// (./ProgressBar.jsx's `MoveStatus` header).
		const section = await suspending<SectionProps>(Section, { answer: null });
		const standing = region(section.root);
		expect(standing.textContent).toBe('');

		await section.again({ answer: reading().promise });
		expect(section.root.querySelector('.adm-skeleton')).not.toBeNull();
		expect(region(section.root)).toBe(standing);
	});

	it('says the wait while the skeleton is drawn, a task after it, into the region already standing', async () => {
		const section = await suspending(Section, { answer: reading().promise });
		const standing = region(section.root);
		expect(standing.textContent).toBe('');

		await aTaskLater();
		expect(region(section.root)).toBe(standing);
		expect(standing.textContent).toBe('Asking this deployment…');
	});

	it('stops saying it once the reading lands, and is the same region after', async () => {
		const asked = reading();
		const section = await suspending(Section, { answer: asked.promise });
		await aTaskLater();
		const standing = region(section.root);

		await asked.land('Approved');
		await aTaskLater();

		expect(section.root.querySelector('.adm-skeleton')).toBeNull();
		expect(section.root.textContent).toContain('Approved');
		expect(region(section.root)).toBe(standing);
		expect(standing.textContent).toBe('');
	});

	it('keeps saying it, unbroken, where a second boundary takes the first one’s place', async () => {
		// the PayPal and Stripe screens wait on two readings, the second boundary inside the first
		// (packages/console-ui/src/lib/paypal-section.tsx), so one skeleton is taken down in the
		// commit the other is drawn in.
		const first = reading();
		const second = reading();
		function Inner() {
			use(first.promise);
			return (
				<Suspense fallback={<LedgerSkeleton blocks={[2]} />}>
					<Answer answer={second.promise} />
				</Suspense>
			);
		}
		function Nested() {
			return (
				<SkeletonStatus label="Asking this deployment…">
					<Suspense fallback={<LedgerSkeleton blocks={[2]} />}>
						<Inner />
					</Suspense>
				</SkeletonStatus>
			);
		}
		const section = await suspending(Nested, {});
		await aTaskLater();
		const standing = region(section.root);

		await first.land('');
		expect(section.root.querySelectorAll('.adm-named')).toHaveLength(1);
		expect(standing.textContent).toBe('Asking this deployment…');
		await aTaskLater();
		expect(standing.textContent).toBe('Asking this deployment…');

		await second.land('Approved');
		await aTaskLater();
		expect(region(section.root)).toBe(standing);
		expect(standing.textContent).toBe('');
	});

	it('says nothing over a reading that lands before a task has passed', async () => {
		const section = await suspending(Section, { answer: Promise.resolve('Approved') });

		await aTaskLater();
		expect(section.root.textContent).toContain('Approved');
		expect(region(section.root).textContent).toBe('');
	});

	it('speaks through its contents and not through a name a region never announces', async () => {
		const section = await suspending(Section, { answer: reading().promise });

		expect(region(section.root).hasAttribute('aria-label')).toBe(false);
	});
});

describe('a ledger skeleton', () => {
	it('is no live region: its words are the status held over it', () => {
		const root = render(LedgerSkeleton, { blocks: [2, 1] });

		expect(root.querySelectorAll('[role="status"]')).toHaveLength(0);
		expect(root.textContent).toBe('');
	});

	it('hides every bar it draws from the tree', () => {
		const root = render(LedgerSkeleton, { blocks: [2, 1] });
		const bars = [...root.querySelectorAll('.adm-skeleton')];

		// a heading per block, and a mark, a label and a sentence per line: two blocks, three lines.
		expect(bars).toHaveLength(2 + 3 * 3);
		for (const bar of bars) expect(bar.closest('[aria-hidden="true"]')).not.toBeNull();
	});

	it('draws a block per entry, holding the lines that entry counts', () => {
		const root = render(LedgerSkeleton, { blocks: [4, 1] });
		const counts = [...root.querySelectorAll('.adm-named')].map(
			(block) => block.querySelectorAll('.adm-ledger > li').length
		);

		expect(counts).toEqual([4, 1]);
	});
});
