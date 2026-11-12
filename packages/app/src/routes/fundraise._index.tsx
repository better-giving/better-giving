import { createChallenge } from '@better-giving/form/embed/challenge';
import type { FormConfig } from '@better-giving/form/v1';
import { useEffect, useRef, useState } from 'react';
import { href, redirect } from 'react-router';
import { defineForm } from '$lib/forms/definition';
import { CHALLENGE_FIELD, INTENTS, PHOTO_FILE_FIELD, START_FORM } from '$lib/supporter/area/forms';
import { supporterAreaLinks } from '$lib/supporter/area/links';
import { StartFundraiser } from '$lib/supporter/area/start-form';
import { usePosting } from '$lib/supporter/area/use-posting';
import { challengeKind } from '$lib/server/api/challenge';
import { refuseWriteFromAnotherOrigin } from '$lib/server/auth/gate';
import { invalid, parseForm, unread } from '$lib/server/conform';
import { redirectWithFlash, SUPPORTER_SENT_FLASH } from '$lib/server/flash';
import { readPostedBody } from '$lib/server/images/intake';
import { supporterFundraisersEnabled } from '$lib/server/org/queries';
import { linkMailer, readSupporterOrg, startChallenge } from '$lib/server/supporters/area';
import { startFundraiser } from '$lib/server/supporters/start';
import { database, platform } from '../context';
import type { SupporterPolicyHandle } from '../document-policy';
import type { Route } from './+types/fundraise._index';

// Start a fundraiser: the form a member of the public makes a page with, or, while the organisation
// has switched fundraisers off, the card saying so. a start posts `intent=start` here; the page,
// its supporter and its confirm link are $lib/server/supporters/start.ts's, and the link goes out
// after the answer. a start that lands goes on to /fundraise/sent, the address it was mailed to
// carried in a flash ($lib/server/flash.ts) and never in the address bar.
//
// a starter has no session, so the cropped photo travels with the start as its `PHOTO_FILE_FIELD`
// part rather than through /fundraise/photo. the body is read once, no further than the photo
// intake's cap (`readPostedBody` in $lib/server/images/intake.ts), and the photo is checked and
// stored by the start only once the limit and the spam check have passed.
//
// the spam check is the one a donation runs, Turnstile where both its keys are set and ALTCHA
// otherwise, drawn by the donation form's own widget (`createChallenge` in
// `@better-giving/form/embed/challenge`) and checked against this deployment's own host. an ALTCHA
// challenge belongs to no form ($lib/server/api/altcha.ts), and the challenge address issues one
// for an id no form holds (./api.v1.forms.$id.challenge.ts), so the widget reads it at a fixed id
// and the loader writes nothing: the Donation page is made only where AGENTS.md → Runtime says.

/** the screen's form as the action parses it: the one `StartFundraiser` mounts. */
const START = defineForm({ id: START_FORM.id, schema: START_FORM.schema });

/** the two values the widget reads off a served config to pick its check and draw it. */
type ChallengeConfig = Pick<FormConfig, 'turnstileSiteKey' | 'altchaChallengeUrl'>;

const ALTCHA_CHALLENGE_URL = href('/api/v1/forms/:id/challenge', { id: 'fundraise' });

export async function loader({ context }: Route.LoaderArgs) {
	const db = context.get(database);
	const { env } = context.get(platform);
	const [org, open] = await Promise.all([readSupporterOrg(db), supporterFundraisersEnabled(db)]);
	const challenge: ChallengeConfig | null = !open
		? null
		: challengeKind(env) === 'turnstile'
			? { turnstileSiteKey: (env.TURNSTILE_SITE_KEY ?? '').trim() }
			: { altchaChallengeUrl: ALTCHA_CHALLENGE_URL };
	return { org, open, challenge };
}

export async function action({ context, request }: Route.ActionArgs) {
	refuseWriteFromAnotherOrigin(request);
	const db = context.get(database);
	const { env, deferred } = context.get(platform);
	const posted = await readPostedBody(request);
	if (!posted.ok) {
		return invalid(400, unread(START, posted.error), { refused: 'photo_missing' as const });
	}
	const { body } = posted;
	const submission = parseForm(body, START);
	if (!submission.ok) return invalid(400, submission.reject(), { refused: null });

	const started = await startFundraiser(
		{
			db,
			limiter: env.SIGN_IN_RATE_LIMITER,
			defer: (work) => deferred.waitUntil(work),
			sendLink: linkMailer(db, env),
			checkChallenge: startChallenge(env, request, body.get(CHALLENGE_FIELD)),
			now: new Date()
		},
		request,
		submission.value,
		body.get(PHOTO_FILE_FIELD)
	);
	if (started.ok) {
		return redirectWithFlash(
			request,
			SUPPORTER_SENT_FLASH,
			href('/fundraise/sent'),
			`start ${started.pageId} ${submission.value.email}`
		);
	}
	switch (started.reason) {
		// switched off since the form was drawn: the screen it is drawn again as says so.
		case 'closed':
			return redirect(href('/fundraise'), 303);
		case 'too_many':
			return invalid(429, submission.reject(), { refused: started.reason });
		case 'challenge_unavailable':
			return invalid(500, submission.reject(), { refused: started.reason });
		case 'challenge_failed':
		case 'photo_missing':
			return invalid(400, submission.reject(), { refused: started.reason });
	}
}

export const handle: SupporterPolicyHandle = { documentPolicy: 'photo-and-challenge' };

export function meta(): Route.MetaDescriptors {
	return [{ title: 'Start a fundraiser' }];
}

export function links(): Route.LinkDescriptors {
	return supporterAreaLinks();
}

export default function StartRoute({ loaderData, actionData }: Route.ComponentProps) {
	const { org, open, challenge } = loaderData;
	return (
		<StartFundraiser
			org={org}
			open={open}
			donateHref={href('/donate')}
			signInHref={href('/fundraise/sign-in')}
			lastResult={actionData?.form.result}
			refused={actionData?.refused}
			sending={usePosting(INTENTS.start)}
			challenge={
				challenge === null ? undefined : <ChallengeBox config={challenge} answer={actionData} />
			}
		/>
	);
}

/**
 * the donation form's spam check, drawn into the start form with its answer in `CHALLENGE_FIELD`.
 * a token or a payload clears one post, so each new `answer` from the action starts another.
 */
function ChallengeBox({
	config,
	answer
}: {
	readonly config: ChallengeConfig;
	readonly answer: unknown;
}) {
	const mount = useRef<HTMLDivElement>(null);
	const widget = useRef<ReturnType<typeof createChallenge> | null>(null);
	const [token, setToken] = useState('');
	useEffect(() => {
		const node = mount.current;
		if (node === null) return;
		// the widget reads these two of a served config and nothing else (`createChallenge` in
		// packages/form/src/embed/challenge.ts and ./turnstile.ts).
		const started = createChallenge(config as FormConfig, node, setToken, () => setToken(''), {
			configUrl: node.ownerDocument.URL
		});
		widget.current = started;
		return () => {
			started.stop();
			widget.current = null;
		};
	}, [config]);
	useEffect(() => {
		if (answer === undefined) return;
		setToken('');
		widget.current?.reset();
	}, [answer]);
	return (
		<>
			<div ref={mount} />
			<input type="hidden" name={CHALLENGE_FIELD} value={token} />
		</>
	);
}
