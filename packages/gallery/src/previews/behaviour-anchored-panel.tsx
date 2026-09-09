import { AnchoredPanel } from '@better-giving/operator/behaviour/AnchoredPanel';
import { Button } from '@better-giving/operator/components/controls/Button';
import { Field } from '@better-giving/operator/components/forms/Field';
import { TopBar } from '@better-giving/operator/components/shell/TopBar';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';

/*
 * the panel a labelled press opens, which is the machine and not the panel.
 *
 * ./data-disclosure.tsx already draws `AnchoredPanelCard` — the box, at rest, on the page, at the
 * width the sheet caps it to. what is here is the different thing: the press, the portal out of
 * whatever the press was rendered inside, and the positioner that writes the `--available-width`
 * packages/operator/src/styles/adm.css caps the panel by.
 *
 * it is a file beside ./behaviour-anchored-card.tsx because what the trigger opens is the difference:
 * there it is something to read, here it is something to act through. the two are next to each other
 * in the gallery for that reason.
 *
 * **the press is a word or a shape, and where it stands is what decides which.** beside a value in
 * the body of a screen it is a word — an operator came to that row to act, and a shape there says
 * there is something to look at. on the top bar it is a shape, because the bar is one line of stated
 * facts read at a glance and a word on it is a second thing to read. both are drawn here, and the
 * shape is drawn where it belongs rather than in the run of words above it: the last specimen is a
 * bar, which is the whole of the argument for it. the name is the same either way — the word the
 * press would have drawn is what the shape carries.
 *
 * **the open panel is not reachable from a prop.** the machine runs uncontrolled and the component
 * takes no `open` or `defaultOpen`, so every specimen rests closed and a reader opens it with a
 * press. what appears is `AnchoredPanelCard`, which ./data-disclosure.tsx draws.
 *
 * **a dismissed panel is discarded, not hidden**, and that is the one behaviour here worth pressing
 * twice to see: `unmountOnExit` (packages/operator/src/behaviour/AnchoredPanel.tsx:44) is why a box
 * typed into and then dismissed comes back empty. left mounted and `hidden` — which is the machine's
 * own default — a panel carrying a credential would hand it back in the clear the next time the
 * press was made. the first specimen holds a real field so that is something a reader can check
 * rather than read.
 *
 * what stands inside is the caller's whole: the component draws no heading and no controls of its
 * own, because a panel is opened over the one act it holds and the surface that owns that act knows
 * its words. so the empty specimen is a panel with genuinely nothing in it, which is what a screen
 * ships having wired the press and not the act.
 *
 * the press takes the quiet rank, which the sheet gives it and no caller states: the act is over one
 * value, and a filled control there would rank it above whatever the screen under it is for. two
 * presses on one row are drawn because that is where the rank has to hold — beside a value, in a
 * run of them.
 */
export default function BehaviourAnchoredPanelPreview() {
	return (
		<div className="adm-stack">
			<p>
				Stripe secret key <StatusWord>Live key set</StatusWord>{' '}
				<AnchoredPanel label="Replace">
					<Field
						id="behaviour-anchored-panel-key"
						label="New secret key"
						code
						placeholder="sk_live_…"
					/>
					<p>The old key stops working the moment this deploys.</p>
					<div className="adm-dialog__actions">
						<Button variant="danger">Replace the key</Button>
					</div>
				</AnchoredPanel>
			</p>

			<p>
				Reply-to address <StatusWord>hello@riverside-shelter.org</StatusWord>{' '}
				<AnchoredPanel label="Change">
					<Field
						id="behaviour-anchored-panel-reply-to"
						label="Reply-to address"
						defaultValue="hello@riverside-shelter.org"
					/>
					<div className="adm-dialog__actions">
						<Button variant="primary">Save</Button>
					</div>
				</AnchoredPanel>{' '}
				<AnchoredPanel label="Send a test">
					<p>A receipt for £1 is sent to the reply-to address. Nothing is charged.</p>
					<div className="adm-dialog__actions">
						<Button variant="primary">Send it</Button>
					</div>
				</AnchoredPanel>
			</p>

			{/* the press wired and the act not: a panel with nothing inside it. */}
			<p>
				Registered charity number <StatusWord unset>Not set</StatusWord>{' '}
				<AnchoredPanel label="Set it" />
			</p>

			{/* a word long enough to stop reading as a press, which is the bound on what may go on one. */}
			<p>
				Allowed origins <StatusWord secondary>2 sites</StatusWord>{' '}
				<AnchoredPanel label="Add a site that may load this donation form">
					<Field
						id="behaviour-anchored-panel-origin"
						label="Allowed origin"
						hint="The scheme and host of the page the form is pasted into."
						placeholder="https://riverside-shelter.org"
					/>
					<div className="adm-dialog__actions">
						<Button variant="primary">Add the origin</Button>
						<Button variant="quiet">Cancel</Button>
					</div>
				</AnchoredPanel>
			</p>

			{/* the shape on the press, standing where a shape is what a press has to be: at the far end
			    of a bar, in the run of controls that act on the surface rather than on any fact stated
			    to their left. it stands beside a control that is a word, which is the only way to see
			    that the two rank the same and read differently. */}
			<TopBar
				facts={[{ what: 'Cloudflare account', brand: 'cloudflare', name: 'riverside-shelter' }]}
				end={
					<div className="adm-actions">
						<Button
							as="a"
							variant="quiet"
							size="sm"
							markAfter="external-link"
							href="https://give.riverside-shelter.org/admin"
							target="_blank"
							rel="noreferrer"
						>
							Dashboard
						</Button>
						<AnchoredPanel mark="settings" label="Change the dashboard password">
							<Field id="behaviour-anchored-panel-password" label="New password" type="password" />
							<div className="adm-dialog__actions">
								<Button variant="primary">Store it</Button>
							</div>
						</AnchoredPanel>
					</div>
				}
			/>
		</div>
	);
}
