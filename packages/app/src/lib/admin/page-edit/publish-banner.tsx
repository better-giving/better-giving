import { Button } from '@better-giving/operator/components/controls/Button';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import type { ReactNode } from 'react';
import { Form } from 'react-router';
import { recordVersion, whichForm } from '../use-admin-form';
import type { BannerState } from '$lib/page/edit-forms';
import { PUBLISH_FORM_ID, UNPUBLISH_FORM_ID } from '$lib/page/publish-form';
import { formRefusal, useScreenAnswer, useScreenWrite } from './section-card';

// the banner over a page's edit screen: where the page stands against what donors see, and the
// presses that move it. every section's Save writes the draft; donors see it only at Publish.
//
// - not public (never published, or unpublished): Publish, and Preview page, which opens the draft.
// - public, the draft as published: the address, Unpublish, and View live page.
// - public with saved changes donors do not see yet: Publish changes, Unpublish, View live page.
// - ended: the campaign's page shows its ended screen; Publish puts it back up as drafted.
//
// public is the done tone; the others are the attention tone, since something stands between the
// draft and donors. the Donation page is always public and has no Unpublish. the presses post to the
// screen's action ($lib/server/pages/publish.ts's `answerPublishPress`) against the version drawn.

type PublishBannerProps = {
	readonly state: BannerState;
	/** the page's version the screen was drawn at. */
	readonly version: number;
	/** what the page is called in the banner's words: "campaign", "Donation page". */
	readonly noun: 'campaign' | 'Donation page';
	/** where donors reach it, host included — `example.org/winter-coats`. */
	readonly address: string | null;
	/** the path the live page answers on. */
	readonly livePath: string | null;
	/** the preview route framing the draft. */
	readonly preview: string;
	/** Unpublish is offered. */
	readonly unpublishable: boolean;
};

const WORDS: Record<BannerState, (noun: PublishBannerProps['noun']) => string> = {
	not_public: (noun) => `Your ${noun} is not public yet`,
	public: (noun) => `Your ${noun} is public`,
	changed: () => 'Changes not public yet',
	ended: () => 'This campaign has ended'
};

export function PublishBanner({
	state,
	version,
	noun,
	address,
	livePath,
	preview,
	unpublishable
}: PublishBannerProps) {
	const { writing, posted } = useScreenWrite();
	const answer = useScreenAnswer();
	const refusal =
		formRefusal({ id: PUBLISH_FORM_ID }, answer) ?? formRefusal({ id: UNPUBLISH_FORM_ID }, answer);

	const press = (id: string, label: string, variant: 'primary' | 'default') => (
		<Form method="post" key={id}>
			<input {...whichForm(id)} />
			<input {...recordVersion(version)} />
			<Button
				type="submit"
				variant={variant}
				aria-busy={posted === id || undefined}
				aria-disabled={writing || undefined}
				onClick={(event) => {
					if (writing) event.preventDefault();
				}}
			>
				{label}
			</Button>
		</Form>
	);
	const open = (to: string, label: string) => (
		<Button as="a" href={to} target="_blank" rel="noopener" markAfter="external-link" key={label}>
			{label}
		</Button>
	);

	const actions: ReactNode[] = [];
	if (state === 'not_public') {
		actions.push(press(PUBLISH_FORM_ID, 'Publish', 'primary'), open(preview, 'Preview page'));
	} else if (state === 'changed') {
		actions.push(press(PUBLISH_FORM_ID, 'Publish changes', 'primary'));
	} else if (state === 'ended') {
		actions.push(press(PUBLISH_FORM_ID, 'Publish', 'primary'), open(preview, 'Preview page'));
	}
	if (unpublishable) actions.push(press(UNPUBLISH_FORM_ID, 'Unpublish', 'default'));
	if ((state === 'public' || state === 'changed') && livePath !== null) {
		actions.push(open(livePath, 'View live page'));
	}

	return (
		<div className="adm-stack adm-stack--tight">
			<Banner
				tone={state === 'public' ? 'done' : state === 'ended' ? 'note' : 'attention'}
				word={WORDS[state](noun)}
				actions={<div className="adm-actions">{actions}</div>}
			>
				{sentence(state, noun, address)}
			</Banner>
			<p role="status" className={refusal === null ? 'adm-vh' : undefined}>
				{refusal === null ? null : (
					<StatusWord register="momentary" blocked mark="circle-alert">
						{refusal}
					</StatusWord>
				)}
			</p>
		</div>
	);
}

function sentence(
	state: BannerState,
	noun: PublishBannerProps['noun'],
	address: string | null
): ReactNode {
	switch (state) {
		case 'not_public':
			return `Donors can’t see it. Everything you save stays in your draft until you publish.`;
		case 'public':
			return address === null ? 'Donors can see it.' : <>Donors can see it at {address}.</>;
		case 'changed':
			return `You’ve saved changes donors can’t see yet. They see the ${noun === 'campaign' ? 'campaign' : 'page'} as it was last published.`;
		case 'ended':
			return 'Its page shows that it has ended and takes no gifts.';
	}
}
