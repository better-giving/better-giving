// whether the press the page just made was the one that ends the run.
//
// **it is a module rather than a field read where it is needed because one of its two readers is
// handed an untyped value.** the page reads it off `actionData` (../routes/_index.tsx), where the
// shape is the action's own and a field test would do; the router hands the same answer to
// `shouldRevalidate` as `any`, and that is the reader whose mistake costs something — a revalidation
// let through here reaches a binary that has stopped, and the operator meets the boundary that says
// the console crashed over a press that ended the run on purpose.
//
// it lives beside the screen for the reason ./unread-answer.ts does: this package's pool is
// node-only and collects `*.spec.ts` (packages/console-ui/vite.config.ts), so a reading written
// inline in a route module is one nothing here can hold.

/** whether an answer off this page's action is the close press's. */
export function saidClosing(answer: unknown): boolean {
	return typeof answer === 'object' && answer !== null && 'closing' in answer;
}
