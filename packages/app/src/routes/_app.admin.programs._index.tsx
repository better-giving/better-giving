import { Button } from '@better-giving/operator/components/controls/Button';
import { EmptyState } from '@better-giving/operator/components/data/EmptyState';
import { Column, List } from '@better-giving/operator/components/shell/Layout';
import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { useEffect, useRef } from 'react';
import { data, href, Link } from 'react-router';
import { screenTitle } from '$lib/admin/screen-title';
import { PROGRAM_STATUS_LABELS } from '$lib/programs/statuses';
import { loadFailed } from '$lib/server/db/load-failure';
import { CREATED_FLASH, takeFlash } from '$lib/server/flash';
import { readPrograms } from '$lib/server/programs/queries';
import { database } from '../context';
import type { Route } from './+types/_app.admin.programs._index';

// the causes a deployment has: what a fundraiser calls the thing a gift went to. read as a loader
// and nothing else — this route has no action, because everything about a cause is written on the
// screens under `new` and `[id]`.
//
// the retired ones are on this list and the donation forms list has no equivalent, which is the one
// difference worth naming between the two: a form is archived and disappears, because what is left
// of it is a snippet on somebody else's site; a cause is archived and stays, because the gifts
// already recorded against it still name it and this is the only screen that says so.
//
// this file is deliberately thin. what reaches the database lives in
// `$lib/server/programs/queries.ts`; the only job here is a projection. neither `D1Database` nor
// the `program` table object is named anywhere in this route, and neither may be.

/** the screen's name, rendered as the document title and as the heading. */
const SCREEN_TITLE = 'Programs';

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
	// one read, and it is the only one this page makes. the diagnostic is about the database rather
	// than about the table, because what a fresh deployment actually hits here is a schema that was
	// never migrated.
	let programs: Awaited<ReturnType<typeof readPrograms>>;
	try {
		programs = await readPrograms(context.get(database));
	} catch (e) {
		console.error('loading the programs page failed:', e);
		loadFailed('This page');
	}

	// the cause made by the redirect that landed here, if any. it arrives as a one-shot marker
	// rather than in the address, and the header that comes back with it is what clears it.
	//
	// taken after the read above rather than before it, so a loader that could not reach the
	// database does not burn a marker no screen ever drew. matched against the list rather than
	// rendered, so the id itself never reaches the page.
	const landed = await takeFlash(request, CREATED_FLASH);
	const created = landed === null ? null : (programs.find((p) => p.id === landed.marker) ?? null);

	return data(
		{
			created: created && { id: created.id, name: created.name },
			// an explicit projection rather than the rows. the timestamps are none of this page's
			// business, and `updated_at` is not a version anything on this screen saves against.
			programs: programs.map((program) => ({
				id: program.id,
				name: program.name,
				description: program.description,
				// the value, not a word: `PROGRAM_STATUS_LABELS` in `$lib/programs/statuses.ts` is
				// importable by a component, so the page puts words to it and there is one copy of them.
				status: program.status
			}))
		},
		// the header that burns the marker rides on the response that publishes it, so a reload of
		// this list announces nothing. a `Set-Cookie` from a loader is sent without this route
		// exporting `headers` — react router preserves that one header on its own
		// (react-router/docs/how-to/headers.md).
		landed === null ? {} : { headers: { 'Set-Cookie': landed.clear } }
	);
}

// what this page owes is the causes this deployment has, active ones first, and a way to reach the
// screen that edits one. it writes nothing: every change to a cause happens on its own page.
export default function Programs({ loaderData }: Route.ComponentProps) {
	const { created, programs } = loaderData;

	// the notice arrives already holding its text, and a live region that arrives carrying its own
	// text is one insertion rather than a change: no reader announces it, and focus is still on
	// `<body>` after the press made next door. so a reader is moved to it, which reads it out on
	// arrival and puts them at the head of the list the new cause is now on (WCAG 4.1.3).
	//
	// the attributes are on a block around the banner because `Banner` states its own role from its
	// tone and takes neither a ref nor a `tabIndex`. the block is what focus lands on and the
	// `role="status"` it wraps is what is read from it.
	//
	// keyed to the flag rather than to mount: the marker is one-shot, so it is true on the GET the
	// create redirected to and false on every visit after, and a revalidation that clears it moves
	// nobody.
	const announcing = created !== null;
	const notice = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (announcing) notice.current?.focus();
	}, [announcing]);

	return (
		// one column and the column is what spaces it: every block below carries no margin of its
		// own, so one that is not rendered leaves no space behind it.
		<Column>
			<PageHeader
				title={SCREEN_TITLE}
				pageAction={
					// a link dressed as a button, and it stays a link: this navigates, it does not write.
					// "Add" is the dashboard's one word for bringing a record into being, and it is the
					// word on the button, the page it opens and the banner that reports the write.
					<Button as={Link} to={href('/admin/programs/new')}>
						Add program
					</Button>
				}
			/>

			{/* the outcome of the create next door, which redirected here with the new cause's id. it
			    is the only outcome this page reports and the only one it can: this page writes
			    nothing, so every other thing that happens to a cause is reported on the screen that
			    did it. */}
			{created ? (
				<div ref={notice} tabIndex={-1}>
					<Banner tone="done" word="Added">
						{created.name}.
					</Banner>
				</div>
			) : null}

			{programs.length === 0 ? (
				<EmptyState>No programs yet. Add one to name what a gift went to.</EmptyState>
			) : (
				<List>
					{programs.map((program) => (
						// a cause is a record rather than a run of paragraphs: its name and its status on
						// one baseline, then the sentence staff wrote about it.
						//
						// the record is written out of the classes packages/operator/src/styles/adm.css
						// already draws, which is what the donation forms list beside it does.
						<section className="adm-record" key={program.id}>
							<div className="adm-record__head">
								{/* level 2, because a record on this list stands directly under the page's
								    own `<h1>` and nothing sits between them. how loud the words are is
								    `.adm-record__title`'s to say. */}
								<h2 className="adm-record__title">
									<Link to={href('/admin/programs/:id', { id: program.id })}>{program.name}</Link>
								</h2>
								{/* Active is the word somebody scanning this list is looking for, so it is the
								    one at full weight and Archived is the quieter of the two. */}
								<StatusWord secondary={program.status !== 'active'}>
									{PROGRAM_STATUS_LABELS[program.status]}
								</StatusWord>
							</div>

							{/* the description and nothing else, because there is nothing else stored: a
							    cause with none draws no line rather than a labelled blank, which is what a
							    record with one optional value can afford. it is a caption because it is
							    staff wording rather than a figure. */}
							{program.description ? <p className="adm-caption">{program.description}</p> : null}
						</section>
					))}
				</List>
			)}
		</Column>
	);
}
