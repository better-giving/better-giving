import { getFormProps } from '@conform-to/react';
import { useEffect, useRef, useState } from 'react';
import { Form } from 'react-router';
import { NoticeCard } from './cards';
import { TextField } from './field';
import { INTENT, INTENTS, SIGN_IN_FORM } from './forms';
import { Mark } from './glyph';
import { SupporterShell, type SupporterOrg } from './shell';
import { boxOf, type FormResult, useSupporterForm } from './use-supporter-form';

// the screens between a supporter and their own pages, none of which says whether an address has a
// fundraiser here: Check your email after a start or a sign-in request, the sign-in request itself,
// the one refusal an expired, used or unknown link gets, and the limit a caller or an address hits.
// every post is an ordinary form post to the route standing here: `request-link` from the email box,
// `resend` from Send it again.

/** how long Send it again stays closed after a resend. */
export const RESEND_WAIT_SECONDS = 60;

/** `0:42`. */
const clock = (seconds: number) =>
	`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export type CheckEmailProps = {
	readonly org: SupporterOrg;
	/** the address the link went to, as the supporter typed it. */
	readonly email: string;
	/** `start` after Create my page, `sign-in` after Email me a link: what the link does. */
	readonly kind: 'start' | 'sign-in';
	/** "Use a different address": the form the supporter came from. */
	readonly differentAddressHref: string;
	/**
	 * when the last resend landed (ms since the epoch, the route's clock), or null before one. each
	 * new value closes Send it again for a minute and says the older link stopped working.
	 */
	readonly resentAt: number | null;
	/** while a resend is in flight. */
	readonly sending: boolean;
};

/** "Check your email": the step after a start and after a sign-in request. */
export function CheckEmail({
	org,
	email,
	kind,
	differentAddressHref,
	resentAt,
	sending
}: CheckEmailProps) {
	const heading = useRef<HTMLHeadingElement>(null);
	// the heading takes focus when this screen arrives, so a screen reader starts at it.
	useEffect(() => heading.current?.focus(), []);
	const left = useCountdown(resentAt);
	const waiting = left > 0;
	return (
		<SupporterShell org={org}>
			<section className="sa-plane sa-form sa-narrow" aria-labelledby="check-email-heading">
				<span className="sa-tile">
					<Mark name="mail" />
				</span>
				<h1 className="sa-h1-sm" id="check-email-heading" ref={heading} tabIndex={-1}>
					Check your email
				</h1>
				{kind === 'start' ? (
					<p>
						We sent a link to <b>{email}</b>. Open it to publish your page. It works once and
						expires in an hour.
					</p>
				) : (
					<p>
						If <b>{email}</b> has a fundraiser here, a link is on its way. It works once and expires
						in an hour.
					</p>
				)}
				<Form method="post" className="sa-row">
					<input type="hidden" name={INTENT} value={INTENTS.resend} />
					<input type="hidden" name="email" value={email} />
					<button
						type="submit"
						className="ds-btn ds-btn-secondary"
						disabled={waiting}
						aria-busy={sending || undefined}
					>
						{waiting ? `Send again in ${clock(left)}` : 'Send it again'}
					</button>
					<a className="sa-link" href={differentAddressHref}>
						Use a different address
					</a>
				</Form>
				<p className="sa-quiet" role="status">
					{resentAt === null
						? kind === 'start'
							? 'Nothing in your inbox? Check your spam folder. Your page isn’t public until you open the link.'
							: null
						: 'Sent again. The newest link is the one that works.'}
				</p>
			</section>
		</SupporterShell>
	);
}

/** the whole seconds left of the wait that began when `startedAt` changed, counting down to 0. */
function useCountdown(startedAt: number | null): number {
	const [left, setLeft] = useState(0);
	useEffect(() => {
		if (startedAt === null) return;
		const began = Date.now();
		const tick = () => {
			const gone = Math.floor((Date.now() - began) / 1000);
			setLeft(Math.max(0, RESEND_WAIT_SECONDS - gone));
		};
		tick();
		const every = setInterval(tick, 1000);
		const done = setTimeout(() => clearInterval(every), RESEND_WAIT_SECONDS * 1000);
		return () => {
			clearInterval(every);
			clearTimeout(done);
		};
	}, [startedAt]);
	return left;
}

/**
 * what the sign-in screen stands in: the request, its answer, a link that no longer opens, or the
 * limit reached.
 */
export type SignInState =
	| { readonly kind: 'ask' }
	| { readonly kind: 'expired' }
	| { readonly kind: 'too-many'; readonly email: string };

export type SignInProps = {
	readonly org: SupporterOrg;
	readonly state: SignInState;
	/** the email box's result from a refused post. */
	readonly lastResult?: FormResult;
	readonly sending: boolean;
};

/** /fundraise/sign-in, and the screen an expired or used link lands on. */
export function SignIn({ org, state, lastResult, sending }: SignInProps) {
	const [form, fields] = useSupporterForm(
		SIGN_IN_FORM,
		lastResult,
		state.kind === 'too-many' ? { email: state.email } : undefined
	);
	const closed = state.kind === 'too-many';
	const box = (
		<Form method="post" {...getFormProps(form)} className="sa-plane sa-form">
			{state.kind === 'ask' ? (
				<>
					<h1 className="sa-h1-sm">Manage your fundraisers</h1>
					<p>Enter the email you used to start your page. We’ll send you a link.</p>
				</>
			) : null}
			<input type="hidden" name={INTENT} value={INTENTS.requestLink} />
			<TextField
				box={boxOf(fields.email)}
				label="Email"
				type="email"
				autoComplete="email"
				placeholder="maya@example.org"
			/>
			<button
				type="submit"
				className="ds-btn ds-btn-primary ds-btn-lg ds-btn-sentence"
				disabled={closed}
				aria-busy={sending || undefined}
			>
				{state.kind === 'ask' ? 'Email me a link' : 'Send a new link'}
			</button>
			{state.kind === 'ask' ? (
				<p className="sa-quiet">No password. The link works once and expires in an hour.</p>
			) : null}
		</Form>
	);
	return (
		<SupporterShell org={org}>
			<div className="sa-narrow sa-stack">
				{state.kind === 'expired' ? (
					<NoticeCard tone="warning" heading="h1" title="That link has expired or was already used">
						Sign-in links work once and last an hour. Enter your email and we’ll send a new one.
					</NoticeCard>
				) : state.kind === 'too-many' ? (
					<NoticeCard tone="destructive" heading="h1" title="Too many tries" alert>
						Wait a few minutes, then ask for a new link.
					</NoticeCard>
				) : null}
				{box}
			</div>
		</SupporterShell>
	);
}
