/**
 * the box a host page holds for this element before it upgrades.
 *
 * **the height is a permanent contract, and it is the one contract in this repository that no test
 * can hold.** it is pasted into sites this project cannot reach, read, or update — so the moment it
 * ships it is frozen in every page that took it, and a change here does not reach any of them. what
 * the tests below bind is this repository to itself: `.loading`'s `min-height` in
 * ../styles/layout.css against this value, and this value against README.md, DEPLOY.md and
 * custom-elements.json. every one of
 * those is a copy we own. change the number and the suite goes green while every embed already in
 * the field reserves the old box and reflows by the difference on every load, forever. so it is
 * add-never-change, exactly like the `--donate-*` seeds and the `::part()` names (CLAUDE.md,
 * "Permanent contracts"), and a form that needs a different box is a second element beside this one.
 *
 * the snippet loads the runtime `async`, so the parser reaches `<bg-donate-form>` before any of
 * this project's code has run: an unknown element is `display: inline` with no intrinsic size, the
 * host's page is laid out around a box of nothing, and everything below the card is pushed down by
 * the card's full height the moment the definition lands. every visitor to every embedding page
 * takes that reflow, and it is the largest thing this form does to a page it does not own.
 *
 * published rather than injected, because nothing this project ships can be early enough: a script
 * has to run to inject a rule, and running it is the upgrade. so the reservation is the host's own
 * rule, in the snippet they paste — which is why it is here rather than in a stylesheet, and why
 * `custom-elements.json` records it as part of the integration.
 *
 * this rule stops applying the moment the element is defined, and what carries the box from there
 * is `.loading { min-height }` in ../styles/layout.css — the wait, which is in the tree
 * synchronously inside the same `connectedCallback` the definition triggers, so the two are one
 * continuous floor across the join with no frame between them. it must stay that number. the two
 * never meet in a cascade — the sheet is adopted into a shadow root the page cannot see, and this
 * rule is in a document the sheet cannot reach — so nothing but "reserves exactly the height the
 * element's own sheet holds after it" in ../parts.spec.ts keeps them one number. `display: block`
 * is the other half and is not decoration: a `min-height` on an inline box reserves nothing at all.
 *
 * what it does not govern is the card. the wait ends and the floor ends with it: every real screen
 * stands at its own height, because this number is a guess at the tallest common shape and a short
 * step held at it is padded to a height nothing on it asked for. the host's page has already been
 * laid out around the reserve by then and gives the difference back once, which is a settle rather
 * than the reflow this rule exists to stop — that one is the page moving *down* by the card's whole
 * height, on a box it had reserved nothing for.
 *
 * the unit is `px`, and that is the half of it those two ends cannot state between them: written
 * font-relative they agree with each other while both move under the card, because `rem` resolves
 * against the host document's root in the pasted rule and inside the shadow root alike, and the
 * card's own scale does not — it is `clamp(15px, 1rem, 18px)` in ../styles/tokens.css and stops
 * following a root below 15px. a host running `html { font-size: 62.5% }` would reserve 62.5% of a
 * box the card never shrank into, which is the reflow this rule exists to stop, delivered by the
 * rule itself. every other unit a host can move is out for the same reason: `em` takes the
 * font-size of whatever the element was pasted into, `vh` measures the viewport rather than the
 * card. what is left is the unit the clamp already bounds the content in.
 *
 * the number is the tallest the card stands in its common shapes, taken at that 18px ceiling and at
 * a card too narrow to put its amount tiles in a row of three. it is the top of a range rather than
 * a fit, and the range is the deployment's own configuration: a form suggesting a dozen amounts
 * stands past this floor and a short one stands well inside it. either way the page settles once,
 * when the card replaces the wait — down by the difference where the card is taller, up by it where
 * the card is shorter. that slack grew when the identity footer left the card and it was not taken
 * back: the height is frozen into pages this project cannot reach, so it is added to and never
 * reduced.
 *
 * the top is the end to sit at, because the two directions are not equally bad. a page that moves
 * *down* pushes what somebody was reading out from under them; a page that comes back up closes a
 * gap under a card they are looking at. so the reserve is set where nearly every card fits inside
 * it. "holds the card that renders on a host whose root is 10px" in ../element.browser.spec.ts is
 * what measures the floor against the card, and it is a browser's question: a lightweight DOM
 * computes both as strings and agrees either way.
 *
 * a host who fills `<slot name="loading">` gets their own placeholder inside this box, and a host
 * who fills nothing — which is nearly all of them — gets an empty one of the same size.
 */
export const RESERVED_MIN_HEIGHT = '620px';

/** the rule itself, which is what a host page's own stylesheet takes. */
export const PRE_UPGRADE_RESERVATION_CSS = [
	'bg-donate-form:not(:defined) {',
	'\tdisplay: block;',
	`\tmin-height: ${RESERVED_MIN_HEIGHT};`,
	'}'
].join('\n');

/** the same rule as the block the snippet carries, indented into it. */
export const PRE_UPGRADE_RESERVATION = `<style>\n${PRE_UPGRADE_RESERVATION_CSS.replace(
	/^/gm,
	'\t'
)}\n</style>`;
