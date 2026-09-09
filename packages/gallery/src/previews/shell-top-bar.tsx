import { Button } from '@better-giving/operator/components/controls/Button';
import { TopBar } from '@better-giving/operator/components/shell/TopBar';

/*
 * the bar at every length a run of facts can be, and both of the two slots that have a default of
 * their own.
 *
 * the divider belongs to the pair and not to either fact
 * (packages/operator/src/components/shell/TopBar.jsx:69), so the counts are what draw it: three
 * facts draw two rules, one draws none, and none draws a bar that is only its control. all four
 * lengths are here because the divider is the one thing a specimen of a single length cannot show.
 *
 * `facts` and `end` both read absence as a request for the component's own specimen value, and
 * `null` as a bar with nothing in that slot — so the two are different states and each is drawn.
 * the empty array is the third: a bar that was handed a run and the run was empty, which is not the
 * default one fact.
 *
 * `code`, `mark`, `brand`, `note` and `beside` are per-fact. the mono face is for a value that must
 * stay whole — an address, an id — and it is only visible against a fact set in the body face
 * beside it. `note` is the second value about the same fact and is pitched at the caption rather
 * than at the name, so it is drawn next to a fact carrying only a name: what the specimen shows is
 * the step down between the two. `beside` is the one control that acts on that fact, and it stands
 * inside the fact's own slot rather than at the end, which is what the specimen carrying both a
 * `beside` and an `end` is for.
 *
 * `mark` and `brand` are the fact led by a shape instead of by its caption word, and `what` is still
 * stated either way: it becomes the shape's name. they are two properties because the shapes are two
 * different things — a mark is drawn in the caption's own ink and a brand is somebody else's logo in
 * colours of its own — and the specimen puts one of each next to an unmarked fact, which is the only
 * way to see that all three sit on the same line and that only one of them is toned. one gets a
 * value long enough to wrap: a shape lands on the first line of the value it names rather than in
 * the middle of the slot, which a short value cannot show.
 *
 * the bar is a stack until 64rem and a row that cannot wrap past it, so what these look like
 * depends on the window: at the wide width a long address narrows its own slot and breaks inside
 * it, and the divider stretches to the broken value. that reflow is what the long specimen last is
 * for, and it is the one thing in this file a screenshot at one width cannot report.
 *
 * a fact with no `name` is drawn because the slot is unconditional: the label stands on the
 * baseline with nothing after it, which is what a bar states when the value it names has not been
 * read yet.
 */
export default function ShellTopBarPreview() {
	return (
		<div className="adm-stack">
			{/* both slots left off: one stated fact and the quiet control, which is the component's own
			    specimen and never a mounted bar. */}
			<TopBar />

			<TopBar
				facts={[
					{ what: 'Account', name: 'Riverside Shelter' },
					{ what: 'Worker', name: 'riverside-shelter', code: true },
					{ what: 'Database', name: 'riverside-shelter-db', code: true }
				]}
			/>

			<TopBar
				facts={[
					{ what: 'Address', name: 'https://give.riverside-shelter.org', code: true },
					{
						what: 'Stripe',
						name: 'Live keys set',
						beside: (
							<Button variant="quiet" size="sm">
								Replace
							</Button>
						)
					}
				]}
				end={<Button size="sm">Deploy</Button>}
			/>

			{/* a fact led by a logo, one led by a mark and one led by its caption word, on the one bar. */}
			<TopBar
				facts={[
					{ what: 'Cloudflare account', brand: 'cloudflare', name: 'riverside-shelter' },
					{
						what: 'Dashboard',
						mark: 'external-link',
						name: 'https://give.riverside-shelter.org/admin/donation-forms',
						code: true
					},
					{ what: 'Last deploy', name: '4 February 2026, 09:12' }
				]}
			/>

			{/* a fact carrying a second value, beside one carrying only a name. */}
			<TopBar
				facts={[
					{
						what: 'Cloudflare account',
						brand: 'cloudflare',
						name: 'riverside-shelter',
						note: '9f2c1ab4e77d4c0fa1b3d5e6079c8412'
					},
					{ what: 'Last deploy', name: '4 February 2026, 09:12' }
				]}
			/>

			{/* no control at all, which absence cannot say. */}
			<TopBar facts={[{ what: 'Account', name: 'Riverside Shelter' }]} end={null} />

			{/* the run was handed in and was empty: no facts, no divider, and the control alone at the
			    end of a bar that states nothing. */}
			<TopBar facts={[]} />

			{/* and the same bar with its control taken off, which is a band of nothing. */}
			<TopBar facts={[]} end={null} />

			{/* the label with no value beside it. */}
			<TopBar
				facts={[{ what: 'Signing secret' }, { what: 'Account', name: 'Riverside Shelter' }]}
			/>

			<TopBar
				facts={[
					{
						what: 'Address',
						name: 'https://give.riverside-shelter.org/donate/winter-appeal-2026',
						code: true,
						beside: (
							<Button variant="quiet" size="sm">
								Copy
							</Button>
						)
					},
					{
						what: 'Organisation',
						name: 'The Wharfedale Riverside Community Kitchen and Night Shelter Trust'
					},
					{ what: 'Last deploy', name: '4 February 2026, 09:12' }
				]}
				end={
					<Button variant="quiet" size="sm">
						Sign out
					</Button>
				}
			/>
		</div>
	);
}
