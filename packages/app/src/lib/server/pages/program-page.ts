import { RESUME_FORM_PARAM } from '@better-giving/form/embed/resume';
import { data, href } from 'react-router';
import { giveToProgram } from '$lib/donate/copy';
import { donorPageRateLimitRefusal } from '$lib/server/api/rate-limit';
import type { Db } from '$lib/server/db/client';
import { ensureDonationPage } from '$lib/server/pages/donation-page';
import { loadProgramFrame, refusedPage } from '$lib/server/pages/view';
import { readProgram } from '$lib/server/programs/queries';

// what one program's page answers, read once for its two addresses: the public page
// (src/routes/programs.$id.tsx, whose header argues each answer) and the program editor's preview
// of it (src/routes/programs.$id_.preview.tsx), which draws the same page and so must answer the
// same rows the same way.

export async function loadProgramPage({
	db,
	env,
	overLimit,
	programId,
	request
}: {
	readonly db: Db;
	readonly env: unknown;
	/** the verdict `meterDonorPage` in $lib/server/api/meter.ts put on the request. */
	readonly overLimit: boolean;
	readonly programId: string;
	readonly request: Request;
}) {
	if (overLimit) return donorPageRateLimitRefusal();
	const donationPage = await ensureDonationPage(db);
	const frame = await loadProgramFrame(db, env, donationPage.formId, request, { now: Date.now() });
	if (frame === null) return refusedPage();
	const { org, logo, look, config } = frame;
	const found = await readProgram(db, programId);
	if (found === null || found.archivedAt !== null) {
		return data({ kind: 'closed', org, logo, look } as const, {
			status: 404,
			headers: { 'cache-control': 'no-store' }
		});
	}
	const url = new URL(request.url);
	const program = {
		id: found.id,
		name: found.name,
		description: found.description,
		photoImageId: found.imageId
	};
	return data(
		{
			kind: 'program',
			program,
			org,
			logo,
			look,
			sharing: {
				message: giveToProgram(program.name),
				url: programPageUrl(url.origin, program.id)
			},
			config,
			// a donor's return from authorizing their gift, read as src/routes/_index.tsx reads it.
			resuming: url.searchParams.get(RESUME_FORM_PARAM) === config.formId
		} as const,
		{ headers: { 'cache-control': 'no-store' } }
	);
}

/** a program's public page as an absolute address on `origin`: what its page shares and its editor shows. */
export function programPageUrl(origin: string, programId: string): string {
	return `${origin}${href('/programs/:id', { id: programId })}`;
}
