import { Button } from '@better-giving/operator/components/controls/Button';

/*
 * the smoke preview: every state packages/operator/src/styles/adm.css draws for Button — the five
 * ranks, the small size, a mark before and after, the four pointer states pinned by class rather
 * than triggered (the union on `state` in
 * packages/operator/src/components/controls/Button.jsx, which is the shared set plus the two the
 * sheet draws for `.adm-btn` alone), and `as` handed a plain anchor rather than a router's link,
 * since this package declares no router.
 *
 * the two filled ranks repeat all four pointer states, because they are the only ranks whose fill
 * moves under the pointer and whose ring is drawn inside the control rather than around it: a
 * label that stops clearing its fill on the press, or a ring that vanishes into it, is visible
 * here and nowhere else.
 *
 * the busy row is the one specimen with a rest twin standing next to it, and that pairing is the
 * whole point of it: a press in flight keeps the label it had and draws the dots over it, so the
 * only thing this page can show going wrong is the two boxes coming out different sizes. it repeats
 * across the ranks because the dots take their ink from the label's, so a rank whose ground moved
 * without its ink moving is dots nobody can see. `aria-busy` and nothing else turns them on.
 *
 * the three at the foot carry `disabled` beside it, which is what a real press in flight does — one
 * operator intent is one write. each stands beside the rank's plain disabled specimen above, and the
 * pair is the whole case: a press that is working holds its rank's active rung and a press that is
 * unavailable greys, so two specimens that came out the same colour is the finding.
 */
export default function ButtonPreview() {
	return (
		<>
			<Button>default</Button>
			<Button variant="primary">primary</Button>
			<Button variant="danger">danger</Button>
			<Button variant="quiet">quiet</Button>
			<Button variant="soft">soft</Button>
			<Button size="sm">small</Button>
			<Button mark="plus">marked</Button>
			<Button markAfter="check">marked after</Button>
			<Button state="hover">hover</Button>
			<Button state="active">active</Button>
			<Button state="focus">focus</Button>
			<Button state="disabled">disabled</Button>
			<Button as="a" href="#">
				as link
			</Button>
			<Button variant="primary" state="hover">
				primary hover
			</Button>
			<Button variant="primary" state="active">
				primary active
			</Button>
			<Button variant="primary" state="focus">
				primary focus
			</Button>
			<Button variant="primary" state="disabled">
				primary disabled
			</Button>
			<Button variant="danger" state="hover">
				danger hover
			</Button>
			<Button variant="danger" state="active">
				danger active
			</Button>
			<Button variant="danger" state="focus">
				danger focus
			</Button>
			<Button variant="danger" state="disabled">
				danger disabled
			</Button>
			<Button>busy rest twin</Button>
			<Button aria-busy>busy rest twin</Button>
			<Button variant="primary" aria-busy>
				primary busy
			</Button>
			<Button variant="danger" aria-busy>
				danger busy
			</Button>
			<Button size="sm" aria-busy>
				small busy
			</Button>
			<Button mark="plus" aria-busy>
				marked busy
			</Button>
			<Button aria-busy disabled>
				busy and closed
			</Button>
			<Button variant="primary" aria-busy disabled>
				primary busy and closed
			</Button>
			<Button variant="danger" aria-busy disabled>
				danger busy and closed
			</Button>
		</>
	);
}
