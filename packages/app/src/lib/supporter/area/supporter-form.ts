import type { FieldMetadata } from '@conform-to/react';
import type { SubmissionResult } from '@conform-to/zod/v4';
import type { AdminActionData } from '$lib/admin/use-admin-form';
import { FORM_CURRENCY } from '$lib/forms/amounts';
import { boxSentence } from './copy';
import type { BoxState } from './field';

// what a supporter's screens share around the one form seam, `useAdminForm` in
// $lib/admin/use-admin-form.ts: each screen states its form with `defineForm` in its own file and
// mounts it there (`formIdViolations` in packages/app/form-rules.ts reads the declaration in the
// calling file), so a refused submit puts focus in the first refused box by its `name`.

/** what a route hands back from a refused post: the form's own result, or nothing. */
export type FormResult = SubmissionResult | null | undefined;

/** a route's result as the seam takes an action's answer: under `form`, under this form's id. */
export function answered(form: { readonly id: string }, lastResult: FormResult): AdminActionData {
	return lastResult ? { form: { id: form.id, result: lastResult } } : null;
}

/** one box as ./field.tsx draws it, its refusal said in the supporter's words (./copy.ts). */
export function boxOf(field: FieldMetadata<unknown>): BoxState {
	const message = field.errors?.[0];
	return {
		id: field.id,
		name: field.name,
		defaultValue: typeof field.initialValue === 'string' ? field.initialValue : undefined,
		error: message === undefined ? undefined : boxSentence(field.name, message, FORM_CURRENCY)
	};
}
