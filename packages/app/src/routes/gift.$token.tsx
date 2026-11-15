import { MAX_EMPLOYER } from '@better-giving/form/v1';
import { z } from 'zod';
import { GiftPage, giftPageLinks } from '$lib/donate/gift-page';
import { FORM_LOOK, PlainPage } from '$lib/donate/plain-page';
import { defineForm, type FormRejection, type RejectionStatus } from '$lib/forms/definition';
import { refuseWriteFromAnotherOrigin } from '$lib/server/auth/gate';
import { invalid, parseForm, unread } from '$lib/server/conform';
import { createEmailProvider } from '$lib/server/email/factory';
import { giftLinkOrigin } from '$lib/server/matching/links';
import { DONOR, markFiled } from '$lib/server/matching/match';
import { employerNamed } from '$lib/server/matching/pack';
import { readGiftPage } from '$lib/server/matching/views';
import { readOrgProfile, readOrgProfileLogo } from '$lib/server/org/queries';
import { refusedPage } from '$lib/server/pages/view';
import { database, platform } from '../context';
import type { Route } from './+types/gift.$token';

// the donor's own page for one gift, at `/gift/{token}`: the details their employer's giving portal
// asks for, the employer they named, and that they filed it ($lib/donate/gift-page.tsx draws it).
//
// no sign-in: the token is the permission, as on ./photo.$token.tsx. it is 160 bits minted with the
// gift (`mintGiftMatchToken` in $lib/server/db/schema.ts) and reaches the donor in their receipt,
// the pack and the thank-you. a token no gift holds, a malformed one and one whose gift is not in
// the books yet are the same 404 with the same body, on a visit and on a post, so the answer says
// nothing about tokens a caller does not hold.
//
// every answer is `no-store` and `no-referrer`, carried by `headers` below, which react router
// reads for the document and for the `.data` answers alike: the address is the capability, so a
// kept copy or a referrer carrying it hands the page to whoever holds either. ../document-policy.ts
// keeps the `no-referrer` over its own.
//
// the posts are the page's two `<Form>`s, told apart by their `intent` box; each refusal goes
// through `invalid()` with the `{ intent, error }` the page places at the control that was pressed.

const CAPABILITY = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } as const;

const EMPLOYER_BLANK = 'Enter your employer’s name.';
const EMPLOYER_LONG = `Use ${MAX_EMPLOYER} characters or fewer.`;
const CLOSED = 'This match request is closed, so there is nothing more to change.';
const UNKNOWN = 'This link doesn’t open a gift. Use the link in your receipt email.';
const NOT_A_POST =
	'This page takes the posts its own forms send: `intent` is `employer` or `filed`.';

// the length is counted in characters, as `employerOf` in $lib/server/matching/match.ts counts it;
// the bound is the form package's, since a module-scope value here is one the browser bundle keeps.
const EMPLOYER_FORM = defineForm({
	id: 'gift-employer',
	schema: z.object({
		intent: z.literal('employer', { error: NOT_A_POST }),
		employer: z
			.string({ error: EMPLOYER_BLANK })
			.trim()
			.min(1, EMPLOYER_BLANK)
			.refine((typed) => [...typed].length <= MAX_EMPLOYER, EMPLOYER_LONG)
	})
});
const FILED_FORM = defineForm({
	id: 'gift-filed',
	schema: z.object({ intent: z.literal('filed') })
});

export async function loader({ context, params }: Route.LoaderArgs) {
	const db = context.get(database);
	// the origin the scheduled sweep names the page on (src/cron-runs.ts), which it sends nothing without.
	const swept = giftLinkOrigin(context.get(platform).env, null) !== null;
	const [gift, profile, logo] = await Promise.all([
		readGiftPage(db, params.token, swept),
		readOrgProfile(db),
		readOrgProfileLogo(db)
	]);
	// a gift is taken only once the profile is saved ($lib/server/forms/readiness.ts), so a missing
	// profile under a real gift is a deployment whose row was removed, and its page is no page.
	if (gift === null || profile === null) return refusedPage();
	return {
		kind: 'gift',
		// the legal name: the profile holds no display name for the prose to use, and the filing rows
		// name the legal one.
		orgName: profile.legalName,
		logo,
		look: { brandColour: profile.brandColour },
		gift
	} as const;
}

/**
 * the donor naming their employer or saying they filed. a post that changes nothing answers as the
 * thing asked where it already holds — filed twice, matched (which counts as filed), the same
 * employer again — and as a refusal sentence at a 409 where the claim is closed; never a 404, which
 * is the unknown token's alone.
 */
export async function action({ context, params, request }: Route.ActionArgs) {
	refuseWriteFromAnotherOrigin(request);
	// a refusal, with the `{ intent, error }` the page reads beside the form's own result.
	const refuse = (
		status: RejectionStatus,
		rejection: FormRejection,
		intent: 'employer' | 'filed',
		error: string
	) => invalid(status, rejection, { intent, error });
	const db = context.get(database);
	const body = await request.formData().catch(() => null);
	if (body === null) return refuse(400, unread(FILED_FORM, NOT_A_POST), 'filed', NOT_A_POST);
	const intent = body.get('intent') === 'filed' ? 'filed' : 'employer';
	// the loader's 404 for the loader's reasons, so a post learns no more about a token than a visit.
	if ((await readGiftPage(db, params.token, false)) === null) {
		const rejection =
			intent === 'filed' ? unread(FILED_FORM, UNKNOWN) : unread(EMPLOYER_FORM, UNKNOWN);
		return refuse(404, rejection, intent, UNKNOWN);
	}
	const key = { token: params.token };
	const now = new Date();

	if (intent === 'filed') {
		// the one box is the `intent` read above, so what the parse adds is the seam's refusal of a
		// body no page here sends, which it throws.
		const { reject } = parseForm(body, FILED_FORM);
		const written = await markFiled(db, key, DONOR, now);
		if (!written.ok) return refuse(404, reject(), intent, UNKNOWN);
		if (written.state.voidedAt !== null) return refuse(409, reject(), intent, CLOSED);
		return { done: 'filed' } as const;
	}

	const parsed = parseForm(body, EMPLOYER_FORM);
	if (!parsed.ok) {
		const rejection = parsed.reject();
		const error = rejection.result.error?.intent?.[0] ?? rejection.result.error?.employer?.[0];
		return refuse(400, rejection, intent, error ?? EMPLOYER_BLANK);
	}
	const { env, deferred } = context.get(platform);
	const written = await employerNamed(
		{
			db,
			email: createEmailProvider(env),
			giftOrigin: giftLinkOrigin(env, new URL(request.url)),
			defer: (work) => deferred.waitUntil(work)
		},
		key,
		parsed.value.employer,
		now
	);
	if (!written.ok) {
		return written.reason === 'not_found'
			? refuse(404, parsed.reject(), intent, UNKNOWN)
			: refuse(400, parsed.reject(), intent, EMPLOYER_LONG);
	}
	if (written.state.voidedAt !== null || written.state.matchedAt !== null) {
		return refuse(409, parsed.reject(), intent, CLOSED);
	}
	return { done: 'employer' } as const;
}

/** every answer's `cache-control` and `referrer-policy`, the refusals' and the errors' included. */
export function headers() {
	return CAPABILITY;
}

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
	const title = loaderData?.kind === 'gift' ? `Your gift to ${loaderData.orgName}` : 'Your gift';
	return [{ title }, { name: 'robots', content: 'noindex' }];
}

export function links(): Route.LinkDescriptors {
	return giftPageLinks();
}

export default function GiftRoute({ loaderData, actionData }: Route.ComponentProps) {
	if (loaderData.kind === 'refused') {
		return (
			<PlainPage look={FORM_LOOK}>
				<div className="notice">
					<p>{UNKNOWN}</p>
				</div>
			</PlainPage>
		);
	}
	return (
		<GiftPage
			orgName={loaderData.orgName}
			logo={loaderData.logo}
			look={loaderData.look}
			gift={loaderData.gift}
			result={actionData}
		/>
	);
}
