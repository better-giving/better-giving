import { Button } from '@better-giving/operator/components/controls/Button';

/*
 * the smoke preview: every rank and size packages/operator/src/components/controls/Button.jsx draws
 * from the registry's button-css (packages/operator/src/registry/styles/button-css.css) — the five
 * ranks, the small size, a mark before and after and a mark alone, and `as` handed a plain anchor
 * rather than a router's link, since this package declares no router.
 *
 * no pointer state is pinned here: the registry draws hover, press and focus off the pseudo-classes
 * alone, so they are reached with a pointer and a keyboard on this page. the closed presses are the
 * two spellings a screen writes: the native `disabled`, which the registry draws, and
 * `aria-disabled` on a press that keeps the focus, which packages/operator/src/styles/adm.css draws
 * because the registry draws it on an anchor alone.
 *
 * the busy row repeats across the ranks: a press in flight is the registry's `aria-busy` look, the
 * disabled fill with the label still in it, and it is the same on every rank.
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
			<Button mark="x" aria-label="Remove" />
			<Button variant="quiet" size="sm" mark="x" aria-label="Remove" />
			<Button as="a" href="#">
				as link
			</Button>
			<Button disabled>disabled</Button>
			<Button variant="primary" disabled>
				primary disabled
			</Button>
			<Button variant="danger" disabled>
				danger disabled
			</Button>
			<Button aria-disabled>closed, focusable</Button>
			<Button variant="primary" aria-disabled>
				primary closed, focusable
			</Button>
			<Button aria-busy>busy</Button>
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
		</>
	);
}
