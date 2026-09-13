import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import type { ReactNode } from 'react';
import type { AddressRead, ValuesRefusal, VarsWritten } from '../api/types';
import { Said } from './said';

// what a refused credentials write says, for every block on this surface that stores one.
//
// **three of the four sentences are the same wherever the press was, and one is not.** whether
// cloudflare turned this sign-in down, whether it was reachable at all, and what came back are
// facts about the machine and the account rather than about the errand — so they are written once
// here. a call that never landed is kept off that sentence entirely, because what failed was
// this machine's own request and cloudflare said none of it. where there was nowhere to write to,
// the sentence has to name what the press was trying to do, and that is the caller's:
// ../lib/sites-fold.tsx has nowhere to store a list, and ../lib/stripe-section.tsx has no address to
// register with stripe. so `nowhere` is handed in.
//
// it is a function returning the renderer rather than a component because `SecretGroupForm` takes
// this as a prop and calls it with the failure — it is a way of saying one thing, not a block on the
// page.

/**
 * the refusal inside a write's answer, or `null` where the write is not one.
 *
 * every press on this page writes through the one door and gets the whole of {@link VarsWritten}
 * back, and four of its arms are not a failure to report: two of them changed something or found
 * nothing to change, and `withheld` is a state the fold draws at the box it is about rather than as
 * a sentence about a write (./withheld-values.tsx). what is left is what these words are for.
 */
export const refusalIn = (written: VarsWritten): ValuesRefusal | null =>
	written.kind === 'set' ||
	written.kind === 'nothing' ||
	written.kind === 'unchanged' ||
	written.kind === 'withheld'
		? null
		: written;

/**
 * the renderer `SecretGroupForm`'s `trouble` wants, over one block's own account and worker.
 *
 * `nowhere` is the one arm the caller writes, and it is called with the address read that could not
 * be turned into somewhere to write.
 */
export const secretTrouble =
	({
		workerName,
		accountName,
		nowhere
	}: {
		workerName: string;
		accountName: string;
		nowhere: (address: AddressRead) => ReactNode;
	}) =>
	(written: ValuesRefusal): ReactNode =>
		written.kind === 'nowhere' ? (
			nowhere(written.address)
		) : (
			<>
				<FieldMessage>
					{written.kind === 'refused'
						? `Cloudflare won't let this sign-in write to ${workerName} in ${accountName}, so nothing was stored. Ask an administrator of that account for administrator access, or switch account.`
						: written.kind === 'unreachable'
							? 'This console could not reach Cloudflare, so nothing was stored. Check this machine’s connection, then try again.'
							: 'Nothing was stored, and this is what Cloudflare said:'}
				</FieldMessage>
				<Said answer={written} />
			</>
		);
