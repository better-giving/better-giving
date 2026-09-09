import { MIN_ADMIN_PASSWORD_LENGTH } from '@better-giving/operator/admin-password';
import { Button } from '@better-giving/operator/components/controls/Button';
import { Field } from '@better-giving/operator/components/forms/Field';
import { StatedValue } from '@better-giving/operator/components/forms/StatedValue';
import { PanelRoute } from '@better-giving/operator/components/shell/AppShell';
import { Stack } from '@better-giving/operator/components/shell/Layout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { getFormProps } from '@conform-to/react';
import type { ReactNode } from 'react';
import { Form, Link, redirect, useNavigation } from 'react-router';
import { z } from 'zod';
import { operatorLinks } from '$lib/admin/operator-links';
import { boxProps, useAdminForm } from '$lib/admin/use-admin-form';
import { defineForm } from '$lib/forms/definition';
import { createAuth, readAuthEnv, readInvitation, redeemInvitation } from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import { readSetupState } from '$lib/server/config/setup-state';
import { invalid, parseForm } from '$lib/server/conform';
import { database, platform } from '../context';
import type { Route } from './+types/join';

// the page an invited colleague lands on, and one of the four writes this deployment serves to a
// caller with no session — ./login.tsx, ./forgot.tsx and ./reset.tsx are the others.
//
// it is outside ./_app.tsx deliberately and ../routes.spec.ts is what holds that to a line
// somebody typed: the file is on `PUBLIC_ROUTE_FILES` with the reason beside it. what stands in
// for a session is the token in the link — single-use, seven days, and checked before anything is
// written ($lib/server/auth/invitations.ts).
//
// being outside every layout is also why this module builds its own auth instance rather than
// taking the gate's off the request context, exactly as ./login.tsx, ./forgot.tsx and ./reset.tsx
// do and for the same reason: nothing above this route resolves one.
//
// **the address is the invitation's and never a box.** the colleague is told which address they
// are signing up as — a work invitation read at a personal mailbox is the case that needs it — and
// a body naming another one changes nothing, because the redeem takes the address off the row the
// token names.
//
// **the token is never rendered and never echoed.** it stays on the address bar, where the mail
// put it. the form posts to this same url with no `action` attribute, so the token travels with
// the submission without this module writing it into the page.

/** the screen's name, rendered as the document title and as the heading. */
const SCREEN_TITLE = 'Set your password';

/** this page's own address, which a dead link is sent back to. */
const SCREEN = '/join';

/** the parameter the invitation mail puts the token in. */
const TOKEN_PARAM = 'token';

/** what an empty box and a box the request did not carry are both told. */
const MISSING = 'required';

/** the longest name this deployment stores for a colleague. */
const MAX_NAME_LENGTH = 200;

/**
 * cap on what one anonymous POST here can ask to be hashed.
 *
 * better-auth's own maximum is 128 and this matches it rather than sitting above it: a value past
 * the cap is refused by the schema, under the box, instead of coming back as the auth layer's
 * `PASSWORD_TOO_LONG` with nothing on the screen saying which box it was about.
 */
const MAX_PASSWORD_LENGTH = 128;

/**
 * the form a colleague sets their password with.
 *
 * `withheld` is not a choice — a schema naming `password` makes it a required property, and an
 * empty list is refused when the form is stated ($lib/server/conform.ts's header argues it).
 *
 * the password is not trimmed, for the reason ./login.tsx gives about the deployer's: a leading or
 * trailing space is a character of the secret, and quietly removing one turns a correct paste into
 * a password that will not sign them in tomorrow. the name is, because a name is not a secret and
 * a trailing space in one is a typo.
 *
 * the minimum is `@better-giving/operator`'s rather than the auth module's, and it is the same
 * number by construction — `MEMBER_PASSWORD_MIN_LENGTH` is that constant imported. it has to come
 * from the leaf package because this statement is read in the browser too, and nothing under
 * `$lib/server/**` may be.
 */
const ACCEPT_FORM = defineForm({
	id: 'join-accept',
	withheld: ['password'],
	schema: z.object({
		name: z
			.string({ error: MISSING })
			.trim()
			.min(1, { error: MISSING })
			.max(MAX_NAME_LENGTH, { error: `must be at most ${MAX_NAME_LENGTH} characters` }),
		password: z
			.string({ error: MISSING })
			.min(MIN_ADMIN_PASSWORD_LENGTH, {
				error: `must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`
			})
			.max(MAX_PASSWORD_LENGTH, { error: `must be at most ${MAX_PASSWORD_LENGTH} characters` })
	})
});

/** what the colleague is told the box wants before they have typed in it. */
const PASSWORD_HINT = `At least ${MIN_ADMIN_PASSWORD_LENGTH} characters.`;

/** what a colleague whose address already signs in here is told, with the way in beside it. */
const ALREADY_A_MEMBER = 'This address is already a member here. Sign in instead.';

/**
 * what a refusal that is about the deployment says.
 *
 * the same shape ./login.tsx's is and for the same reason: the auth layer's own message is written
 * for an agent reading a status body and belongs on the surfaces an operator controls, so what an
 * anonymous POST gets is the pointer rather than the answer.
 */
const UNAVAILABLE =
	'Your password could not be set: something is wrong with this deployment rather than with ' +
	'what you typed. Ask whoever invited you to check the console (`better-giving open`); the ' +
	'exact cause is in the deployment’s logs, which the console does not read.';

/**
 * what a deployment whose schema is not there says.
 *
 * no `auth_signing_key` row to sign a cookie with, which is what a fresh fork hits. the sentence
 * is written for the colleague and points at the person who can fix it, because they cannot.
 */
const NOT_MIGRATED =
	'Your password could not be set: this deployment’s database has not been set up. Ask whoever ' +
	'invited you to open the console (`better-giving open`) and update the deployment.';

export const links = operatorLinks;

export function meta(): Route.MetaDescriptors {
	return [{ title: SCREEN_TITLE }];
}

export async function loader({ context, url }: Route.LoaderArgs) {
	const db = context.get(database);

	// which deployment this is. /join sits outside ./_app.tsx, so the name the identity band
	// carries never reaches this page, and an invitation screen that cannot say whose it is looks
	// the same on every fork.
	//
	// the registered name and nothing else off that row: this page is served to anyone holding a
	// link, and the EIN and the addresses are what a deployment tells a donor after a gift. a
	// failure is swallowed to a null name, exactly as ./login.tsx's read is.
	const state = await readSetupState(db, context.get(platform).env);
	const orgName = state?.profile?.legalName ?? null;

	// expired, already used, revoked and never minted are one answer, and it is the invitations
	// module's decision rather than this screen's: an answer that told them apart would tell
	// somebody feeding tokens at this address which of theirs had ever been real.
	const invitation = await readInvitation(db, {
		token: url.searchParams.get(TOKEN_PARAM) ?? '',
		now: new Date()
	});
	if (!invitation.ok) return { shape: 'dead' as const, orgName };

	return { shape: 'accept' as const, orgName, email: invitation.email };
}

/**
 * the redeem: an account, a session, and the invitation stamped.
 *
 * **the request body is read exactly once, here, by the action that owns it** — `parseForm` reads
 * what it returns and nothing above this route may.
 *
 * the two writes and their order are `redeemInvitation`'s, argued there; what this action owns is
 * which of its four refusals goes where on the screen.
 *
 * the cookie is copied onto the redirect by hand for the same reason ./login.tsx copies the
 * signing-in one: better-auth builds its `set-cookie` on the response it would have sent from a
 * router this deployment does not serve.
 */
export async function action({ context, request, url }: Route.ActionArgs) {
	const db = context.get(database);
	const authEnv = readAuthEnv(context.get(platform).env);

	const submission = parseForm(await request.formData(), ACCEPT_FORM);

	// a blank box and one over the cap are both rejections the box itself explains, and both are
	// refused before the token is looked up: a link is a credential and there is no reason to spend
	// one answering a form that is not filled in.
	if (!submission.ok) return invalid(400, submission.reject());

	const signingKey = await resolveAuthSecret(db, authEnv);
	if (!signingKey.ok) {
		console.error('an invitation could not be redeemed — no signing key:', signingKey.message);
		return invalid(500, submission.reject({ formErrors: [NOT_MIGRATED] }));
	}

	// the origin is passed rather than configured: `createAuth` derives the trusted-origin list and
	// the cookie `Secure` policy from it, so a deployment answers correctly on workers.dev and on a
	// custom domain without a deploy-time variable naming either.
	const auth = createAuth(db, authEnv, {
		secret: signingKey.secret,
		requestOrigin: url.origin
	});

	const redeemed = await redeemInvitation(db, auth, {
		token: url.searchParams.get(TOKEN_PARAM) ?? '',
		name: submission.value.name,
		password: submission.value.password,
		headers: request.headers,
		now: new Date()
	});

	if (!redeemed.ok) {
		switch (redeemed.reason) {
			case 'link':
				// back to this page with the dead token off the address. what a colleague holding a
				// link that no longer works is told is the loader's to decide and is decided there
				// once, so a screen drawn from an action result cannot say a different thing — and
				// the address stops carrying a credential that buys nothing.
				return redirect(SCREEN, 303);
			case 'password':
				// the schema already refuses what better-auth would, so this arm is the two
				// disagreeing — a minimum raised on one side and not the other. it lands under the
				// box all the same, because the box is still what has to change.
				return invalid(
					400,
					submission.reject({
						fieldErrors: {
							password: [`must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`]
						}
					})
				);
			case 'member':
				// the account arrived between this link being read and this form being submitted,
				// which takes two presses of the same link racing each other. the way in is the
				// sign-in, and the banner carries it.
				return invalid(409, submission.reject({ formErrors: [ALREADY_A_MEMBER] }));
			case 'unavailable':
				return invalid(500, submission.reject({ formErrors: [UNAVAILABLE] }));
		}
	}

	// straight to the dashboard rather than to a destination on the url: nobody was turned away
	// from anywhere to get here, and the link came from an email rather than from the gate.
	const response = redirect('/admin', 303);
	for (const cookie of redeemed.cookies) response.headers.append('set-cookie', cookie);
	return response;
}

export default function Join({ loaderData, actionData }: Route.ComponentProps) {
	if (loaderData.shape === 'dead') {
		return (
			<Panel orgName={loaderData.orgName}>
				<Banner tone="blocker" word="This link no longer works">
					Ask a colleague to invite you again. A new link will arrive by email.
				</Banner>
			</Panel>
		);
	}

	return (
		<Panel orgName={loaderData.orgName}>
			<AcceptForm email={loaderData.email} actionData={actionData} />
		</Panel>
	);
}

/**
 * the panel, with no bar and no foot: a centred column and nothing else.
 *
 * no rail and no identity band — the colleague holds no session and there is nothing under them to
 * navigate to — and the organisation's name is a caption above the heading, which is the shape
 * ./login.tsx's sign-in screen takes and $lib/admin/setup-gate.tsx argues.
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

function AcceptForm({
	email,
	actionData
}: {
	readonly email: string;
	readonly actionData: Route.ComponentProps['actionData'];
}) {
	const [form, fields] = useAdminForm(ACCEPT_FORM, actionData);
	const navigation = useNavigation();
	const setting = navigation.state === 'submitting';

	// what a refused attempt says about the attempt as a whole, above the form. the sentence about
	// a box is under that box and is the field's own.
	const refusal = form.errors?.[0];

	return (
		<>
			{refusal ? (
				<Banner
					tone="blocker"
					word="Not signed in"
					// the one refusal that names somewhere to go, so the way there is a control
					// rather than a sentence telling the reader to find it.
					actions={
						refusal === ALREADY_A_MEMBER ? (
							<Button as={Link} to="/login">
								Sign in
							</Button>
						) : undefined
					}
				>
					<MarkedText text={refusal} />
				</Banner>
			) : null}

			{/* no `action` attribute, so this posts to the current url and the token the mail put
			    there travels with it. */}
			<Form method="post" {...getFormProps(form)}>
				<Stack tight>
					{/* stated and not a box: the address is the invitation's, and a colleague invited
					    at a work address reading the mail at a personal one needs to see which one
					    they are signing up as. */}
					<StatedValue label="Email address" value={email} />
					<Field {...boxProps(fields.name)} label="Your name" autoComplete="name" required />
					{/* the rule is stated over the box as well as under it: a screen that first
					    mentions a minimum in a refusal is one somebody submits, corrects and submits
					    again to find out what it wanted. */}
					<Field
						{...boxProps(fields.password)}
						label="Password"
						type="password"
						autoComplete="new-password"
						required
						hint={PASSWORD_HINT}
					/>
					<div className="adm-actions">
						{/* busy and still reachable: a disabled control leaves the tab order, so
						    switching this one off at the moment it is pressed throws the focus that
						    pressed it to the document body. */}
						<Button variant="primary" aria-busy={setting || undefined}>
							Set password and sign in
						</Button>
					</div>
				</Stack>
			</Form>
		</>
	);
}
