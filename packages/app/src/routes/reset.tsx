import { MIN_ADMIN_PASSWORD_LENGTH } from '@better-giving/operator/admin-password';
import { Button } from '@better-giving/operator/components/controls/Button';
import { Field } from '@better-giving/operator/components/forms/Field';
import { PanelRoute } from '@better-giving/operator/components/shell/AppShell';
import { Stack } from '@better-giving/operator/components/shell/Layout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { getFormProps } from '@conform-to/react';
import type { ReactNode } from 'react';
import { Form, Link, useNavigation } from 'react-router';
import { z } from 'zod';
import { operatorLinks } from '$lib/admin/operator-links';
import { boxProps, useAdminForm } from '$lib/admin/use-admin-form';
import { defineForm } from '$lib/forms/definition';
import { createAuth, readAuthEnv, resetMemberPassword } from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import { readSetupState } from '$lib/server/config/setup-state';
import { invalid, parseForm } from '$lib/server/conform';
import { PASSWORD_RESET_FLASH, redirectWithFlash } from '$lib/server/flash';
import { database, platform } from '../context';
import type { Route } from './+types/reset';

// the page a mailed reset link opens, and the fourth write this deployment serves to a caller with
// no session.
//
// it is outside ./_app.tsx deliberately and ../routes.spec.ts is what holds that to a line
// somebody typed: the file is on `PUBLIC_ROUTE_FILES` with the reason beside it. what stands in
// for a session is the token in the link — single-use, an hour, and checked before anything is
// written ($lib/server/auth/members.ts).
//
// it charges nothing, exactly as ./join.tsx charges nothing. the sign-in bucket bounds guessing at
// a credential, and a random token from a mailbox is not a value anybody guesses at; the press
// that mints one is bounded instead, at ./forgot.tsx.
//
// being outside every layout is also why this module builds its own auth instance rather than
// taking the gate's off the request context, exactly as ./login.tsx and ./join.tsx do: nothing
// above this route resolves one. it is built without a `passwordReset` runtime, because nothing
// here sends anything — that half belongs to ./forgot.tsx alone.
//
// **the token is never rendered and never echoed.** it stays on the address bar, where the mail
// put it. the form posts to this same url with no `action` attribute, so the token travels with
// the submission without this module writing it into the page.
//
// **the token is not checked at GET, and the screen says so by asking anyway.** better-auth's
// `auth.api` exposes no read of a reset token — the pair is request and consume — so a link is
// proven by the press and by nothing before it. an address carrying no token at all is the one
// thing this loader can answer for itself, and it answers with the same banner the refused press
// draws.

/** the screen's name, rendered as the document title and as the heading. */
const SCREEN_TITLE = 'Choose a new password';

/** the parameter the reset mail puts the token in, written into the link by ./forgot.tsx. */
const TOKEN_PARAM = 'token';

/** what an empty box and a box the request did not carry are both told. */
const MISSING = 'required';

/**
 * cap on what one anonymous POST here can ask to be hashed.
 *
 * better-auth's own maximum is 128 and this matches it rather than sitting above it, for
 * ./join.tsx's reason: a value past the cap is refused by the schema, under the box, instead of
 * coming back as the auth layer's `PASSWORD_TOO_LONG` with nothing on the screen saying which box
 * it was about.
 */
const MAX_PASSWORD_LENGTH = 128;

/**
 * the form a member chooses their new password with.
 *
 * `withheld` is not a choice — a schema naming `password` makes it a required property, and an
 * empty list is refused when the form is stated ($lib/server/conform.ts's header argues it).
 *
 * the password is not trimmed, for the reason ./login.tsx and ./join.tsx give: a leading or
 * trailing space is a character of the secret, and quietly removing one turns a correct paste into
 * a password that will not sign them in tomorrow.
 *
 * the minimum is `@better-giving/operator`'s rather than the auth module's, and it is the same
 * number by construction — `MEMBER_PASSWORD_MIN_LENGTH` is that constant imported. it has to come
 * from the leaf package because this statement is read in the browser too, and nothing under
 * `$lib/server/**` may be.
 *
 * one box and no address beside it: the account is the token's, so there is nothing for a body to
 * name and nothing this screen has to state.
 */
const RESET_FORM = defineForm({
	id: 'reset',
	withheld: ['password'],
	schema: z.object({
		password: z
			.string({ error: MISSING })
			.min(MIN_ADMIN_PASSWORD_LENGTH, {
				error: `must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`
			})
			.max(MAX_PASSWORD_LENGTH, { error: `must be at most ${MAX_PASSWORD_LENGTH} characters` })
	})
});

/** what the member is told the box wants before they have typed in it. */
const PASSWORD_HINT = `At least ${MIN_ADMIN_PASSWORD_LENGTH} characters.`;

/** what a link that no longer works says, whether it expired, was used, or was never minted. */
const LINK_DEAD = 'This link has expired or was already used.';

/**
 * what a refusal that is about the deployment says.
 *
 * the same shape ./join.tsx's is and for the same reason: the auth layer's own message is written
 * for an agent reading a status body and belongs on the surfaces an operator controls, so what an
 * anonymous POST gets is the pointer rather than the answer.
 */
const UNAVAILABLE =
	'Your password could not be changed: something is wrong with this deployment rather than ' +
	'with what you typed. Ask whoever runs it to check the console (`better-giving start`); the ' +
	'exact cause is in the deployment’s logs, which the console does not read.';

/**
 * what a deployment whose schema is not there says.
 *
 * no `auth_signing_key` row to build an auth instance with, which is what a fresh fork hits. the
 * sentence is written for the member and points at the person who can fix it, because they cannot.
 */
const NOT_MIGRATED =
	'Your password could not be changed: this deployment’s database has not been set up. Ask ' +
	'whoever runs it to open the console (`better-giving start`) and update the deployment.';

export const links = operatorLinks;

export function meta(): Route.MetaDescriptors {
	return [{ title: SCREEN_TITLE }];
}

export async function loader({ context, url }: Route.LoaderArgs) {
	// which deployment this is. /reset sits outside ./_app.tsx, so the name the identity band
	// carries never reaches this page, and a page asking for a password that cannot say whose it is
	// looks the same on every fork.
	//
	// the registered name and nothing else off that row, and a failure swallowed to a null name:
	// both are ./join.tsx's decisions, and this page is served to anyone holding a link too.
	const state = await readSetupState(context.get(database), context.get(platform).env);
	const orgName = state?.profile?.legalName ?? null;

	if (!url.searchParams.get(TOKEN_PARAM)) return { shape: 'dead' as const, orgName };

	return { shape: 'form' as const, orgName };
}

/**
 * the reset: one password, against the account the token names.
 *
 * **the request body is read exactly once, here, by the action that owns it** — `parseForm` reads
 * what it returns and nothing above this route may.
 *
 * **no session is minted and none is copied onto the redirect.** every session the account held is
 * gone by the time this returns, which is `resetMemberPassword`'s decision and argued there — so
 * the member signs in with what they just chose, and the flash is the whole of what travels.
 */
export async function action({ context, request, url }: Route.ActionArgs) {
	const db = context.get(database);
	const authEnv = readAuthEnv(context.get(platform).env);

	const submission = parseForm(await request.formData(), RESET_FORM);

	// a blank box and one outside the bounds are both rejections the box itself explains, and both
	// are refused before the token is spent: a link is a credential and there is no reason to spend
	// one answering a form that is not filled in.
	if (!submission.ok) return invalid(400, submission.reject());

	const signingKey = await resolveAuthSecret(db, authEnv);
	if (!signingKey.ok) {
		console.error('a password could not be reset — no signing key:', signingKey.message);
		return invalid(500, submission.reject({ formErrors: [NOT_MIGRATED] }));
	}

	// the origin is passed rather than configured: `createAuth` derives the trusted-origin list and
	// the cookie `Secure` policy from it, so a deployment answers correctly on workers.dev and on a
	// custom domain without a deploy-time variable naming either.
	const auth = createAuth(db, authEnv, {
		secret: signingKey.secret,
		requestOrigin: url.origin
	});

	const reset = await resetMemberPassword(auth, {
		token: url.searchParams.get(TOKEN_PARAM) ?? '',
		newPassword: submission.value.password
	});

	if (!reset.ok) {
		switch (reset.reason) {
			case 'link':
				// the dead token stays on the address: the banner the component draws for this arm is
				// the same one the loader draws for an address with no token, so a reader sees one
				// screen either way and the second press of a dead link costs nothing.
				return invalid(400, submission.reject({ formErrors: [LINK_DEAD] }));
			case 'password':
				// the schema already refuses what better-auth would, so this arm is the two
				// disagreeing — a minimum raised on one side and not the other. it lands under the
				// box all the same, because the box is still what has to change, and the link is
				// still live: the length is measured before the row is consumed.
				return invalid(
					400,
					submission.reject({
						fieldErrors: {
							password: [`must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`]
						}
					})
				);
			case 'unavailable':
				return invalid(500, submission.reject({ formErrors: [UNAVAILABLE] }));
		}
	}

	return redirectWithFlash(request, PASSWORD_RESET_FLASH, '/login', 'reset');
}

export default function Reset({ loaderData, actionData }: Route.ComponentProps) {
	if (loaderData.shape === 'dead') {
		return (
			<Panel orgName={loaderData.orgName}>
				<DeadLink />
			</Panel>
		);
	}

	return (
		<Panel orgName={loaderData.orgName}>
			<ResetForm actionData={actionData} />
		</Panel>
	);
}

/**
 * the panel, with no bar and no foot: a centred column and nothing else.
 *
 * no rail and no identity band — the member holds no session and there is nothing under them to
 * navigate to — and the organisation's name is a caption above the heading, which is the shape
 * ./login.tsx and ./join.tsx take and $lib/admin/setup-gate.tsx argues.
 */
function Panel({ orgName, children }: { readonly orgName: string | null; children: ReactNode }) {
	return (
		<PanelRoute>
			{/* the line above the heading and the heading are one block, at the tight step: the
			    panel's own gap separates blocks from each other, and an eyebrow set off its title by
			    that distance reads as a line about the page rather than as the first half of its
			    name. the name is not rendered at all when the row is missing or the read failed. */}
			<Stack tight>
				{orgName ? <p className="adm-caption">{orgName}</p> : null}
				<h1>{SCREEN_TITLE}</h1>
			</Stack>
			{children}
		</PanelRoute>
	);
}

/**
 * what a member holding a link that buys nothing sees, drawn for both ways of arriving at it: an
 * address with no token, and a press the auth layer refused.
 *
 * the way on is a control rather than a sentence telling the reader to find it — asking for
 * another link is one press, and it is the only thing left to do here.
 */
function DeadLink() {
	return (
		<Banner
			tone="blocker"
			word="This link no longer works"
			actions={
				<Button as={Link} to="/forgot">
					Ask for another
				</Button>
			}
		>
			{LINK_DEAD}
		</Banner>
	);
}

function ResetForm({ actionData }: { readonly actionData: Route.ComponentProps['actionData'] }) {
	const [form, fields] = useAdminForm(RESET_FORM, actionData);
	const navigation = useNavigation();
	const changing = navigation.state === 'submitting';

	// what a refused attempt says about the attempt as a whole, above the form. the sentence about
	// the box is under the box and is the field's own.
	const refusal = form.errors?.[0];

	// a dead link takes the box away with it: there is nothing a member can type that makes this
	// link work, so a form left standing under the banner is one press that can only fail again.
	if (refusal === LINK_DEAD) return <DeadLink />;

	return (
		<>
			{refusal ? (
				<Banner tone="blocker" word="Password not changed">
					<MarkedText text={refusal} />
				</Banner>
			) : null}

			{/* no `action` attribute, so this posts to the current url and the token the mail put
			    there travels with it. */}
			<Form method="post" {...getFormProps(form)}>
				<Stack tight>
					{/* the rule is stated over the box as well as under it: a screen that first
					    mentions a minimum in a refusal is one somebody submits, corrects and submits
					    again to find out what it wanted. */}
					<Field
						{...boxProps(fields.password)}
						label="New password"
						type="password"
						autoComplete="new-password"
						required
						hint={PASSWORD_HINT}
					/>
					<div className="adm-actions">
						{/* busy and still reachable: a disabled control leaves the tab order, so
						    switching this one off at the moment it is pressed throws the focus that
						    pressed it to the document body. */}
						<Button variant="primary" aria-busy={changing || undefined}>
							Change password
						</Button>
					</div>
				</Stack>
			</Form>
		</>
	);
}
