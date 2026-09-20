import { Breadcrumbs } from '@better-giving/operator/components/controls/Breadcrumbs';
import { Button } from '@better-giving/operator/components/controls/Button';
import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';

/*
 * five slots, each of which may be absent, and the arrangements the absences make.
 *
 * the row is drawn whether or not anything was handed to it, so the header with a title and
 * nothing else is not a title — it is a title in a row that is still spaced apart, and that is what
 * the second specimen is for. a header without a standfirst has one fewer block and one without a
 * `beside` has an empty half-row.
 *
 * a header without a *title* is the one absence that takes a whole block with it, and the last
 * specimen is for it: a screen whose name is already read above the header hands none, so no
 * heading is drawn at all and the standfirst stands alone under the trail. the empty heading that
 * would otherwise sit there is a name-shaped gap with a step under it, which is the thing to be
 * able to see is gone.
 *
 * the pairs are what say where each slot sits. `beside` is inside the title block and `pageAction`
 * is the far end of the row, and drawn separately they look like the same slot at two widths — so
 * one specimen carries both, with the word on the heading's baseline and the control across the
 * page from it.
 *
 * `crumbs` stands above the row rather than in it, which only shows against a header that also has
 * a standfirst: three blocks down a grid, in the order a reader meets them.
 *
 * the long specimens are the point of the row wrapping. a title long enough to run past the
 * control is what pushes that control onto its own line, and the header is capped at the measured
 * column whatever the page under it is set in — so a page in the wide column has its header stop
 * short of the plane below it, which is visible here only because the specimen beside it is short.
 *
 * no specimen states a slot called `action`: react router strips a route module's `action` export
 * and packages/app/src/routes.spec.ts reads a JSX attribute name as an identifier, which is why the
 * prop is `pageAction` at all.
 */
export default function ShellPageHeaderPreview() {
	return (
		<div className="adm-stack">
			<PageHeader
				title="Donation forms"
				standfirst="Each form is a snippet you paste into a page. A form that is not published is served to nobody."
				pageAction={<Button variant="primary">Add a donation form</Button>}
			/>

			{/* everything but the name, which is the row still spaced apart around one block. */}
			<PageHeader title="Donors" />

			<PageHeader
				title="Winter appeal"
				beside={<StatusWord>Published</StatusWord>}
				standfirst="Live on two sites since 12 November 2025."
				pageAction={<Button>Archive the form</Button>}
				crumbs={
					<Breadcrumbs
						items={[
							{ href: '#forms', label: 'Donation forms' },
							{ href: '#winter', label: 'Winter appeal' }
						]}
					/>
				}
			/>

			{/* the word beside the name with nothing acting on the page: the far end of the row is
			    empty and the word stays on the heading's own baseline rather than moving to it. */}
			<PageHeader title="Kitchen fund" beside={<StatusWord unset>Draft</StatusWord>} />

			{/* a trail with no standfirst under the name, which is the header at two blocks. */}
			<PageHeader
				title="Margarethe Van Der Aalst-Whitmore"
				crumbs={
					<Breadcrumbs
						items={[
							{ href: '#donors', label: 'Donors' },
							{ href: '#donor', label: 'Margarethe Van Der Aalst-Whitmore' }
						]}
					/>
				}
				pageAction={<Button>Download the receipts</Button>}
			/>

			{/* nothing at all. no heading is drawn, the row is, and the header is the space that row
			    reserves — what a screen ships when every slot was computed and came back blank. */}
			<PageHeader />

			{/* a screen whose name is already read above the header: the trail ends in it, so no title
			    is handed in and the standfirst stands alone under the trail. against the specimen with
			    a trail *and* a title, higher up, this is the one absence worth being able to see —
			    there, the name is read twice a line apart. */}
			<PageHeader
				standfirst="What was given in a range of days — the income, the processor's cut and the money received — as the file your accountant imports."
				crumbs={
					<Breadcrumbs
						items={[
							{ href: '#gifts', label: 'Gifts' },
							{ href: '#export', label: 'Export' }
						]}
					/>
				}
			/>

			<PageHeader
				title="Recurring gifts that could not be collected this month"
				beside={
					<StatusWord register="momentary" blocked mark="circle-alert">
						3 failed
					</StatusWord>
				}
				standfirst="A collection fails when the card behind the commitment expires, is reported lost, or is refused by the bank. The donor keeps the commitment and the next attempt runs on the usual day."
				pageAction={<Button variant="primary">Email the three donors</Button>}
				crumbs={
					<Breadcrumbs
						items={[
							{ href: '#recurring', label: 'Recurring gifts' },
							{ href: '#failed', label: 'Recurring gifts that could not be collected this month' }
						]}
					/>
				}
			/>
		</div>
	);
}
