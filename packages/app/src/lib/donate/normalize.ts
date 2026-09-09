import type { CheckoutApi, PropTypes } from '@better-giving/form/connect';
import type { DeductedFee } from '@better-giving/form/fee';
import type { ChangeEvent } from 'react';

// the react half of the adapter: the four prop shapes this page's views read, and the `normalize`
// that turns the flow's generic records into them.
//
// `connect` in @better-giving/form/connect builds plain records and hands them to a `normalize` a
// consumer supplies, so a framework adapter is this file plus the components that read it. what
// this one does that the element's own does not is real work in two directions:
//
//   - a box is handed back as one record that is legal to spread onto a native control. the flow
//     states `onChange(value)` and react states `onChange(event)`, so the conversion is here and a
//     view writes `<input {...api.emailField.box} />` — the name, the value, the platform's own
//     `required`/`pattern`/`maxlength` rule and the handler in one, with nothing to unpack and
//     nothing to forget.
//   - what is not legal to spread is kept out of that record. a select's options are nodes to
//     render rather than attributes to set, and a field's raw setter is the door a *press* writes a
//     box through — the tribute's notify press empties both of its boxes, and it does that through
//     the projection rather than at the actor, because that is where the flow's own answer to what
//     an empty pair means is already written.
//
// no `disabled`, on any shape below. double submission is prevented by the flow's shape — `quoting`
// has no `SUBMIT` handler — and connect.spec.ts in the form package asserts no getter emits the
// prop at all, so there is nothing here that could set it.
//
// no flow logic either. which cadences exist, which amounts, whether the fee is covered and whether
// a press would be taken are all answered by `connect`; a type here that invited a view to work one
// out again would be the same predicate held twice.

/** one member of a native radio family, as the flow states it. */
export type Option = {
	readonly value: string | number;
	readonly label?: string;
	readonly checked: boolean;
	readonly onChange: () => void;
};

export type GroupProps = {
	readonly name: string;
	readonly options: readonly Option[];
	/**
	 * a figure typed into the group's own entry, where a group has one. `null` is the box emptied
	 * rather than a figure.
	 */
	readonly onTyped?: (amountMinor: number | null) => void;
};

/** what the flow states about a text box, in the shape a native control takes. */
export type FieldBox = {
	readonly name: string;
	readonly type?: string;
	/** the platform's own rule for this field, set as the attribute and read back off `validity`. */
	readonly required?: boolean;
	/** the second half of that rule, where `required` alone would pass on a space. */
	readonly pattern?: string;
	/** the cap the endpoint holds this box to, which the platform enforces as it is typed. */
	readonly maxLength?: number;
	readonly value: string;
	readonly onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
};

export type FieldProps = {
	readonly box: FieldBox;
	/** the same door the box's own handler goes through, for a press that writes a box. */
	readonly set: (value: string) => void;
};

export type SelectProps = {
	readonly box: {
		readonly name: string;
		readonly value: string;
		readonly onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
	};
	readonly options: readonly { readonly value: string; readonly label: string }[];
};

export type ButtonProps = {
	readonly 'aria-busy': boolean;
	readonly onClick: () => void;
	readonly totalMinor?: number | null;
	/** what the rail would take out of the gift, for the reading of the fee row that declines it. */
	readonly declinedFee?: DeductedFee | null;
	readonly pressed?: boolean;
	/** whether the flow would take a press on a mark on the step head. */
	readonly available?: boolean;
};

type Shapes = {
	button: ButtonProps;
	group: GroupProps;
	field: FieldProps;
	select: SelectProps;
};

/** the whole surface this page's card renders from. */
export type ReactApi = CheckoutApi<Shapes>;

export const reactPropTypes: PropTypes<Shapes> = {
	button: (props) => props as unknown as ButtonProps,
	group: (props) => props as unknown as GroupProps,
	field: (props) => {
		const { onChange, ...rest } = props as unknown as Omit<FieldBox, 'onChange'> & {
			onChange: (value: string) => void;
		};
		return {
			box: { ...rest, onChange: (event) => onChange(event.currentTarget.value) },
			set: onChange
		};
	},
	select: (props) => {
		const { onChange, options, ...rest } = props as unknown as Omit<
			SelectProps['box'],
			'onChange'
		> & {
			onChange: (value: string) => void;
			options: SelectProps['options'];
		};
		return {
			box: { ...rest, onChange: (event) => onChange(event.currentTarget.value) },
			options
		};
	}
};
