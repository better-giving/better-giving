import { Button } from '@better-giving/operator/components/controls/Button';
import { Field } from '@better-giving/operator/components/forms/Field';
import { PanelRoute } from '@better-giving/operator/components/shell/AppShell';
import { Stack } from '@better-giving/operator/components/shell/Layout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { getFormProps } from '@conform-to/react';
import { APIError } from 'better-auth/api';
import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { z } from 'zod';
import { operatorLinks } from '$lib/admin/operator-links';
import { useAdminForm } from '$lib/admin/use-admin-form';
import { defineForm } from '$lib/forms/definition';
import {
	isRateLimited,
	signInRateLimitKey,
	signInRateLimitMessage
} from '$lib/server/api/rate-limit';
import {
	createAuth,
	normaliseEmail,
	readAuthEnv,
	resolveAuthSecret,
	signInDestination,
	signInMember,
	STAFF_USER_EMAIL
} from '$lib/server/auth';
import { invalid, parseForm, unread } from '$lib/server/conform';
import { PASSWORD_RESET_FLASH, takeFlash } from '$lib/server/flash';
import { SetupGate } from '$lib/admin/setup-gate';
import { setupOutstanding } from '$lib/server/config/readiness';
import { readSetupState } from '$lib/server/config/setup-state';
import { database, platform } from '../context';
import type { Route } from './+types/login';

// the one screen that cannot sit behind the login, and the first of the four writes this
// deployment serves to a caller with no session — ./join.tsx, ./forgot.tsx and ./reset.tsx are the
// others.
//
// it is outside ./_app.tsx deliberately and ../routes.spec.ts is what holds that decision to a
// line somebody typed: the file is on `PUBLIC_ROUTE_FILES` with the reason beside it. what it owes
// instead of a session is the sign-in limiter charged in its own action, which is neither of the
// two things every route on `/api/v1` owes.
//
// being outside every layout is also why this module builds its own auth instance rather than
// taking the gate's off the request context ($lib/server/auth/gate.ts sets that for the screens
// beneath it, and nothing sets it here). the signing-key read that costs is the one thing this
// screen pays that no other unauthenticated surface does, and it pays it because it signs one in.

/** the screen's name, rendered as the document title and as the heading. */
const SCREEN_TITLE = 'Sign in';

/**
 * cap on what one anonymous POST here can ask to be hashed.
 *
 * there is no request-body limit worth relying on here, and every attempt is SHA-256'd by
 * `secretEquals` under a 10 ms CPU budget on the Workers free tier. this bounds the hash, and sits
 * far above any real credential.
 */
const MAX_PASSWORD_LENGTH = 256;

/** what an empty box and a box the request did not carry are both told. */
const MISSING = 'required';

/**
 * cap on the box that takes a username or an address, so a body cannot buy an unbounded lookup.
 *
 * the longest address there is (RFC 5321), which is the longer of the two things it holds.
 */
const MAX_IDENTIFIER_LENGTH = 254;

/**
 * the sign-in form, stated once for the action that reads a body against it and the screen that
 * submits to it.
 *
 * **two identities and one box names which.** the deployer's is the constant `ADMIN_USERNAME`, so
 * typing it is what has the password compared against `ADMIN_PASSWORD`; anything else is read as
 * the address a colleague was invited at and is signed in against their own credential. both boxes
 * are required, and the identifier is plain text rather than `type="email"` because a username is
 * not an address and a browser refusing to submit one would close the deployer's way in.
 *
 * the identifier is lower-cased and trimmed, because better-auth lower-cases on every lookup, a
 * pasted address carries the space after it, and the comparison that chooses between the two is
 * made against what those left behind.
 *
 * `withheld` is not a choice here — a schema naming `password` makes it a required property, and
 * an empty list is refused when the form is stated. that is what replaced emptying the box by hand
 * on every rejection arm; `$lib/server/conform.ts`'s header is where the rule is argued. the
 * identifier is not on it: it is an ordinary box and comes back holding what was typed, like every
 * other box in this app.
 *
 * the password is not trimmed. a leading or trailing space is a character of the secret, and
 * quietly removing one turns a correct paste into a wrong password with nothing on the screen to
 * say what happened.
 *
 * it sits in this module rather than beside it because every file directly under ./ is an address
 * to `flatRoutes` whatever its extension (../routes.ts) — a `login.schema.ts` next to this one
 * would be a route serving a zod schema.
 */
const LOGIN_FORM = defineForm({
	id: 'login',
	withheld: ['password'],
	schema: z.object({
		identifier: z
			.string({ error: MISSING })
			.trim()
			.toLowerCase()
			.min(1, { error: MISSING })
			.max(MAX_IDENTIFIER_LENGTH, { error: `must be at most ${MAX_IDENTIFIER_LENGTH} characters` }),
		password: z
			.string({ error: MISSING })
			.min(1, { error: MISSING })
			.max(MAX_PASSWORD_LENGTH, { error: `must be at most ${MAX_PASSWORD_LENGTH} characters` })
	})
});

/**
 * what a member whose identifier and password do not match is told.
 *
 * one sentence for an address nobody here has and for a wrong password alike, which is
 * `signInMember`'s decision and is kept whole: telling them apart would turn this form into a way
 * to ask whether a given person works here, on a deployment whose donation page names the
 * organisation.
 *
 * it names the box rather than the kind of value in it, because one box takes both and a sentence
 * about an address would read as a refusal of the username to somebody who typed one.
 */
const WRONG_CREDENTIAL =
	'That username or email address and password do not match a member of this organisation.';

/**
 * what every failure but the 401 says.
 *
 * the messages the auth layer produces are about the deployment — among them the 500 for an
 * unconfigured staff credential, whose message states the configured `ADMIN_PASSWORD`'s length.
 * that is written for an agent reading a status body and belongs on the surfaces an operator
 * controls: the console says whether that secret is set and is where it is set again, and the
 * running deployment's logs carry the withheld detail. an anonymous POST to this form must not
 * read it back, so what it gets is the pointer rather than the answer.
 *
 * a password this deployment would refuse draws the set-up gate in place of the box instead — the
 * loader reads the same authority the sign-in path does ($lib/server/config/setup-state.ts) — so
 * what still reaches this arm is a value changed out from under a form already drawn, or a set-up
 * reading that did not land.
 */
const UNAVAILABLE =
	'Sign-in is unavailable. The console (`better-giving open`) says whether this deployment’s ' +
	'sign-in password is set. The exact cause is in the deployment’s logs, which the console does ' +
	'not read: the Cloudflare dashboard has them, and `pnpm run logs` reads them from a checkout.';

/**
 * what a deployment whose schema is not there says.
 *
 * two failures reach it and both are the same fix: no `auth_signing_key` row to sign a cookie
 * with, and a throw out of the staff upsert on a database with no `auth_user` table — the one a
 * fresh fork actually hits.
 */
const NOT_MIGRATED =
	'Sign-in is unavailable. If this deployment is new, check that migrations have been ' +
	'applied to its database: the console (`better-giving open`) applies them to the deployed D1 ' +
	'when it updates this deployment, and `pnpm wrangler d1 migrations apply DB --local` applies ' +
	'them to a local one. Then read this deployment’s logs (the Cloudflare dashboard, or ' +
	'`pnpm run logs` from a checkout).';

export const links = operatorLinks;

export function meta(): Route.MetaDescriptors {
	return [{ title: SCREEN_TITLE }];
}

export async function loader({ context, request, url }: Route.LoaderArgs) {
	const { env } = context.get(platform);
	const db = context.get(database);
	const authEnv = readAuthEnv(env);

	// already signed in: there is nothing to do on this page. it honours the destination for the
	// same reason the action does — a second tab that signed in first leaves this one holding a
	// form whose `next` is still the page the operator asked for.
	//
	// a key this deployment cannot resolve costs the bounce and not the page. it means no cookie
	// here can be verified, so there is no session to find; every other screen answers that with
	// the gate's 500, and this is the screen somebody reaches to fix it. the action says what is
	// wrong when they press the button.
	const signingKey = await resolveAuthSecret(db, authEnv);
	if (signingKey.ok) {
		const auth = createAuth(db, authEnv, {
			secret: signingKey.secret,
			requestOrigin: url.origin
		});
		const session = await auth.api.getSession({ headers: request.headers });
		if (session) throw redirect(signInDestination(url), 303);
	}

	// which deployment this is. /login sits outside ./_app.tsx, so the name the identity band
	// carries — read once per view by that layout's loader — never reaches this page, and a
	// sign-in screen that cannot say whose it is looks the same on every fork.
	//
	// the registered name and nothing else off that row. this page is served to anyone who asks
	// for it, so the EIN, the address and the receipt address stay on the far side of the
	// password box: they are what a deployment tells a donor after a gift.
	//
	// a failure is swallowed to a null name, exactly as ./_app.tsx's read is and for a reason that
	// is sharper here — this is the screen someone reaches to fix a deployment whose database is
	// not answering, and throwing would replace the password box with a bare error on precisely
	// that deployment. it is the same call that reads the five ($lib/server/config/setup-state.ts).
	const state = await readSetupState(db, env);

	// **an unfinished deployment serves this in place of the password box.** the five are what the
	// dashboard behind this screen is gated on (./_app.tsx), so a password typed here would buy
	// nothing but the same list one screen later — and one of the five is whether a password is set
	// at all, which is a sign-in nobody can complete.
	//
	// **it is drawn to a caller with no session, which is a decision and not an oversight.** what it
	// tells a stranger is which of five jobs this deployment has not finished — no value, no address,
	// no key, and nothing about the organisation the page does not already name. that is the cost of
	// the operator meeting it at all: they arrive here holding no session by definition, and a list
	// kept on the far side of the password box is a list they see only once it can no longer tell
	// them anything they did not just prove. it stops being served the moment the last job is done.
	if (state !== null && setupOutstanding(state.lines) > 0) {
		return { shape: 'setup' as const, lines: state.lines };
	}

	// the reset that just finished, taken: read and cleared on this one response, so a reload
	// reports nothing ($lib/server/flash.ts owns that). it is taken after the gate above rather
	// than before it, so a marker is never burnt by a screen that would not have drawn it.
	//
	// what it carries is that a password changed and never whose — the marker is written by
	// ./reset.tsx, which mints no session and knows the member only as the account a token named.
	const landed = await takeFlash(request, PASSWORD_RESET_FLASH);

	return data(
		{
			shape: 'sign-in' as const,
			orgName: state?.profile?.legalName ?? null,
			passwordReset: landed !== null
		},
		// the header that burns the marker rides on the response that publishes it, so a reload
		// reports nothing. a `Set-Cookie` from a loader is sent without this route exporting
		// `headers` — react router preserves that one header on its own.
		landed === null ? {} : { headers: { 'Set-Cookie': landed.clear } }
	);
}

/**
 * the way into this app, the deployer's and a member's alike, and one of the four writes it serves
 * to a caller with no session — ./join.tsx, ./forgot.tsx and ./reset.tsx are the others.
 *
 * it calls `auth.api.signInStaff` or `signInMember` (`$lib/server/auth/members.ts`) rather than
 * posting to better-auth's own HTTP router, which no route in this app mounts (CLAUDE.md): both are
 * the server-side calls those modules were written for. **the request body is read exactly once,
 * here, by the action that owns it** — `parseForm`
 * is what reads it, and nothing above this route may.
 *
 * the cookie is copied onto the redirect by hand for the same reason ./_app.admin.sign-out.ts
 * copies the clearing one: better-auth builds its `set-cookie` on the response it would have sent
 * from that router, and nothing here serves it.
 */
export async function action({ context, request, url }: Route.ActionArgs) {
	const { env } = context.get(platform);
	const db = context.get(database);
	const authEnv = readAuthEnv(env);

	// charged before the body is read and before anything is hashed.
	//
	// what it saves is the SHA-256 compare in `secretEquals` and, on a correct guess, the staff-row
	// upsert. three actions pay on that bucket — this one, ./forgot.tsx and
	// ./_app.admin.members_.password.tsx — and each charges it once, before its own body is read.
	// they share a key rather than holding one each because a guess at a credential is a guess
	// whichever form carries it ($lib/server/api/rate-limit.ts); nothing else in a request's path
	// charges it, and the better-auth HTTP endpoint that would spend the same key is a 404 on
	// this deployment (CLAUDE.md).
	//
	// 429 rather than a 200 carrying a message, and the status is the whole of the deployment's
	// visibility into this: a rate limiting binding appears nowhere in the Cloudflare dashboard, so
	// what a refusal leaves behind is the status the Worker answered with, in `pnpm run logs`
	// (https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/). a throttled
	// sign-in reads as 429 there and a wrong password as the 401 below — two different lines.
	//
	// the rejection is built from the statement and not from the request, which is what keeps the
	// charge ahead of the body: a refusal that had already read it would be a refusal that spent
	// the parse it exists to save. it carries no values and no field errors, so the banner is the
	// whole of it.
	//
	// a deployment with no binding signs staff in, and a caller the edge attributed no address to
	// is not counted at all. both are `isRateLimited`'s decisions and are argued in
	// $lib/server/api/rate-limit.ts; what is local here is that `ADMIN_PASSWORD` is what bounds
	// this form either way.
	if (await isRateLimited(env.SIGN_IN_RATE_LIMITER, signInRateLimitKey(request))) {
		return invalid(429, unread(LOGIN_FORM, signInRateLimitMessage()));
	}

	const submission = parseForm(await request.formData(), LOGIN_FORM);

	// a blank box and one over the cap are both rejections the box itself explains, and the second
	// is refused before it is hashed. no banner: the sentence belongs under the input.
	if (!submission.ok) return invalid(400, submission.reject());

	// the read every other screen pays for on the gate. a deployment that cannot sign a cookie
	// cannot sign one here either, and the fix is the same one the missing `auth_user` table below
	// has — so both arms say it rather than naming a row an operator would then go looking for.
	const signingKey = await resolveAuthSecret(db, authEnv);
	if (!signingKey.ok) {
		console.error('staff sign-in has no signing key:', signingKey.message);
		return invalid(500, submission.reject({ formErrors: [NOT_MIGRATED] }));
	}

	// the origin is passed rather than configured: `createAuth` derives the trusted-origin list and
	// the cookie `Secure` policy from it, so a deployment answers correctly on workers.dev and on a
	// custom domain without a deploy-time variable naming either.
	const auth = createAuth(db, authEnv, {
		secret: signingKey.secret,
		requestOrigin: url.origin
	});

	// which of the two ways in this is, and the identifier is the whole of what decides. the
	// deployer's is a constant, so this is a comparison and not a query — nothing here asks the
	// database who a caller claims to be before deciding which credential to compare. the constant
	// is normalised the same way the box was, so a deployment that raised it to a capital would not
	// quietly send its own deployer down the member path.
	//
	// the limiter above was charged once, ahead of this branch and ahead of the body: one bucket for
	// both ways in, on a key that never moves with the path ($lib/server/api/rate-limit.ts). a
	// charge inside either arm would be a second one on the same press, and a bucket per arm would
	// be a guesser buying a fresh one by typing a different identity into the box.
	if (submission.value.identifier !== normaliseEmail(STAFF_USER_EMAIL)) {
		const signedIn = await signInMember(auth, {
			email: submission.value.identifier,
			password: submission.value.password,
			headers: request.headers
		});

		if (!signedIn.ok) {
			// `unavailable` is already logged where it was classified, and says here what every
			// other failure of this deployment's says.
			return signedIn.reason === 'credential'
				? invalid(401, submission.reject({ formErrors: [WRONG_CREDENTIAL] }))
				: invalid(500, submission.reject({ formErrors: [UNAVAILABLE] }));
		}

		return signedInAt(url, signedIn.cookies);
	}

	let cookies: string[];
	try {
		const { headers } = await auth.api.signInStaff({
			body: { password: submission.value.password },
			headers: request.headers,
			returnHeaders: true
		});
		cookies = headers.getSetCookie();
	} catch (e) {
		if (e instanceof APIError) {
			// 401 is the only status whose message is repeated back to the caller, because it is
			// the only one about what they sent — and with one secret and one account there is
			// nothing it could disambiguate.
			if (e.statusCode === 401) {
				return invalid(
					401,
					submission.reject({ formErrors: [e.body?.message ?? 'Invalid password.'] })
				);
			}

			// everything else is about the deployment and answers 500 whatever better-auth
			// numbered it: this endpoint produces one other status, the unconfigured-credential
			// 500, and a third would be a plugin bug rather than an answer worth forwarding.
			console.error('staff sign-in failed:', e.statusCode, e.body?.code, e.body?.message);
			return invalid(500, submission.reject({ formErrors: [UNAVAILABLE] }));
		}

		// not an APIError: the auth layer threw before it could shape a response. the one a fresh
		// fork hits is `no such table: auth_user` from the staff upsert — same cause and same fix
		// as the message in $lib/server/auth/staff-plugin.ts, which is otherwise unreachable.
		console.error('staff sign-in failed before the auth layer could respond:', e);
		return invalid(500, submission.reject({ formErrors: [NOT_MIGRATED] }));
	}

	return signedInAt(url, cookies);

	/**
	 * back to the page the gate turned them away from, and the app's entrance at `/` when there is
	 * nowhere to go back to. what may be returned to, and what stands in when nothing may, is
	 * `signInDestination` in $lib/server/auth/next.ts — an open-redirect control and the whole of
	 * one, so a candidate it refuses is replaced in silence and never quoted into a message.
	 *
	 * declared inside the action rather than beside it, which is what keeps `$lib/server/**` out of
	 * the bundle this route ships: react router strips a route's `action` and strips nothing else,
	 * so a module-scope helper reaching the server tree ships with the component
	 * (../routes.spec.ts).
	 */
	function signedInAt(destination: URL, minted: readonly string[]): Response {
		const response = redirect(signInDestination(destination), 303);
		for (const cookie of minted) response.headers.append('set-cookie', cookie);
		return response;
	}
}

export default function Login({ loaderData, actionData }: Route.ComponentProps) {
	// the gate stands in place of the password box, because a deployment that is not finished has
	// nothing behind one ($lib/admin/setup-gate.tsx).
	if (loaderData.shape === 'setup') return <SetupGate lines={loaderData.lines} />;

	return (
		<SignInScreen
			orgName={loaderData.orgName}
			passwordReset={loaderData.passwordReset}
			actionData={actionData}
		/>
	);
}

function SignInScreen({
	orgName,
	passwordReset,
	actionData
}: {
	orgName: string | null;
	passwordReset: boolean;
	actionData: Route.ComponentProps['actionData'];
}) {
	const [form, fields] = useAdminForm(LOGIN_FORM, actionData);
	const navigation = useNavigation();
	const signingIn = navigation.state === 'submitting';

	// what a refused attempt says about the attempt as a whole, above the form. the sentence about
	// the box is under the box and is the field's own.
	const refusal = form.errors?.[0];

	return (
		<PanelRoute>
			{/* the line above the heading and the heading are one block, at the tight step: the
			    panel's own gap separates blocks from each other, and an eyebrow set off its title
			    by that distance reads as a line about the page rather than as the first half of its
			    name.

			    the name is not rendered at all when the row is missing or the read failed, which is
			    what a screen that cannot say whose it is should do rather than name something it
			    does not know. */}
			<Stack tight>
				{orgName ? <p className="adm-caption">{orgName}</p> : null}
				<h1>{SCREEN_TITLE}</h1>
			</Stack>

			{/* the two report on different things and only one may show: the refusal is about the
			    attempt just made and the reset about the press before this page was reached, so the
			    refusal wins — a member told their password changed while being told this one did not
			    match reads the wrong half first. */}
			{refusal ? (
				<Banner tone="blocker" word="Not signed in">
					<MarkedText text={refusal} />
				</Banner>
			) : passwordReset ? (
				<Banner tone="done" word="Password changed">
					Sign in with your new password.
				</Banner>
			) : null}

			{/* no `action` attribute, so this posts to the current url and the `?next=` the gate
			    minted travels with it. */}
			<Form method="post" {...getFormProps(form)}>
				<Stack tight>
					{/* the password is never seeded and never echoed: the form withholds it, so a
					    rejection carries no value for this box and it comes back blank with the
					    sentence under it saying why. see the note at the top of
					    $lib/server/auth/credential.ts for whose password has no hash behind it. */}
					{/* one box for two identities: a colleague types the address they were invited
					    at and the deployer types their username, and the constant is what tells them
					    apart. plain text rather than `type="email"` because a username is not one
					    and a browser that refused to submit one would close that way in.

					    it says nothing about what that username is. the console prints it beside the
					    password box that sets the credential
					    (packages/console-ui/src/lib/password-fold.tsx), which is where somebody who
					    has not been told it is standing.

					    an ordinary box in every other respect — it comes back holding what was
					    typed, so a refused attempt is one the reader corrects rather than retypes. */}
					<Field
						id={fields.identifier.id}
						name={fields.identifier.name}
						label="Username or email address"
						autoComplete="username"
						required
						defaultValue={fields.identifier.defaultValue}
						error={fields.identifier.errors?.[0]}
					/>
					<Field
						id={fields.password.id}
						name={fields.password.name}
						label="Password"
						type="password"
						autoComplete="current-password"
						required
						error={fields.password.errors?.[0]}
					/>
					{/* the way out for a member who cannot get in, under the box that turned them away
					    and above the press that would turn them away again.

					    the caption step is on the paragraph and not on the link, which is
					    `.adm-footstrip`'s arrangement in packages/operator/src/styles/adm.css and the
					    reason stated there: every type utility carries an ink with its size, so
					    `.adm-caption` on the anchor would take the muted ink with it and the link
					    would stop looking like one. inherited size reaches the anchor; inherited ink
					    does not, because ./base.css states a link's own.

					    it is not offered to the deployer and is not withheld from them either —
					    their password is a deploy-time secret and `requestPasswordReset` refuses
					    their identifier by name, so what they get from /forgot is the same sentence
					    everybody gets. the console is where that secret is set. */}
					<p className="adm-caption">
						<Link to="/forgot">Forgot your password?</Link>
					</p>
					{/* a lone submit is still an action row: `.adm-btn` is `inline-flex`, so a
					    control placed directly in a `.adm-stack` is a grid item stretched to the
					    track and draws itself full width — which at the panel's measure is a
					    phone-app idiom this dashboard has nowhere else. */}
					<div className="adm-actions">
						{/* busy and still reachable: a disabled control leaves the tab order, so
						    switching this one off at the moment it is pressed throws the focus that
						    pressed it to the document body, and `aria-busy` on a control nothing can
						    reach announces to nobody. a second press while the first is in flight is
						    the router's to coalesce rather than something to buy by taking the
						    control away. the console's submits are the same shape
						    (packages/console-ui/src/lib/connect-panel.tsx). */}
						<Button variant="primary" aria-busy={signingIn}>
							{SCREEN_TITLE}
						</Button>
					</div>
				</Stack>
			</Form>
		</PanelRoute>
	);
}
