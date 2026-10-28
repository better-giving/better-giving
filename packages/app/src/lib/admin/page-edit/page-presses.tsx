import { Button } from '@better-giving/operator/components/controls/Button';
import { Section } from '@better-giving/operator/components/shell/Layout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { useState } from 'react';
import { useSubmit } from 'react-router';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import { DISCARD_FORM_ID, RESET_FORM_ID } from '$lib/page/publish-form';
import { DiscardConfirm, ResetConfirm } from './confirms';
import { formRefusal, useScreenAnswer, useScreenWrite } from './section-card';

// the presses on a whole page that ask first: Discard changes, which puts the draft back to the
// live page, and the Donation page's Reset to default. each posts to the screen's action under its
// form id ($lib/page/publish-form.ts) against the version the screen was drawn at, from its card.

/** a press posting `id` and nothing else, against `version`. */
function usePagePress(id: string, version: number) {
	const submit = useSubmit();
	const { posted } = useScreenWrite();
	const answer = useScreenAnswer();
	return {
		busy: posted === id,
		refusal: formRefusal({ id }, answer),
		press: () => {
			const body = new FormData();
			body.set(WHICH_FORM, id);
			body.set(RECORD_VERSION, String(version));
			submit(body, { method: 'post' });
		}
	};
}

/**
 * the notice in the cards' place over a draft the read rule refuses ($lib/server/pages/document.ts),
 * with Discard changes where the live page reads.
 */
export function UnreadableDraft({
	version,
	discardable,
	noun
}: {
	readonly version: number;
	readonly discardable: boolean;
	readonly noun: 'a campaign' | 'the Donation page';
}) {
	const [asking, setAsking] = useState(false);
	const discard = usePagePress(DISCARD_FORM_ID, version);
	return (
		<>
			<Banner
				tone="blocker"
				word="This draft can’t be read"
				actions={
					discardable ? (
						<Button type="button" variant="danger" onClick={() => setAsking(true)}>
							Discard changes
						</Button>
					) : undefined
				}
			>
				{discardable
					? `It holds something ${noun} can no longer hold. Discard changes to go back to the live page.`
					: `It holds something ${noun} can no longer hold, and there is no live page to go back to.`}
			</Banner>
			{asking ? (
				<DiscardConfirm
					discarding={discard.busy}
					onDiscard={discard.press}
					onCancel={() => setAsking(false)}
					refusal={discard.refusal}
				/>
			) : null}
		</>
	);
}

/** the Donation page's Reset to default, offered while it holds edits to reset. */
export function ResetCard({ version }: { readonly version: number }) {
	const [asking, setAsking] = useState(false);
	const reset = usePagePress(RESET_FORM_ID, version);
	return (
		<Section card>
			<h2>Reset to default</h2>
			<p className="adm-prose">
				Puts the draft and the published page at /donate back to how they started.
			</p>
			<div className="adm-actions">
				<Button type="button" variant="danger" onClick={() => setAsking(true)}>
					Reset to default
				</Button>
			</div>
			{asking ? (
				<ResetConfirm
					resetting={reset.busy}
					onReset={reset.press}
					onCancel={() => setAsking(false)}
					refusal={reset.refusal}
				/>
			) : null}
		</Section>
	);
}
