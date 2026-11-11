import { type DefaultValue, type FieldMetadata, useForm } from '@conform-to/react';
import { parseWithZod, type SubmissionResult } from '@conform-to/zod/v4';
import type { z } from 'zod';
import { FORM_CURRENCY } from '$lib/forms/amounts';
import type { StatedForm } from '$lib/forms/definition';
import { boxSentence } from './copy';
import type { BoxState } from './field';

// a supporter's form mounted on the statement its action parses (./forms.ts), on the timing every
// form in this app keeps (`useAdminForm` in $lib/admin/use-admin-form.ts): nothing is marked until a
// submit, and a marked box re-checks on every change from then on. a refused submit puts focus in the
// first refused box, which conform does by the box's `name` on the form its id names.

/** what a route hands back from a refused post: the form's own result, or nothing. */
export type FormResult = SubmissionResult | null | undefined;

export function useSupporterForm<S extends z.ZodObject>(
	stated: StatedForm<S>,
	lastResult: FormResult,
	defaultValue?: DefaultValue<z.input<S>>
) {
	return useForm<z.input<S>, z.output<S>>({
		id: stated.id,
		lastResult: lastResult ?? undefined,
		...(defaultValue === undefined ? {} : { defaultValue }),
		shouldValidate: 'onSubmit',
		shouldRevalidate: 'onInput',
		onValidate: ({ formData }) => parseWithZod(formData, { schema: stated.schema })
	});
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
