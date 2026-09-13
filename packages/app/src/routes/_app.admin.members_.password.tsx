import { MIN_ADMIN_PASSWORD_LENGTH } from '@better-giving/operator/admin-password';
import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { Field } from '@better-giving/operator/components/forms/Field';
import { Column, Stack } from '@better-giving/operator/components/shell/Layout';
import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { useSaveState } from '@better-giving/operator/save-state.react';
import { getFormProps } from '@conform-to/react';
import { data, Form, redirect, useNavigation } from 'react-router';
import { z } from 'zod';
import { buttonState } from '$lib/admin/save-button-state';
import { savedSection } from '$lib/admin/saved-section';
import { screenTitle } from '$lib/admin/screen-title';
import { boxProps, useAdminForm } from '$lib/admin/use-admin-form';
import { defineForm } from '$lib/forms/definition';
import {
	isRateLimited,
	signInRateLimitKey,
	signInRateLimitMessage
} from '$lib/server/api/rate-limit';
import { changeMemberPassword, STAFF_USER_ID } from '$lib/server/auth';
import { invalid, parseForm, unread } from '$lib/server/conform';
import { redirectWithFlash, SAVED_FLASH, takeFlash } from '$lib/server/flash';
import { auth, platform, staff } from '../context';
import type { Route } from './+types/_app.admin.members_.password';

// a colleague changes their own password, and nobody changes anybody else's.
//
// the write is `changeMemberPassword` in `$lib/server/auth/members.ts` and everything about what
// it does to the account is argued there — that the session in the headers is the whole of who it
// is for, and that every other session ends. what this route owns is who is refused, what one
// press may buy, and where the outcome lands.
//
// **the deployer is refused, and the same predicate answers twice.** `context.get(staff).id ===
// STAFF_USER_ID` sends their `GET` back to /admin/members and answers their `POST` 403 — the
// loader's half so nothing is offered that would then be refused, the action's so a hand-written
// body is refused too. their password is a deploy-time secret with no `auth_account` row behind it
// ($lib/server/auth/credential.ts), so there is nothing at this address to change and the console
// is where it is changed. `changeMemberPassword` refuses them by name as well, and that arm stays
// reachable only through a session this route did not gate.
//
// **it charges the sign-in bucket before it reads anything.** a wrong current password is a guess
// at a member's credential, and `signInRateLimitKey` has one payer per deployment rather than one
// per path (CLAUDE.md → Product surface, `$lib/server/api/rate-limit.ts`) — a bucket of this
// screen's own would hand whoever holds a stolen session a second budget for the same guessing the
// login already bounds. it is charged ahead of `request.formData()` for the reason ./login.tsx's
// is: a refusal that had already read the body would have spent the parse and the hash it exists
// to save.
//
// **the cookies ride the redirect.** better-auth revokes every session the member held, this
// request's included, and mints a replacement on the response it would have sent from an HTTP
// router this deployment does not serve (CLAUDE.md). so the `set-cookie` values are appended by
// hand onto the 303, exactly as ./_app.admin.sign-out.ts appends the clearing one — dropped, the
// screen would sign the member out of the browser they are standing in.
//
// this screen reports at the control the operator pressed, never in a band at the head: Change
// password is a `SaveButton` and draws its own confirmation, which survives its own redirect as a
// flash ($lib/server/flash.ts). the banner above the form carries the two refusals that belong to
// no box.

/** the screen's name, rendered as the document title and as the heading. */
const SCREEN_TITLE = 'Your password';

/** the address this screen answers on, and the one a write redirects back to. */
const SCREEN = '/admin/members/password';

/** where a session with nothing to change here is sent. */
const MEMBERS = '/admin/members';

/** what an empty box and a box the request did not carry are both told. */
const MISSING = 'required';

/**
 * cap on what one press here can ask to be hashed.
 *
 * the same 128 ./join.tsx states and for the same reason — it is better-auth's own maximum, so a
 * value past it is refused under the box rather than coming back as `PASSWORD_TOO_LONG` with
 * nothing on the screen saying which box it was about. it bounds the current box too, which is the
 * only length a password on this deployment was ever allowed to be: /join is where every member's
 * was set.
 */
const MAX_PASSWORD_LENGTH = 128;

/**
 * the one form this screen carries: the password held now, and the one to hold instead.
 *
 * `withheld` is not a choice — a schema naming either of these makes it a required property, and
 * an empty list is refused when the form is stated ($lib/server/conform.ts's header argues it).
 *
 * neither is trimmed, for the reason ./join.tsx and ./login.tsx give: a leading or trailing space
 * is a character of the secret, and quietly removing one turns a correct paste into a password
 * that will not sign them in tomorrow.
 *
 * no confirm box beside the new one, which is /join's shape: the box is what the member will type
 * at the login tomorrow, and a second copy of it buys a typo caught here at the cost of a second
 * credential rendered into the page on every rejection.
 *
 * the minimum comes from the leaf package because this statement is read in the browser too, and
 * nothing under `$lib/server/**` may be (../routes.spec.ts). it is `MEMBER_PASSWORD_MIN_LENGTH` by
 * construction: $lib/server/auth/invitations.ts imports this constant as that one.
 */
const CHANGE_FORM = defineForm({
	id: 'member-password',
	withheld: ['current_password', 'new_password'],
	schema: z.object({
		current_password: z
			.string({ error: MISSING })
			.min(1, { error: MISSING })
			.max(MAX_PASSWORD_LENGTH, { error: `must be at most ${MAX_PASSWORD_LENGTH} characters` }),
		new_password: z
			.string({ error: MISSING })
			.min(MIN_ADMIN_PASSWORD_LENGTH, {
				error: `must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`
			})
			.max(MAX_PASSWORD_LENGTH, { error: `must be at most ${MAX_PASSWORD_LENGTH} characters` })
	})
});

/**
 * the marker the redirect carries and the whole of what this screen reports.
 *
 * one section, named as $lib/admin/saved-section.ts asks of every screen, and the loader turns it
 * into `changed` without a lookup.
 */
const SAVED = 'password';
const SAVED_SECTIONS = [SAVED] as const;

/** what the member is told the new box wants before they have typed in it. */
const PASSWORD_HINT = `At least ${MIN_ADMIN_PASSWORD_LENGTH} characters.`;

/** what the current box says when it is not the password the member is holding. */
const WRONG_CURRENT = 'does not match your password';

/**
 * what a POST from the deployer's session is answered with.
 *
 * this screen is not served to them at all, so a body that arrives is one this app's markup could
 * not have sent and no box on it is what went wrong. it comes back as a form-level refusal all the
 * same, because every rejection in /admin does — a hand-built failure response from a module that
 * holds a form is what `packages/app/form-rules.spec.ts` refuses. a 4xx body in this app is read by
 * an agent (CLAUDE.md), so the sentence names where the value is set instead.
 */
const NOT_A_MEMBER =
	'The deployer’s sign-in password is a deploy-time secret rather than an account on this ' +
	'deployment, and is not changed here. Open the console (`better-giving start`) and set ' +
	'`ADMIN_PASSWORD`.';

/**
 * what a refusal that is about the deployment says.
 *
 * the same shape ./join.tsx's is and for the same reason: the auth layer's own message is written
 * for an agent reading a status body, so what the screen gets is the pointer rather than the
 * answer. already logged where it was classified ($lib/server/auth/members.ts).
 */
const UNAVAILABLE =
	'Your password could not be changed: something is wrong with this deployment rather than with ' +
	'what you typed. The exact cause is in the deployment’s logs: the Cloudflare dashboard has ' +
	'them, and `pnpm run logs` reads them from a checkout.';

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
	// the half of the one predicate that keeps the deployer from being offered a form the action
	// would refuse. see this module's header for why it is the whole of who is turned away.
	if (context.get(staff).id === STAFF_USER_ID) throw redirect(MEMBERS, 303);

	// the change that just landed, taken: read and cleared on this one response, so a reload
	// reports nothing ($lib/server/flash.ts owns that).
	const landed = await takeFlash(request, SAVED_FLASH);

	return data(
		{ changed: savedSection(landed?.marker ?? null, SAVED_SECTIONS) !== null },
		// the header that burns the marker rides on the response that publishes it. a `Set-Cookie`
		// from a loader is sent without this route exporting `headers` — react router preserves that
		// one header on its own.
		landed === null ? {} : { headers: { 'Set-Cookie': landed.clear } }
	);
}

/**
 * the one write this screen performs.
 *
 * **the request body is read exactly once, here, by the action that owns it** — `parseForm` reads
 * what it returns and nothing above this route may.
 *
 * the auth instance is the gate's own, off the request context (../context.ts): a second one here
 * would read the signing-key row again and would be a route resolving auth of its own, which
 * ../routes.spec.ts refuses.
 */
export async function action({ context, request }: Route.ActionArgs) {
	// refused before the bucket is charged as well as before the body is read: the deployer holds a
	// session already and is not the guesser the limiter exists to bound, so spending their attempt
	// would let one browser hold the login closed on every member at once.
	if (context.get(staff).id === STAFF_USER_ID) {
		return invalid(403, unread(CHANGE_FORM, NOT_A_MEMBER));
	}

	// see this module's header for why it is the sign-in bucket rather than one of this screen's
	// own, and why the charge is ahead of the body. the rejection is built from the statement and
	// not from the request, which is what keeps it there.
	const { env } = context.get(platform);
	if (await isRateLimited(env.SIGN_IN_RATE_LIMITER, signInRateLimitKey(request))) {
		return invalid(429, unread(CHANGE_FORM, signInRateLimitMessage()));
	}

	const submission = parseForm(await request.formData(), CHANGE_FORM);

	// a blank box and one over the cap are both rejections the box itself explains, and both are
	// refused before anything is hashed.
	if (!submission.ok) return invalid(400, submission.reject());

	const changed = await changeMemberPassword(context.get(auth), {
		currentPassword: submission.value.current_password,
		newPassword: submission.value.new_password,
		headers: request.headers
	});

	if (!changed.ok) {
		switch (changed.reason) {
			case 'current':
				return invalid(
					400,
					submission.reject({ fieldErrors: { current_password: [WRONG_CURRENT] } })
				);
			case 'password':
				// the schema already refuses what better-auth would, so this arm is the two
				// disagreeing — a minimum raised on one side and not the other, which is the arm
				// ./join.tsx keeps for the same pair. it lands under the box all the same, because
				// the box is still what has to change.
				return invalid(
					400,
					submission.reject({
						fieldErrors: {
							new_password: [`must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`]
						}
					})
				);
			case 'deployer':
				// unreachable through the predicate above, and kept because the predicate is this
				// route's and the refusal is the auth module's: a session resolved some other way
				// gets the same sentence rather than a 500.
				return invalid(403, submission.reject({ formErrors: [NOT_A_MEMBER] }));
			case 'unavailable':
				return invalid(500, submission.reject({ formErrors: [UNAVAILABLE] }));
		}
	}

	// POST-redirect-GET, so a reload does not re-submit a password that has already been replaced.
	// the marker is this screen's one section, and the loader turns it back into the press's
	// confirmation.
	const response = await redirectWithFlash(request, SAVED_FLASH, SCREEN, SAVED);
	// see this module's header: every session the member held was revoked, this one included, so a
	// response that carried no replacement would sign them out of the browser they are looking at.
	for (const cookie of changed.cookies) response.headers.append('set-cookie', cookie);
	return response;
}

export default function YourPassword({ loaderData, actionData }: Route.ComponentProps) {
	const [form, fields] = useAdminForm(CHANGE_FORM, actionData);
	const navigation = useNavigation();

	// `!actionData` for the reason ./_app.admin.members.tsx gives: a refused write is answered with
	// a rejection rather than a redirect, so the marker the last landing published is still on the
	// page — and a tick over a request that was just refused is two answers to one press.
	const save = useSaveState({
		landed: loaderData.changed && !actionData,
		// conform's own reading against the seed this form was mounted on, which is no seed at all:
		// both boxes arrive empty, so anything in either is something to send.
		changed: form.dirty,
		pending: navigation.state === 'submitting'
	});

	// what a refused attempt says about the attempt as a whole, above the form. the sentence about
	// a box is under that box and is the field's own.
	const refusal = form.errors?.[0];

	return (
		<Column>
			<PageHeader title={SCREEN_TITLE} />
			{refusal ? (
				<Banner tone="blocker" word="Not changed">
					<MarkedText text={refusal} />
				</Banner>
			) : null}
			{/* no `action` attribute, so this posts to the address the member is standing on. */}
			<Form method="post" {...getFormProps(form)}>
				<Stack tight>
					<Field
						{...boxProps(fields.current_password)}
						label="Current password"
						type="password"
						autoComplete="current-password"
						required
					/>
					{/* the rule is stated over the box as well as under it: a screen that first
					    mentions a minimum in a refusal is one somebody submits, corrects and submits
					    again to find out what it wanted. */}
					<Field
						{...boxProps(fields.new_password)}
						label="New password"
						type="password"
						autoComplete="new-password"
						required
						hint={PASSWORD_HINT}
					/>
					<div className="adm-actions">
						<SaveButton
							label="Change password"
							doneLabel="Password changed"
							state={buttonState(save)}
						/>
					</div>
				</Stack>
			</Form>
		</Column>
	);
}
