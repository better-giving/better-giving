import { type FormEvent, useState } from 'react';

// a count that moves once for every answer a form's press gets — refused in the browser before it
// was sent, or answered by the route's action — for a refusal a screen draws itself to be keyed on.
// a live region announces what changes in it, so the same words left in the same node after a
// second press are heard by nobody; keyed on this count, they are a new node each time.
//
// the browser's refusal is conform's: its submit handler cancels the event when a box fails the
// schema, and a submission it lets through is answered by `actionData`, which is a new object per
// answer.

/**
 * the count, and the submit handler that feeds it: `conformSubmit` is the one `getFormProps` hands
 * the form.
 */
export function useAnswerRevision(
	actionData: unknown,
	conformSubmit: (event: FormEvent<HTMLFormElement>) => void
): {
	readonly revision: number;
	readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
} {
	const [refused, setRefused] = useState(0);
	const [answered, setAnswered] = useState({ by: actionData, count: 0 });
	if (answered.by !== actionData) setAnswered({ by: actionData, count: answered.count + 1 });
	return {
		revision: refused + answered.count,
		onSubmit(event) {
			conformSubmit(event);
			if (event.defaultPrevented) setRefused((n) => n + 1);
		}
	};
}
