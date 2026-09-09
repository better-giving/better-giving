/**
 * the sets more than one component draws from, as types.
 *
 * a union is stated as a JSDoc annotation on the component that takes it, and that annotation is
 * the one statement of a prop's type. this file is the exception the word "one" makes necessary:
 * seven components draw from the same interaction state — six take exactly it and
 * packages/operator/src/components/controls/Button.jsx takes two more on top — and seven copies of
 * it is the drift a closed set exists to stop. what earns a place here is a set a second component
 * already needs — anything one component owns stays on that component.
 *
 * every member of a set here has to be one the sheets actually draw, and
 * packages/operator/src/components/pinned-states.spec.ts is what holds it to that: it reads each
 * component's own union out of its JSDoc and refuses a member no rule in
 * packages/operator/src/styles/adm.css or packages/operator/src/styles/base.css paints. a member
 * added here reaches seven components at once, which makes it the widest way in this package to
 * write a state that paints nothing.
 *
 * nothing here is imported at runtime — the components name these in JSDoc, which carries no
 * value into the build.
 */

/**
 * a state a pointer or the keyboard reaches, pinned on an element by class.
 *
 * each is drawn as the twin beside its own pseudo-class — `.adm-btn:hover, .adm-btn.is-hover` —
 * because a state a pointer reaches is a state no page can put on an element, and a specimen has
 * to be able to. so a screen writes none of these: the one place in this repository that writes
 * them is packages/gallery, whose previews pin every member of this set on every component that
 * takes one.
 *
 * the two are what every one of the seven draws: a hover twin in
 * packages/operator/src/styles/adm.css beside the component's own `:hover`, and the one ring
 * packages/operator/src/styles/base.css draws for every `.is-focus` on the surface. a control
 * drawing a state past those two states it in its own union rather than here.
 *
 * @typedef {'hover' | 'focus'} PointerState
 */

/**
 * the register an operator surface speaks in. `note` is the bare `.adm-banner` and the bare
 * `.adm-status` rather than a modifier of either: a note is a fact, and a fact is not coloured.
 *
 * @typedef {'blocker' | 'attention' | 'note' | 'done'} Tone
 */

export {};
