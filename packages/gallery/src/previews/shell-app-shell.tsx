import { Button } from '@better-giving/operator/components/controls/Button';
import { EmptyState } from '@better-giving/operator/components/data/EmptyState';
import { Field } from '@better-giving/operator/components/forms/Field';
import type { DestinationLinkProps } from '@better-giving/operator/components/shell/DestinationCell';
import { AppShell, PanelRoute } from '@better-giving/operator/components/shell/AppShell';
import { Column, Group, Section } from '@better-giving/operator/components/shell/Layout';
import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { Brand } from '@better-giving/operator/components/status/Brand';

/*
 * the shell a surface with a rail takes, and the panel route that stands outside it.
 *
 * **each specimen is a screen tall and that is the element rather than the specimen.**
 * `.adm-shell` is `min-block-size: 100dvh` in packages/operator/src/styles/adm.css, because the page
 * is its `1fr` row and a short screen still has to fill the window. nothing in the system bounds it
 * to a smaller box and nothing should — so a gallery reader scrolls a window per specimen, and
 * there are five of them plus the panel for that reason rather than one of every combination.
 *
 * **narrow the window past 64rem and every rail below becomes `position: fixed` at the foot of the
 * viewport**, one over another, because that is what a rail is at that width: a bar of tabs pinned
 * to the bottom of the screen. one shell on a page is one bar; five shells on a page is five bars
 * in the same strip. it is the arrangement being correct rather than a defect in it, and it is the
 * one thing on this page a second specimen makes worse.
 *
 * the screens inside are built out of the real components the surfaces use, never filler: the
 * shell's whole job is the space around a page and the step from the rail to the first heading, and
 * a box of nonsense text shows neither.
 *
 * `current` is three states and all three are drawn. a bare string is the destination and the page;
 * the object form states the kind, and `section` is what a rail cell stands over a screen one level
 * down as — both take the same tint and differ only in what is read out, so the pair is stated here
 * rather than shown. **absent is the third**: the reader is under no destination and no cell is
 * marked, which is the only honest rail to draw there and is what the centred specimen has.
 *
 * `groups` is drawn as the component's own, as the dashboard's three groups with marks, as the
 * console's run with a headed group, logos and status marks, as one entry, and as none. the empty
 * rail is a `nav` with no cells in it, which below the wide breakpoint is an empty strip across the
 * foot of the window. a tab is an equal share of the width whatever the count, and the bar is flat:
 * a headed group's entries stand as tabs of their own.
 *
 * the toggle on the rail's head collapses it to an icon rail, and the choice is kept per browser,
 * so every specimen on this page follows it once the page is reloaded.
 *
 * `wayOut` reads absence as a request for the component's own quiet button and `null` as none.
 * `foot` stands in the rail in its place, which is the console's shape: its close in the band and
 * its account in the foot. `null` for both drops the rail's foot rather than standing an empty one.
 *
 * `head` is the strip across the top of the panel, and `site` is the globe leading the
 * organisation's name — the console's link to its deployment's dashboard.
 *
 * `link` is what every cell is drawn as. a mounted rail states one — this package declares no
 * router and cannot (CLAUDE.md: the graph is `app → operator ← console`) — so the second shell
 * hands one in and the first takes the plain anchors that render identically.
 *
 * `PanelRoute` is published from this module and is the composition a route outside the shell is:
 * signing in and failing are the same centred panel. ./shell-error-panel.tsx is the failing one; the
 * specimen here is the signing-in one, which nothing else in the gallery draws.
 *
 * its two strips are drawn both ways, and neither is this route's own — the head is `.adm-head` and
 * the foot `.adm-footstrip`, the two strips ./shell-bare-shell.tsx stands over and under a page. the
 * pair is what says a strip does not move the panel:
 * absent, the route is one row and the panel is centred in the window; with a strip at each edge the
 * panel is centred in what they leave. the two panels stand at different heights on the page and both
 * are in the middle of the space they were given — which is invisible in either one alone. the second
 * specimen carries both, because the strips are tracked together and a route showing one of them says
 * nothing about the rows the other takes.
 *
 * `bare` is the third of them and is a state rather than a strip: the route stands its children on
 * the page's own ground with no panel around them, which is what a route holding one control and
 * nothing else takes. it is drawn beside the panel it drops so the pair says what the box was doing
 * — a card around a single press is a boundary around nothing.
 */

/* stands in for the router link a surface hands in — see the same note in
   ./shell-destination-cell.tsx. */
function StandInLink({ children, ...rest }: DestinationLinkProps) {
	return <a {...rest}>{children}</a>;
}

export default function ShellAppShellPreview() {
	return (
		<div className="adm-stack">
			{/* everything defaulted but the whereabouts: the groups the component names, the quiet way
			    out, plain anchors, and a real screen in the page. */}
			<AppShell org="Riverside Shelter" current="Donation forms">
				<Column>
					<PageHeader
						title="Donation forms"
						standfirst="Each form is a snippet you paste into a page. A form that is not published is served to nobody."
						pageAction={<Button variant="primary">Add a donation form</Button>}
					/>
					<Section>
						<Banner tone="attention" word="One donation form is a draft">
							A draft form is not served to any site until it is published.
						</Banner>
					</Section>
					<Section>
						<h2>Archived</h2>
						<EmptyState>Nothing has been archived on this deployment yet.</EmptyState>
					</Section>
				</Column>
			</AppShell>

			{/* the dashboard's rail: three groups with a mark on every entry, the reader in a section
			    rather than on its page, a name long enough to contest the identity row, a strip over
			    the panel, and the cells drawn as the link the surface handed in. */}
			<AppShell
				org="The Wharfedale Riverside Community Kitchen and Night Shelter Trust"
				current={{ label: 'Donors', kind: 'section' }}
				groups={[
					{
						destinations: [
							{ label: 'Dashboard', short: 'Dashboard', href: '#', mark: 'layout-dashboard' }
						]
					},
					{
						destinations: [
							{ label: 'Donation forms', short: 'Forms', href: '#', mark: 'file-text' },
							{ label: 'Programs', short: 'Programs', href: '#', mark: 'folder-heart' },
							{ label: 'Donors', short: 'Donors', href: '#', mark: 'users' },
							{ label: 'Gifts', short: 'Gifts', href: '#', mark: 'hand-heart' },
							{ label: 'Recurring gifts', short: 'Recurring', href: '#', mark: 'repeat' }
						]
					},
					{
						destinations: [{ label: 'Members', short: 'Members', href: '#', mark: 'shield-check' }]
					}
				]}
				head={<span className="adm-headstrip__title">Donors</span>}
				link={StandInLink}
			>
				<Column>
					<PageHeader title="Receipts" standfirst="What a donor is sent after a card clears." />
					<Group label="Sender" labelAs="h3">
						<Field
							id="shell-app-shell-sender"
							label="Sender address"
							defaultValue="receipts@riverside-shelter.org"
						/>
						<Field
							id="shell-app-shell-footer"
							label="Receipt footer"
							hint="Printed at the bottom of every receipt. Your registered number belongs here."
						/>
						<Button variant="primary">Save</Button>
					</Group>
				</Column>
			</AppShell>

			{/* the console's rail: a headed group of processors drawn with pictures, a status mark on
			    every entry, the site's globe before the name, the close in the band and an account in
			    the foot. */}
			<AppShell
				org="Riverside Shelter"
				current="Sites"
				site="https://better-giving.riverside.workers.dev/admin"
				groups={[
					{
						destinations: [
							{
								label: 'Dashboard password',
								short: 'Password',
								href: '#',
								mark: 'key-round',
								status: { tone: 'done', mark: 'check', label: 'Configured' }
							},
							{
								label: 'Organisation',
								short: 'Organisation',
								href: '#',
								mark: 'building-2',
								status: { tone: 'done', mark: 'check', label: 'Configured' }
							}
						]
					},
					{
						heading: 'Donation processor',
						destinations: [
							{
								label: 'PayPal',
								short: 'PayPal',
								href: '#',
								mark: 'globe',
								status: { tone: 'attention', mark: 'circle-dashed', label: 'Not set up' }
							}
						]
					},
					{
						destinations: [
							{
								label: 'Sites',
								short: 'Sites',
								href: '#',
								mark: 'globe',
								status: { tone: 'note', mark: 'circle-dashed', label: 'None listed' }
							},
							{ label: 'SMTP', short: 'SMTP', href: '#', mark: 'mail' },
							{ label: 'Notifications', short: 'Notifications', href: '#', mark: 'bell' }
						]
					}
				]}
				wayOut={
					<Button
						variant="quiet"
						size="sm"
						mark="unplug"
						className="adm-signout"
						aria-label="Close console"
					/>
				}
				foot={
					<div className="adm-footaccount">
						<span className="adm-rail__lead">
							<Brand name="cloudflare" label="Cloudflare" />
						</span>
						<span className="adm-footaccount__name" title="0f3c9a8b2d4e41f6a7b8c9d0e1f2a3b4">
							Riverside Shelter's Account
						</span>
						<span className="adm-footaccount__out">
							<Button
								variant="quiet"
								size="sm"
								mark="unplug"
								className="adm-signout"
								aria-label="Close console"
							/>
						</span>
					</div>
				}
				head={<span className="adm-headstrip__title">Sites</span>}
			>
				<Column>
					<PageHeader title="Sites" standfirst="Which sites your forms go on" />
					<EmptyState>No site has been added yet.</EmptyState>
				</Column>
			</AppShell>

			{/* the waiting screen: one short block in the middle of the panel, nobody signed in to sign
			    out, one destination, and no cell marked because the reader is under none of them. */}
			<AppShell
				org="Riverside Shelter"
				centred
				wayOut={null}
				groups={[{ destinations: [{ label: 'Forms', short: 'Forms', href: '#' }] }]}
			>
				<Column>
					<Banner word="Waiting for the first donation">
						Nothing has been given through this deployment yet. The first gift appears here the
						moment a card clears.
					</Banner>
				</Column>
			</AppShell>

			{/* a rail with nothing in it. */}
			<AppShell org="Riverside Shelter" groups={[]}>
				<Column>
					<PageHeader title="No destinations" />
					<EmptyState>
						The rail was handed an empty run, so the nav is drawn with no cells in it.
					</EmptyState>
				</Column>
			</AppShell>

			{/* the composition a route outside the shell is, drawn as the sign-in it was written for. */}
			<PanelRoute>
				<h1>Sign in</h1>
				<Field id="shell-app-shell-password" type="password" label="Staff password" />
				<Button variant="primary">Sign in</Button>
			</PanelRoute>

			{/* the same route carrying both strips: two nodes at the two ends of each, and the panel
			    centred in what they leave rather than in the window. what stands in either is the
			    caller's — the console hands who is signed in with the one press it offers above, and
			    the release with a mark below, where plain text is what a specimen wants.

			    **narrow the window to the 375px floor and the head's leading end wraps inside itself
			    rather than dropping the press to a row of its own.** the run at the foot's trailing
			    end is one node rather than three, because a strip's step falls between its two ends —
			    three links handed in loose are three ends spread across the line. */}
			<PanelRoute
				bar={
					<>
						{/* the head's two ends as both of the console's screens draw them
						    (packages/console-ui/src/lib/head-strip.tsx): the identity on one line, and the
						    press across from it carrying its mark and no word. it is drawn here rather than
						    described because packages/operator/src/styles/adm.css squares that press on the
						    box a hand has to find, which is a shape nothing else on this page wears. one
						    value in the identity, because a sign-in is held under an address and has no id
						    beside it. */}
						<span className="adm-headstrip__who">
							<Brand name="cloudflare" label="Cloudflare" />
							<span className="adm-headstrip__name">someone@example.org</span>
						</span>
						<Button variant="soft" size="sm" mark="log-out" aria-label="Sign out of Cloudflare" />
					</>
				}
				foot={
					<>
						<span>better-giving v0.4.1</span>
						<div>
							<a href="https://example.org/one">Somewhere</a>{' '}
							<a href="https://example.org/two">Somewhere else</a>{' '}
							<a href="https://example.org/three">A third place</a>
						</div>
					</>
				}
			>
				<h1>Sign in</h1>
				<Field id="shell-app-shell-barred-password" type="password" label="Staff password" />
				<Button variant="primary">Sign in</Button>
			</PanelRoute>
		</div>
	);
}
