import { type InputHTMLAttributes, useEffect, useRef, useState } from 'react';
import { charactersLeft, counted } from './copy';

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
	...attributes
}: Shared &
	Pick<
		InputHTMLAttributes<HTMLInputElement>,
		'type' | 'autoComplete' | 'inputMode' | 'placeholder' | 'maxLength'
	> & {
		/** a sign at the box's start, said by the label rather than read out: the goal's `$`. */
		readonly prefix?: string | undefined;
	}) {
	const { id, name, defaultValue, error } = box;
	const input = useRef<HTMLInputElement>(null);
	const control = (
		<input
			id={id}
			name={name}
			defaultValue={defaultValue}
			ref={input}
			className={prefix === undefined ? 'ds-field-input' : undefined}
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={describedBy(hint && `${id}-hint`, error && `${id}-err`)}
			{...attributes}
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
				<div className="ds-field-input-container">
					{/* a press on the sign focuses the box, as a press on the label does. */}
					<span
						className="ds-field-affix ds-field-prefix"
						aria-hidden="true"
						onMouseDown={(event) => {
							event.preventDefault();
							input.current?.focus();
						}}
					>
						{prefix}
					</span>
					{control}
				</div>
			)}
			<Refusal id={id} error={error} />
		</div>
	);
}

/** how long the typing has to stop before the count's crossing is said. */
const SETTLED_MS = 1000;

/** the share of the cap from which the counter takes the warning ink (field-css.usage.md). */
const NEAR = 0.9;

/**
 * the story's box: a textarea with the count of what is typed against its cap under it, in
 * field-css's counter. the count is drawn for the eye and describes the box; a crossing into the
 * last tenth of the cap is said once the typing stops, in a status kept on the page.
 */
export function StoryField({ box, label, hint, max }: Shared & { readonly max: number }) {
	const { id, name, defaultValue, error } = box;
	const [used, setUsed] = useState(defaultValue?.length ?? 0);
	const [said, setSaid] = useState('');
	const settling = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	/** the length last typed, read when the typing stops. */
	const latest = useRef(used);
	useEffect(() => () => clearTimeout(settling.current), []);
	const near = used >= max * NEAR;
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
				onInput={(event) => {
					const typed = event.currentTarget.value.length;
					const crossed = typed >= max * NEAR !== near;
					latest.current = typed;
					setUsed(typed);
					// a crossing waits for the typing to stop, and every key until then puts it off.
					if (!crossed && settling.current === undefined) return;
					clearTimeout(settling.current);
					settling.current = setTimeout(() => {
						settling.current = undefined;
						const now = latest.current;
						setSaid(now >= max * NEAR ? charactersLeft(max - now) : '');
					}, SETTLED_MS);
				}}
			/>
			<div className="ds-field-meta">
				<Refusal id={id} error={error} />
				<span
					className="ds-field-counter"
					id={`${id}-count`}
					data-state={near ? 'near' : undefined}
					aria-hidden="true"
				>
					{counted(used, max)}
				</span>
			</div>
			<p className="ds-sr-only" role="status">
				{said}
			</p>
		</div>
	);
}

/** the sentence under a refused box. */
function Refusal({ id, error }: { readonly id: string; readonly error?: string | undefined }) {
	return error ? (
		<p className="ds-field-err" id={`${id}-err`}>
			{error}
		</p>
	) : null;
}
