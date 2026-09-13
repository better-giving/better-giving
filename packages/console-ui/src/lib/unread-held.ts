import type { VarsRead, VarsWritten } from '../api/types';

// a press read against what the deployment is holding, whose read did not land. the home page's
// credentials groups and the Stripe screen's keys both decide their act against that read
// (../routes/_index.tsx, ../routes/payments_.stripe.tsx), so both refuse the press in these words.

/**
 * a read of what the deployment is holding that did not land, as the write it refused.
 *
 * in the binary's own write vocabulary rather than the read's, because what the operator pressed
 * was a write and each of them has a sentence and a way out for each of these already
 * (./secret-trouble.tsx). the two that leave nowhere to write to are handed on as the address
 * that says which, which is what `SetVars` in `packages/console/internal/deployment` answers a
 * refused write with.
 */
export const unreadHeld = (read: Exclude<VarsRead, { kind: 'read' }>): VarsWritten =>
	read.kind === 'not-deployed'
		? { kind: 'nowhere', address: { kind: 'not-deployed' } }
		: read.kind === 'no-credential'
			? { kind: 'nowhere', address: { kind: 'no-credential', detail: read.detail } }
			: read.kind === 'refused'
				? { kind: 'refused', detail: read.detail }
				: read.kind === 'unreachable'
					? { kind: 'unreachable', detail: read.detail }
					: { kind: 'failed', detail: read.detail };
