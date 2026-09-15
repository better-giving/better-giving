import { type AskProps, AskHost, useAsk } from '@better-giving/operator/behaviour/Ask';
import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { Button } from '@better-giving/operator/components/controls/Button';
import { useState } from 'react';

/*
 * a question awaited as a value: the press asks a card, the card answers, and what it answered is
 * drawn beside the press.
 *
 * the host is mounted here rather than at the page's root because this is the one preview that
 * asks; a screen mounts it once, at its root. the card is ./behaviour-dialog.tsx's `Modal` and
 * nothing else — packages/operator/src/behaviour/Ask.tsx draws no markup of its own — so what is
 * worth pressing is the three ways it settles: either answer, and Escape or a press on the ground,
 * which answers nothing.
 */

type Cadence = 'once' | 'monthly';

function CadenceCard({ resolve }: AskProps<Cadence>) {
	return (
		<Modal
			title="How often should this gift repeat?"
			onDismiss={() => resolve()}
			cancel="Just once"
			cancelProps={{ type: 'button' as const, onClick: () => resolve('once') }}
			exit="Every month"
			exitProps={{ type: 'button' as const, onClick: () => resolve('monthly') }}
		>
			<p>A monthly gift is charged on the same day each month until the donor cancels it.</p>
		</Modal>
	);
}

export default function BehaviourAskPreview() {
	const ask = useAsk();
	const [answer, setAnswer] = useState<Cadence | 'dismissed' | null>(null);

	return (
		<div className="adm-stack">
			<div className="adm-actions">
				<Button
					onClick={() => {
						void ask<Cadence>(CadenceCard).then((said) => setAnswer(said ?? 'dismissed'));
					}}
				>
					Ask how often
				</Button>
			</div>
			<p>
				{answer === null
					? 'Nothing asked yet.'
					: answer === 'dismissed'
						? 'Dismissed, so nothing was answered.'
						: `Answered: ${answer}.`}
			</p>
			<AskHost />
		</div>
	);
}
