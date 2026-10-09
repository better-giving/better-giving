import { passwordReset } from '@better-giving/emails';
import { renderEmail } from '@better-giving/emails/render';
import { Button } from '@better-giving/operator/components/controls/Button';
import { Field } from '@better-giving/operator/components/forms/Field';
import { PanelRoute } from '@better-giving/operator/components/shell/AppShell';
import { Stack } from '@better-giving/operator/components/shell/Layout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { getFormProps } from '@conform-to/react';
import { Form, Link, useNavigation } from 'react-router';
import { z } from 'zod';
import { operatorLinks } from '$lib/admin/operator-links';
import { APP_NAME } from '$lib/admin/screen-title';
import { type AdminActionData, boxProps, useAdminForm } from '$lib/admin/use-admin-form';
import { defineForm } from '$lib/forms/definition';
import {
	isRateLimited,
	signInRateLimitKey,
	signInRateLimitMessage
} from '$lib/server/api/rate-limit';
import { createAuth, readAuthEnv, requestPasswordReset, resolveAuthSecret } from '$lib/server/auth';
import { SIGNING_KEY_UNREADABLE } from '$lib/server/auth/signing-key';
import { readSetupState } from '$lib/server/config/setup-state';
import { invalid, parseForm, unread } from '$lib/server/conform';
import { createEmailProvider } from '$lib/server/email/factory';
import { database, platform } from '../context';
import type { Route } from './+types/forgot';

// where a member who cannot sign in asks for a link, and the third write this deployment serves to
// a caller with no session.
//
// it is outside ./_app.tsx deliberately and ../routes.spec.ts is what holds that to a line
// somebody typed: the file is on `PUBLIC_ROUTE_FILES` with the reason beside it. what it owes
// instead of a session is the sign-in limiter, charged in its own action before the body is read —
// a request here mails whoever is named, so an unbounded form is a way to post somebody else's
// inbox from this deployment's own address, and the bucket is the whole of what bounds that. it is
// the same bucket ./login.tsx spends, on a key that never moves with the path
// ($lib/server/api/rate-limit.ts), so a guesser cannot buy a fresh budget by arriving here instead.
//
// being outside every layout is also why this module builds its own auth instance rather than
// taking the gate's off the request context, exactly as ./login.tsx and ./join.tsx do: nothing
// above this route resolves one.
//
// **every address gets the same answer, and the answer names nobody.** a member's, a stranger's and
// the deployer's own identifier all leave this action as `sent`. `requestPasswordReset` in
// $lib/server/auth/members.ts is where that is decided and argued — telling them apart would turn
// this form into a way to ask whether a given person works here, on a deployment whose donation
// page names the organisation — and the deployer is refused inside it by name, because their
// password is a deploy-time var with no `auth_account` row behind it.
//
// **the reset runs in `waitUntil`, after the answer has left.** the lookup, the row a member's link
// is written to and the mail are all handed to the request's `ctx.waitUntil` by
// `requestPasswordReset`, so an address this deployment has is answered in the time one it does not
// — the timing is the rest of what the answer withholds. it is also why a reset that fails is a
// log line and never a banner here.
//
// **the link is composed here and nowhere else**, the same split ./_app.admin.members.tsx states
// about the invitation: the auth module hands over an address and a token and reads no url, no
// origin and no header, so the host this deployment answers on is known in exactly one place.

/** the screen's name, rendered as the document title and as the heading. */
const SCREEN_TITLE = 'Reset your password';

/** what an empty box and a box the request did not carry are both told. */
const MISSING = 'required';

/** the longest address there is (RFC 5321), so a body cannot buy an unbounded lookup. */
const MAX_EMAIL_LENGTH = 254;

/**
 * the one box this screen has, stated once for the action that reads a body against it and the
 * screen that submits to it.
 *
 * the address is lower-cased and trimmed, because better-auth lower-cases on every lookup and a
 * pasted address carries the space after it. `requestPasswordReset` normalises again on its own
 * side, which is what makes this the box's rule rather than the lookup's.
 *
 * required and `type="email"` where ./login.tsx's is optional and plain text: that box is the
 * deployer's way in as well, and this one is not — the deployer's password is not reset from here
 * at all.
 *
 * nothing is withheld: the address is an ordinary box and comes back holding what was typed, like
 * every other box in this app.
 *
 * it sits in this module rather than beside it because every file directly under ./ is an address
 * to `flatRoutes` whatever its extension (../routes.ts).
 */
const FORGOT_FORM = defineForm({
	id: 'forgot',
	schema: z.object({
		email: z
			.string({ error: MISSING })
			.trim()
			.toLowerCase()
			.min(1, { error: MISSING })
			.max(MAX_EMAIL_LENGTH, { error: `must be at most ${MAX_EMAIL_LENGTH} characters` })
	})
});

/**
 * what everybody who asks is told, whether or not there was anybody to send to.
 *
 * it states the hour rather than leaving it to the mail, because the person reading it is deciding
 * how long to wait before asking again. the number is `PASSWORD_RESET_LIFETIME_SECONDS` in
 * $lib/server/auth/index.ts, which a component may not import — that module is under
 * `$lib/server/**` and this sentence renders in the browser (../routes.spec.ts) — and the mail
 * states the same hour in its own words.
 */
const SENT =
	'If that address belongs to a member of this organisation, a link is on its way. It works ' +
	'once and for an hour.';

/**
 * what a caller is told when the edge attributed no address to the request, so there is no
 * sign-in bucket to charge and nothing is sent.
 *
 * ./login.tsx's `UNATTRIBUTED` in this screen's words, and argued there: it names the cause and the
 * switch that usually produces it, for whoever runs the deployment. it says nothing about the email
 * address typed, because the body was never read, and it names the IP address in full because
 * "your address" on a page whose one box is an email address reads as that box.
 */
const UNATTRIBUTED =
	'A reset link could not be sent. This deployment is not being told your connection’s IP ' +
	'address, so it cannot limit how many links are asked for and refuses every request until it ' +
	'is. The usual cause is Cloudflare’s “Remove visitor IP headers” setting being switched on for ' +
	'this site; whoever runs this deployment can switch it off in the Cloudflare dashboard.';

export const links = operatorLinks;

export function meta(): Route.MetaDescriptors {
	return [{ title: SCREEN_TITLE }];
}

export async function loader({ context }: Route.LoaderArgs) {
	// which deployment this is. /forgot sits outside ./_app.tsx, so the name the identity band
	// carries never reaches this page, and a page asking for an address that cannot say whose it is
	// looks the same on every fork.
	//
	// the registered name and nothing else off that row, and a failure swallowed to a null name:
	// both are ./login.tsx's decisions, and this page is served to anyone who asks for it too.
	const state = await readSetupState(context.get(database), context.get(platform).env);
	return { orgName: state?.profile?.legalName ?? null };
}

/**
 * the request for a link.
 *
 * **the request body is read exactly once, here, by the action that owns it** — `parseForm` reads
 * what it returns and nothing above this route may.
 *
 * there is no redirect on the way out, which is what makes a re-submit cheap to be wrong about: it
 * costs a bucket charge and one more mail, and the token it mints replaces every link the member has
 * not used yet, which are deleted before its mail is attempted. a delete that fails is logged and
 * the mail is still sent, so an earlier link can work beside it until a reset lands
 * ($lib/server/auth/index.ts, `emailAndPassword`).
 */
export async function action({ context, request, url }: Route.ActionArgs) {
	const { env, ctx } = context.get(platform);
	const db = context.get(database);
	const authEnv = readAuthEnv(env);

	// charged before the body is read, for the reason ./login.tsx's charge sits where it does and
	// one sharper: what an unbounded press here buys is not a hash but a message, sent from this
	// deployment's own address to whoever the body named.
	//
	// the rejection is built from the statement and not from the request, which is what keeps the
	// charge ahead of the body: a refusal that had already read it would be a refusal that spent
	// the parse it exists to save.
	//
	// a deployment with no binding sends on, and a caller the edge attributed no address to is not
	// counted at all. both are `isRateLimited`'s decisions and are argued in
	// $lib/server/api/rate-limit.ts.
	const bucket = signInRateLimitKey(request);
	if (await isRateLimited(env.SIGN_IN_RATE_LIMITER, bucket)) {
		return invalid(429, unread(FORGOT_FORM, signInRateLimitMessage()));
	}

	// so a caller with no bucket is refused here, for every address alike and before the body is
	// read. `signInRateLimitKey` argues why this site refuses all of them where ./login.tsx lets the
	// deployer through, and ./login.tsx argues the 403.
	if (bucket === null) return invalid(403, unread(FORGOT_FORM, UNATTRIBUTED));

	const submission = parseForm(await request.formData(), FORGOT_FORM);

	// a blank box and one over the cap are both rejections the box itself explains. no banner: the
	// sentence belongs under the input.
	if (!submission.ok) return invalid(400, submission.reject());

	const signingKey = await resolveAuthSecret(db, authEnv);
	if (!signingKey.ok) {
		console.error('a reset link could not be requested — no signing key:', signingKey.cause);
		return invalid(500, submission.reject({ formErrors: [SIGNING_KEY_UNREADABLE] }));
	}

	// the origin is passed rather than configured: `createAuth` derives the trusted-origin list and
	// the cookie `Secure` policy from it, so a deployment answers correctly on workers.dev and on a
	// custom domain without a deploy-time variable naming either.
	//
	// this is the one instance in the app built with a way to send. everywhere else `passwordReset`
	// is absent and better-auth refuses a reset request outright, which is what keeps this flow to
	// the one route that owns the press ($lib/server/auth/index.ts).
	const auth = createAuth(db, authEnv, {
		secret: signingKey.secret,
		requestOrigin: url.origin,
		passwordReset: {
			async send({ email, token }) {
				// the registered name, for a subject line a recipient recognises. a read that did not
				// land costs the name and not the link: this route falls back to what every screen
				// falls back to, and the member still gets their message.
				const state = await readSetupState(db, env);

				const mailed = await createEmailProvider(env).send({
					to: email,
					...(await renderEmail(
						passwordReset.template({
							orgName: state?.profile?.legalName ?? APP_NAME,
							link: `${url.origin}/reset?token=${token}`
						})
					))
				});

				// a failed send cannot reach the requester: the answer is the same for every address,
				// and one that reported a transport fault would report it only for an address this
				// deployment has. the detail names the value to fix and is written for an operator
				// holding a log line, exactly as ./_app.admin.members.tsx's failed invitation is.
				if (!mailed.ok) {
					console.error('a reset link could not be sent:', mailed.reason, mailed.detail);
				}
			}
		}
	});

	requestPasswordReset(auth, { email: submission.value.email }, (task) => ctx.waitUntil(task));
	return { sent: true as const };
}

export default function Forgot({ loaderData, actionData }: Route.ComponentProps) {
	const sent = actionData !== undefined && 'sent' in actionData;

	return (
		<PanelRoute>
			{/* the line above the heading and the heading are one block, at the tight step: the
			    panel's own gap separates blocks from each other, and an eyebrow set off its title by
			    that distance reads as a line about the page rather than as the first half of its
			    name. the name is not rendered at all when the row is missing or the read failed. */}
			<Stack tight>
				{loaderData.orgName ? <p className="adm-caption">{loaderData.orgName}</p> : null}
				<h1>{SCREEN_TITLE}</h1>
			</Stack>

			{sent ? (
				<Banner
					tone="done"
					word="Check your email"
					// the box is gone rather than left standing under the banner: a second press would
					// mint a second token and say the same thing, and the only place left to go is
					// back. what a member who mistyped does is press the link below and start again.
					actions={
						<Button as={Link} to="/login">
							Back to sign in
						</Button>
					}
				>
					{SENT}
				</Banner>
			) : (
				<RequestForm actionData={actionData} />
			)}
		</PanelRoute>
	);
}

function RequestForm({ actionData }: { readonly actionData: AdminActionData }) {
	const [form, fields] = useAdminForm(FORGOT_FORM, actionData);
	const navigation = useNavigation();
	const sending = navigation.state === 'submitting';

	// what a refused attempt says about the attempt as a whole, above the form. the sentence about
	// the box is under the box and is the field's own.
	const refusal = form.errors?.[0];

	return (
		<>
			{refusal ? (
				<Banner tone="blocker" word="No link sent">
					<MarkedText text={refusal} />
				</Banner>
			) : null}

			{/* no `action` attribute, so this posts to the current url. */}
			<Form method="post" {...getFormProps(form)}>
				<Stack tight>
					<Field
						{...boxProps(fields.email)}
						label="Email address"
						type="email"
						autoComplete="username"
						required
					/>
					<div className="adm-actions">
						{/* busy and still reachable: a disabled control leaves the tab order, so
						    switching this one off at the moment it is pressed throws the focus that
						    pressed it to the document body. */}
						<Button variant="primary" aria-busy={sending || undefined}>
							Send reset link
						</Button>
					</div>
				</Stack>
			</Form>
		</>
	);
}
