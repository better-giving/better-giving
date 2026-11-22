import type { ShouldRevalidateFunctionArgs } from 'react-router';
import { DonateNotice } from '$lib/donate/notice';
import { FORM_LOOK, PlainPage } from '$lib/donate/plain-page';
import { ProgramClosedPage, ProgramPage, programPageLinks } from '$lib/donate/program-page';
import { meterDonorPage } from '$lib/server/api/meter';
import { loadProgramPage } from '$lib/server/pages/program-page';
import { database, overDonorPageLimit, platform } from '../context';
import type { DonorPolicyHandle } from '../document-policy';
import type { Route } from './+types/programs.$id_.preview';

// a program's public page as the program editor's Public page card frames it, at
// `/programs/{id}/preview` (`PublicPageCard` in $lib/admin/programs/public-page.tsx).
//
// the page ./programs.$id.tsx serves, read by the same loader and drawn with its card inert
// (`ProgramPage`'s `preview`), so the frame shows what is saved and nothing in it can start a gift.
// public as that page is, and for its reasons: it shows nothing that page does not, so it mounts
// that page's meter and no session gate. an archived program and an id no program has draw that
// page's closed screen under its one 404.
//
// the `$id_` keeps it out of ./programs.$id.tsx's layout: that page draws no outlet.
//
// the one document this deployment lets be framed, by its own pages alone (`framedBy` below,
// ../document-policy.ts), and kept out of search: the program's address is ./programs.$id.tsx.

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

/** the loader runs again only for another program, as ./programs.$id.tsx's does. */
export function shouldRevalidate({ currentParams, nextParams }: ShouldRevalidateFunctionArgs) {
	return currentParams.id !== nextParams.id;
}

/** every answer's `cache-control`, carried out of the loader. */
export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export const handle: DonorPolicyHandle = { documentPolicy: 'donor', framedBy: 'self' };

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
	const noindex = { name: 'robots', content: 'noindex' };
	if (loaderData.kind !== 'program') return [{ title: 'Donate' }, noindex];
	return [{ title: loaderData.program.name }, noindex];
}

export function links(): Route.LinkDescriptors {
	return programPageLinks();
}

export default function ProgramPreviewRoute({ loaderData }: Route.ComponentProps) {
	switch (loaderData.kind) {
		case 'program': {
			const { kind: _kind, ...page } = loaderData;
			return <ProgramPage {...page} preview />;
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
