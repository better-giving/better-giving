// what a console screen says about an answer it could not read, which is not a claim about which
// side is behind.
//
// **an answer nothing could be read out of has several causes and this names none of them.** a 2xx
// whose body is not the envelope, a status outside the two sorted by hand, a body carrying no
// message at all — `readReport` in `packages/console/internal/deployment/report.go` sorts every one
// of those into
// `unreadable`, and `said` beside it fills the detail with the status where the deployment wrote no
// sentence. so a deployment answering correctly about a Stripe account nobody has set up arrives
// here, and a sentence saying the deployment and this console are out of step states one cause as
// the only one — sending an operator to redeploy something that is not broken.
//
// **what the console does know is drawn under it.** every screen saying this draws ./said.tsx
// beneath, which prints the deployment's own words: the sentence says what was not read and the
// slab says what there was to read. two consoles genuinely out of step stay sayable where the
// console knows it — a deployment answering nothing at that path is `no-surface` and says so in its
// own words.
//
// it is a module rather than a literal in each of the four places that say it because this
// package's pool is node-only and collects `*.spec.ts` (packages/console-ui/vite.config.ts): a
// sentence written inline in a component is one nothing here can hold. ./widget-level.ts is in
// the same shape.

/**
 * the sentence a screen says about an unreadable answer, with what the request cost.
 *
 * `what` is a fragment written to follow "so" — _nothing was saved_, _there is nothing to edit here
 * yet_ — which is the shape `WhyNot` in ./deployment-states.tsx takes its own in.
 */
export const unreadAnswer = (what: string): string =>
	`The console couldn't read this deployment's answer, so ${what}.`;

/** the same finding as the heading of the face that draws nothing else (../routes/_index.tsx). */
export const UNREAD_ANSWER_TITLE = "Can't read this deployment's answer";
