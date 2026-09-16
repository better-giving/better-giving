import { CreateCard } from '@better-giving/operator/components/data/CreateCard';
import { RecordCard } from '@better-giving/operator/components/data/RecordCard';
import { Mark } from '@better-giving/operator/components/status/Mark';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';

/*
 * the card that leads a list of records, and the whole of what is worth looking at here is its
 * height.
 *
 * the ghost is a record's markup drawn hidden, so the dashed card measures exactly what a card
 * beside it measures. the pair below is that claim standing next to the thing it is a claim about:
 * a create card and a real record card in one list, which is the only way to see the two agree.
 * the card on its own above it is the state that matters more — a list with no records in it still
 * draws a full-height card, because the height comes from inside the card rather than from a
 * sibling.
 *
 * the ghost is written out of the classes rather than mounted from `RecordCard`, and that is a
 * constraint rather than a shortcut: the card is one press, and `RecordCard` draws its name as a
 * link. an anchor inside an anchor is closed early by the parser and is a focusable node inside an
 * `aria-hidden` subtree either way, so a ghost that mounted the real part would break the card it
 * is inside. the name is a plain `<span>` wearing the title's class for the same reason a heading
 * would be wrong here — the ghost is a shape and not a record anybody can reach.
 *
 * two shapes of ghost, because the two lists that draw this card hold different records: a
 * programme is a name and a sentence, and a form is a name and a foot of presses. that is why the
 * ghost is the caller's and not something the part builds.
 *
 * `as` is left at its default here. the gallery has no router, and a mounted list hands its own
 * link in — which is the same escape every other press in this package takes.
 *
 * hover and focus are pinned rather than reached. focus is the one to look at: this card is an
 * anchor the size of a whole record, and packages/operator/src/styles/adm.css restates the ring on
 * it so the keyboard draws an edge rather than a halo of tint around a card that big.
 */

const programme = (
	<div className="adm-record">
		<div className="adm-record__head adm-record__head--marked">
			<span className="adm-record__mark">
				<Mark name="folder-heart" />
			</span>
			<span className="adm-record__title">Clean water</span>
			<StatusWord tone="done">Active</StatusWord>
		</div>
		<p className="adm-caption">Wells and filters for villages along the river.</p>
	</div>
);

const form = (
	<div className="adm-record">
		<div className="adm-record__head adm-record__head--marked">
			<span className="adm-record__mark">
				<Mark name="form" />
			</span>
			<span className="adm-record__title">Year-end appeal</span>
			<StatusWord tone="done">Live</StatusWord>
		</div>
		<ul className="adm-record__origins adm-record__foot">
			<li>
				<span className="adm-chip adm-press adm-press--words">form page</span>
			</li>
			<li>
				<span className="adm-chip adm-press">riverside-shelter.org</span>
			</li>
		</ul>
	</div>
);

export default function DataCreateCardPreview() {
	return (
		<div className="adm-stack">
			<div className="adm-list">
				<CreateCard href="#create-programme" ghost={programme}>
					Create programme
				</CreateCard>
			</div>
			<div className="adm-list">
				<CreateCard href="#create-form" ghost={form}>
					Create donation form
				</CreateCard>
				<RecordCard
					titleAs="h3"
					title="Year-end appeal"
					href="#year-end"
					mark="form"
					state="Live"
					tone="done"
					originsLabel="Allowed on"
					emptyOrigins="No sites yet, so this form is refused everywhere."
					origins={['https://riverside-shelter.org']}
				/>
			</div>
			<div className="adm-list">
				<CreateCard href="#create-hover" ghost={programme} state="hover">
					Create programme
				</CreateCard>
				<CreateCard href="#create-focus" ghost={programme} state="focus">
					Create programme
				</CreateCard>
			</div>
		</div>
	);
}
