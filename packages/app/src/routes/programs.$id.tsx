import type { ShouldRevalidateFunctionArgs } from 'react-router';
import { DonateNotice } from '$lib/donate/notice';
import { FORM_LOOK, PlainPage } from '$lib/donate/plain-page';
import { ProgramClosedPage, ProgramPage, programPageLinks } from '$lib/donate/program-page';
import { imageSrc } from '$lib/page/image-src';
import { meterDonorPage } from '$lib/server/api/meter';
import { loadProgramPage } from '$lib/server/pages/program-page';
import { database, overDonorPageLimit, platform } from '../context';
import type { DonorPolicyHandle } from '../document-policy';
import type { Route } from './+types/programs.$id';

// one program's public page, at `/programs/{id}` on the deployment.
//
// a donor screen, dressed and served as ./_index.tsx is — the form's sheets, the donor document
// policy, no operator component — and everything that route's header says of the reader, the origin
// and the gift holds here unchanged. there is no action: the card's gift goes to
// `/api/v1/forms/:id/donations` against the Donation page's own settings row, carrying the program
// as `pageProgramId`, which credits it whatever that row's program setting says (`mintQuote` in
// $lib/server/donations/quote.ts). the card is served that row's config with its `program` left off
// (`loadProgramFrame` in $lib/server/pages/view.ts), so it draws no Program row. the only write is
// `ensureDonationPage`'s, the one ./_index.tsx makes: the Donation page made on first need, and its
// row's program following the active programs while the operator has chosen none.
//
// an archived program and an id no program has are one screen with one body under one 404, naming
// no program, so the answer says nothing about which ids exist. a refusal of the Donation page's
// served config, and the rate limit's, come first: neither can draw a card, and the plain notice
// they draw names nobody either.
//
// every view is charged per address before the loader reads anything (`meterDonorPage` in
// $lib/server/api/meter.ts), and every answer is `no-store`, for the reason ./_index.tsx gives.

export const middleware: Route.MiddlewareFunction[] = [meterDonorPage];

export function loader({ context, params, request }: Route.LoaderArgs) {
	return loadProgramPage({
		db: context.get(database),
		env: context.get(platform).env,
		overLimit: context.get(overDonorPageLimit),
		programId: params.id,
		request
	});
}

/**
 * the loader runs again only for an address naming another program: on the same address a re-read
 * could only swap the config under a gift in progress, the argument `shouldRevalidate` in
 * ./_index.tsx makes.
 */
export function shouldRevalidate({ currentParams, nextParams }: ShouldRevalidateFunctionArgs) {
	return currentParams.id !== nextParams.id;
}

/** every answer's `cache-control`, carried out of the loader as ./_index.tsx carries it. */
export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

/** the donor page's document policy, which ../document-policy.ts lists and cites. */
export const handle: DonorPolicyHandle = { documentPolicy: 'donor' };

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
	if (loaderData.kind !== 'program') return [{ title: 'Donate' }];
	const { program, sharing } = loaderData;
	return [
		{ title: program.name },
		...(program.photoImageId === null
			? []
			: [
					{
						property: 'og:image',
						content: new URL(imageSrc(program.photoImageId), sharing.url).href
					}
				])
	];
}

export function links(): Route.LinkDescriptors {
	return programPageLinks();
}

export default function ProgramRoute({ loaderData }: Route.ComponentProps) {
	switch (loaderData.kind) {
		case 'program': {
			const { kind: _kind, ...page } = loaderData;
			return <ProgramPage {...page} />;
		}
		case 'closed':
			return (
				<ProgramClosedPage org={loaderData.org} logo={loaderData.logo} look={loaderData.look} />
			);
		case 'refused':
			return (
				<PlainPage look={FORM_LOOK}>
					<DonateNotice />
				</PlainPage>
			);
	}
}
