import { CheckboxGroup } from './CheckboxGroup.jsx';
import { FieldMessage } from './FieldMessage.jsx';

/**
 * @import { ReactNode } from 'react'
 * @import { CheckboxItem } from './CheckboxGroup.jsx'
 */

/**
 * @typedef {object} NamedCheckboxes
 * @property {string} id
 * @property {ReactNode} legend the group's name — `Gifts`, `Donors`.
 * @property {readonly CheckboxItem[]} items
 */

/**
 * `id` carries no default, for ./CheckboxGroup.jsx's reason: the refusal is named from it and the
 * whole question points at it.
 *
 * @typedef {object} CheckboxGroupsProps
 * @property {string} id
 * @property {string | undefined} [name] the name every box submits under, so the ticked ones arrive
 *   as one value repeated whichever group they stand in. an item naming itself beats it.
 * @property {ReactNode} legend the question the groups answer together — `Events`.
 * @property {ReactNode} [error] the question's refusal, drawn once under the last group.
 * @property {readonly NamedCheckboxes[]} groups
 */

/* one question answered from several short named lists: the events a webhook destination is sent.
   `.adm-checkgroups` in packages/operator/src/styles/adm.css draws the groups; each group's boxes
   are ./CheckboxGroup.jsx's, drawn without a legend of their own so the fieldset here is the one
   that names them.

   a refusal is the question's rather than a group's or a box's — "choose at least one" is failed by
   every box together and fixed by any one of them — so it marks the outer fieldset and is
   placed once beneath the last group, and no box is drawn refused. a failed submit puts focus on the
   first box, which is the caller's: the box's own `id` is what it reaches for. */
/** @param {CheckboxGroupsProps} props */
export function CheckboxGroups({ id, name, legend, error, groups }) {
	return (
		<fieldset
			className="adm-fieldset"
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={error ? `${id}-err` : undefined}
		>
			<legend className="adm-fieldset__legend">{legend}</legend>
			<div className="adm-checkgroups">
				{groups.map((group) => (
					<fieldset className="adm-fieldset" key={group.id}>
						<legend className="adm-field__label">{group.legend}</legend>
						<CheckboxGroup id={group.id} name={name} items={group.items} />
					</fieldset>
				))}
			</div>
			{error ? <FieldMessage id={`${id}-err`}>{error}</FieldMessage> : null}
		</fieldset>
	);
}
