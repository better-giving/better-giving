import { Button } from '@better-giving/operator/components/controls/Button';
import { Banner } from '@better-giving/operator/components/status/Banner';

/*
 * four tones, and the three things a banner can be missing.
 *
 * every tone is drawn because each is a different mark and a different ink, and `note` is the one
 * that takes no modifier class at all — the bare `.adm-banner` is already the note tone, the way
 * the bare `.adm-btn` is the secondary rank. a note drawn beside the three coloured ones is what
 * shows that a fact is not coloured here.
 *
 * the tone also decides the aria role and nothing on the screen shows it: a blocker is
 * `role="alert"` and interrupts a reader mid-sentence, and the other three are `role="status"` and
 * wait their turn (packages/operator/src/components/status/Banner.jsx:37). it is pinned by the
 * tone rather than passed, so there is no combination to draw — it is stated here instead.
 *
 * `word`, `children` and `actions` are each optional and every row is guarded, which is what a
 * screen meets when its copy is computed and comes back blank. so a banner missing its word is a
 * mark beside a sentence rather than a sentence with an empty line over it, and a banner given
 * neither is its mark and the band alone. both are drawn.
 *
 * `actions` sit beneath the sentence and never inside the band's own row, which is the
 * in-the-page destructive grammar: the controls belong to the reader's next move rather than to
 * the report. the long specimen last, because a banner's sentence is a consequence and consequences
 * are the longest copy on an operator screen.
 */
export default function StatusBannerPreview() {
	return (
		<div className="adm-stack">
			<Banner tone="blocker" word="Cards are refused">
				No Stripe secret key is set, so this deployment cannot charge anything. Set the key and
				deploy.
			</Banner>
			<Banner tone="attention" word="Receipts are not being sent">
				The sender address has not been verified with your mail provider. Donations still work.
			</Banner>
			<Banner word="One donation form is a draft">
				A draft form is not served to any site until it is published.
			</Banner>
			<Banner tone="done" word="Deployed">
				The worker is live and the schema is up to date.
			</Banner>
			<Banner tone="blocker" word="Cards are refused" />
			<Banner tone="attention">
				A banner with no word: the sentence stands alone under an empty line.
			</Banner>
			<Banner tone="done" />
			<Banner
				tone="blocker"
				word="This will archive the winter appeal"
				actions={
					<>
						<Button variant="danger">Archive the form</Button>
						<Button variant="quiet">Keep it</Button>
					</>
				}
			>
				The snippet stops working on every site it is pasted into. Donations already taken are kept.
			</Banner>
			<Banner
				tone="attention"
				word="Recurring gifts cannot be collected"
				actions={<Button variant="primary">Set the signing secret</Button>}
			>
				Stripe tells this deployment that a monthly payment settled by calling the webhook endpoint,
				and the endpoint refuses every call it cannot verify. Without the signing secret no
				commitment is written down, so a donor who has agreed to give every month is charged and
				appears nowhere on these screens — the money moves and the record does not.
			</Banner>
		</div>
	);
}
