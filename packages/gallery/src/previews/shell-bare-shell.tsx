import { Button } from '@better-giving/operator/components/controls/Button';
import { BareShell } from '@better-giving/operator/components/shell/BareShell';
import { Column, Group, Section, Steps } from '@better-giving/operator/components/shell/Layout';
import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { Brand } from '@better-giving/operator/components/status/Brand';
import { Mark } from '@better-giving/operator/components/status/Mark';

/*
 * the shell a surface takes when it has no rail: a bar of stated facts across the top, the screen
 * under it, and the strip of small print it may stand at its foot.
 *
 * it is a second shell beside ./shell-app-shell.tsx rather than a mode on that one, and drawn next
 * to it the difference is the whole point — a rail is a set of destinations and a surface whose
 * product is one screen has none to offer. what the modifier takes back is the strip a rail stands
 * in: `:where(.adm-shell--bare) .adm-main` in packages/operator/src/styles/adm.css reserves nothing
 * at the foot, so a bare page with no strip under it ends where the window does rather than a bar's
 * height above it — the last specimen below is the one that shows it. that clearance is invisible
 * until it is wrong, and the pair with the rail is the only way to see it.
 *
 * **each specimen is a screen tall**, for the reason stated at length in ./shell-app-shell.tsx:
 * `.adm-shell` is `min-block-size: 100dvh` and nothing in the system bounds it smaller. four
 * specimens rather than every combination, for the same reason.
 *
 * `facts` and `end` are the bar's and are handed straight through, so what a run of them looks like
 * is ./shell-top-bar.tsx's business and not this file's. what is drawn here is only what the shell
 * decides: that the head is the first row, that the page is the second, and that `centred` stands
 * the screen in the middle of what is left rather than at the top of it.
 *
 * `head` is the other head a shell can take, and the fourth specimen is it: the whole band as one
 * node, in place of the run of facts. it is the same `.adm-head` ./shell-app-shell.tsx's panel route
 * stands over its panel, so the two ends read the same on both — and what stands *under* the strip
 * on that band is the caller's too, which is what the note in the specimen is drawn to show. a shell
 * handed one draws no bar of facts at all: the two are alternatives, and both would be two bands
 * over one page.
 *
 * `centred` is for a screen that is waiting — nothing has arrived and there is nothing on it to act
 * on — and a screen with anything to do on it is read from the top. both are drawn, and the pair is
 * what says that the modifier is the page's rather than the column's: the page is the shell's `1fr`
 * row and is the only element here that has been given a height to centre anything in.
 *
 * `foot` is the strip under the page, and it is the same `.adm-footstrip` ./shell-app-shell.tsx's
 * panel route stands in its own foot slot: two children land at the two ends and what they are is
 * the caller's. it is drawn on the first two specimens and left off the third, and that pair is what
 * says the strip is a row rather than something laid over the page — on the long screen the page
 * ends at it, and on the centred one the block stays in the middle of what is left and the strip
 * stays at the foot of the window. **narrow to the 375px floor and its two ends become two rows**,
 * starting at the same edge.
 *
 * the last specimen leaves every head slot and the foot off and hands the shell no screen, which is
 * the shell at its emptiest: the component's own one fact, its own quiet control, and a page with
 * nothing in it.
 */
/* the strip's two ends as a specimen wants them: plain text where the console hands the release it
   was built as, and one node at the trailing end rather than three links loose — the strip's step
   falls between its two ends, so three ends would be a run spread across the line. */
const FOOT = (
	<>
		<span>better-giving v0.4.1</span>
		<div>
			<a href="https://example.org/one">Somewhere</a>{' '}
			<a href="https://example.org/two">Somewhere else</a>{' '}
			<a href="https://example.org/three">A third place</a>
		</div>
	</>
);

export default function ShellBareShellPreview() {
	return (
		<div className="adm-stack">
			<BareShell
				facts={[
					{ what: 'Account', name: 'Riverside Shelter' },
					{ what: 'Worker', name: 'riverside-shelter', code: true },
					{ what: 'Address', name: 'https://give.riverside-shelter.org', code: true }
				]}
				end={<Button size="sm">Deploy</Button>}
				foot={FOOT}
			>
				<Column>
					<PageHeader
						title="Set up"
						standfirst="What this deployment can do, and what it is waiting on."
					/>
					<Section>
						<Banner tone="blocker" word="Cards are refused">
							No Stripe secret key is set, so this deployment cannot charge anything. Set the key
							and deploy again.
						</Banner>
					</Section>
					<Section>
						<Group label="Set the secret key" labelAs="h3">
							<Steps>
								<li>Create a restricted key in the Stripe dashboard.</li>
								<li>Paste it into the console&rsquo;s payments section and save.</li>
								<li>
									The console deploys again for you — a running deployment holds the values it was
									started with.
								</li>
							</Steps>
						</Group>
					</Section>
				</Column>
			</BareShell>

			{/* the waiting screen, with no control over the surface to draw. */}
			<BareShell
				centred
				facts={[{ what: 'Worker', name: 'riverside-shelter', code: true }]}
				end={null}
				foot={FOOT}
			>
				<Column>
					<Banner word="Deploying">
						The worker is being uploaded and the schema brought up to date. This takes about a
						minute and nothing on this screen needs doing while it runs.
					</Banner>
				</Column>
			</BareShell>

			{/* the other head, handed in whole: the strip's two ends, and a line under it on the same
			    band. what stands on either is the caller's — the console hands the account it is
			    working in, the way out across from it, and what this machine could not write down
			    (packages/console-ui/src/lib/head-strip.tsx).

			    the company's logo is inside the identity rather than at an end of the strip, and the
			    press carries its mark and no word, for the reasons that module states. */}
			<BareShell
				head={
					<>
						<div className="adm-headstrip">
							<span className="adm-headstrip__who">
								<Brand name="cloudflare" label="Cloudflare" />
								<span className="adm-headstrip__name">Riverside Shelter</span>
								<span className="adm-headstrip__sep" aria-hidden="true">
									/
								</span>
								<span className="adm-headstrip__note">9f2c1ab4e77d4c0fa1b3d5e6079c8412</span>
							</span>
							<Button variant="soft" size="sm" mark="unplug" aria-label="Close console" />
						</div>
						<p className="adm-headnote">
							<Mark name="triangle-alert" />
							<span>
								Won&rsquo;t remember this account. The console asks which one to use again the next
								time it starts.
							</span>
						</p>
					</>
				}
				foot={FOOT}
			>
				<Column>
					<PageHeader
						title="Set up"
						standfirst="What this deployment can do, and what it is waiting on."
					/>
				</Column>
			</BareShell>

			{/* both bar slots defaulted, no foot and no screen handed in: the shell at its emptiest. */}
			<BareShell />
		</div>
	);
}
