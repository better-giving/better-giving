import { data, href } from 'react-router';
import { defineForm } from '$lib/forms/definition';
import { INTENTS, SIGN_IN_FORM } from '$lib/supporter/area/forms';
import { supporterAreaLinks } from '$lib/supporter/area/links';
import { SignIn, type SignInState } from '$lib/supporter/area/sign-in';
import { usePosting } from '$lib/supporter/area/use-posting';
import { refuseWriteFromAnotherOrigin } from '$lib/server/auth/gate';
import { invalid, parseForm } from '$lib/server/conform';
import {
	redirectWithFlash,
	SUPPORTER_SENT_FLASH,
	SUPPORTER_SIGN_IN_FLASH,
	takeFlash
} from '$lib/server/flash';
import { linkMailer, readSupporterOrg } from '$lib/server/supporters/area';
import { requestSignInLink } from '$lib/server/supporters/links';
import { database, platform } from '../context';
import type { Route } from './+types/fundraise.sign-in';

// Manage your fundraisers: a supporter asks for a sign-in link by the address they started with.
// `request-link` answers the same for every address, known or not — on to Check your email — and
// the lookup and the mail run after the answer (`requestSignInLink` in
// $lib/server/supporters/links.ts). over the caller's or the address's limit it is the too-many
// state, here.
//
// a link that no longer opens lands here too (./fundraise.open.ts), as does a resend over its
// limit (./fundraise.sent.tsx), each with a flash saying which ($lib/server/flash.ts).

/** the screen's form as the action parses it: the one `SignIn` mounts. */
const SIGN_IN = defineForm({ id: SIGN_IN_FORM.id, schema: SIGN_IN_FORM.schema });

/** the state a flash sends this screen in: `expired`, or `too-many <address>`. */
function stateOf(marker: string): SignInState {
	if (marker === 'expired') return { kind: 'expired' };
	if (marker.startsWith('too-many ')) {
		return { kind: 'too-many', email: marker.slice('too-many '.length) };
	}
	return { kind: 'ask' };
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const [org, landed] = await Promise.all([
		readSupporterOrg(context.get(database)),
		takeFlash(request, SUPPORTER_SIGN_IN_FLASH)
	]);
	const state: SignInState = landed === null ? { kind: 'ask' } : stateOf(landed.marker);
	// react router carries a loader's `Set-Cookie` onto the document itself
	// (react-router/docs/how-to/headers.md).
	return data({ org, state }, landed === null ? {} : { headers: { 'Set-Cookie': landed.clear } });
}

export async function action({ context, request }: Route.ActionArgs) {
	refuseWriteFromAnotherOrigin(request);
	const db = context.get(database);
	const { env, deferred } = context.get(platform);
	const submission = parseForm(await request.formData(), SIGN_IN);
	if (!submission.ok) return invalid(400, submission.reject(), { tooMany: null });
	const { email } = submission.value;
	const asked = await requestSignInLink(
		{
			db,
			limiter: env.SIGN_IN_RATE_LIMITER,
			defer: (work) => deferred.waitUntil(work),
			sendLink: linkMailer(db, env, new URL(request.url).origin),
			now: new Date()
		},
		request,
		email
	);
	if (asked === 'too_many') return invalid(429, submission.reject(), { tooMany: email });
	return redirectWithFlash(
		request,
		SUPPORTER_SENT_FLASH,
		href('/fundraise/sent'),
		`sign-in ${email}`
	);
}

export function meta(): Route.MetaDescriptors {
	return [{ title: 'Manage your fundraisers' }];
}

export function links(): Route.LinkDescriptors {
	return supporterAreaLinks();
}

export default function SignInRoute({ loaderData, actionData }: Route.ComponentProps) {
	const tooMany = actionData?.tooMany;
	const state: SignInState =
		typeof tooMany === 'string' ? { kind: 'too-many', email: tooMany } : loaderData.state;
	return (
		<SignIn
			org={loaderData.org}
			state={state}
			lastResult={actionData?.form.result}
			sending={usePosting(INTENTS.requestLink)}
		/>
	);
}
