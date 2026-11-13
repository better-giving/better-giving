import { type InputHTMLAttributes, useState } from 'react';
import { counted } from './copy';

// one box of a supporter's form, in the registry's field classes (field-css): the label above,
// "(optional)" in the label's own words, the hint, the box, then the refusal under it. it is the
// contract packages/operator's `Field.jsx` keeps — `${id}-hint` and `${id}-err` describe the box,
// `aria-invalid` follows the refusal — drawn without that component's `adm-*` classes, which only
// the /admin sheet (packages/operator/src/styles/adm.css) draws and a donor page never links.
//
// conform finds the first refused box by its `name` on the form it owns (`report` in
// @conform-to/dom), so a box needs nothing more than its `name` for a refused submit to land on it.

/** what conform knows of one box, and the sentence its refusal is said in. */
export type BoxState = {
	readonly id: string;
	readonly name: string;
	readonly defaultValue?: string | undefined;
	/** the sentence under the box, or nothing while it is not refused. */
	readonly error?: string | undefined;
};

type Shared = {
	readonly box: BoxState;
	readonly label: string;
	readonly hint?: string | undefined;
};

/** the ids that describe a box, in the order they are drawn. */
const describedBy = (...parts: (string | false | undefined)[]) =>
	parts.filter(Boolean).join(' ') || undefined;

export function TextField({
	box,
	label,
	hint,
	prefix,
	...input
}: Shared &
	Pick<
		InputHTMLAttributes<HTMLInputElement>,
		'type' | 'autoComplete' | 'inputMode' | 'placeholder' | 'maxLength'
	> & {
		/** a sign at the box's start, said by the label rather than read out: the goal's `$`. */
		readonly prefix?: string | undefined;
	}) {
	const { id, name, defaultValue, error } = box;
	const control = (
		<input
			id={id}
			name={name}
			defaultValue={defaultValue}
			className={prefix === undefined ? 'ds-field-input' : 'sa-prefixed'}
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={describedBy(hint && `${id}-hint`, error && `${id}-err`)}
			{...input}
		/>
	);
	return (
		<div className="ds-field">
			<label className="ds-label" htmlFor={id}>
				{label}
			</label>
			{hint ? (
				<p className="ds-field-hint" id={`${id}-hint`}>
					{hint}
				</p>
			) : null}
			{prefix === undefined ? (
				control
			) : (
				// registry gap: field-css has no prefix slot. the container is its own, holding a bare input.
				<div className="ds-field-input-container">
					<span className="sa-prefix" aria-hidden="true">
						{prefix}
					</span>
					{control}
				</div>
			)}
			<Refusal id={id} error={error} />
		</div>
	);
}

/** the story's box: a textarea with the count of what is typed against its cap under it. */
export function StoryField({ box, label, hint, max }: Shared & { readonly max: number }) {
	const { id, name, defaultValue, error } = box;
	const [used, setUsed] = useState(defaultValue?.length ?? 0);
	return (
		<div className="ds-field">
			<label className="ds-label" htmlFor={id}>
				{label}
			</label>
			{hint ? (
				<p className="ds-field-hint" id={`${id}-hint`}>
					{hint}
				</p>
			) : null}
			<textarea
				id={id}
				name={name}
				defaultValue={defaultValue}
				className="ds-field-input sa-story"
				rows={6}
				maxLength={max}
				aria-invalid={error ? 'true' : undefined}
				aria-describedby={describedBy(hint && `${id}-hint`, error && `${id}-err`, `${id}-count`)}
				onInput={(event) => setUsed(event.currentTarget.value.length)}
			/>
			<Refusal id={id} error={error} />
			{/* registry gap: field-css has no character counter. */}
			<p className="sa-count" id={`${id}-count`}>
				{counted(used, max)}
			</p>
		</div>
	);
}

/**
 * the sentence under a refused box. `live` where it arrives with focus already on the control it
 * describes — a photo turned down after the file chooser closed — so it is said as it lands.
 */
export function Refusal({
	id,
	error,
	live = false
}: {
	readonly id: string;
	readonly error?: string | undefined;
	readonly live?: boolean;
}) {
	return error ? (
		<p className="ds-field-err" id={`${id}-err`} role={live ? 'alert' : undefined}>
			{error}
		</p>
	) : null;
}
