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
 * @property {string | number | undefined} [revision] whatever changes once per answered
 *   submission — the caller's count of refusals, the submission's own id. the refusal is redrawn as
 *   a new node whenever it changes, so a live region announces a second refusal whose words match
 *   the first: the same text left in the same node is no change, and a reader who pressed again
 *   hears nothing. unstated, a refusal is announced when it first appears and when its words change.
 * @property {readonly NamedCheckboxes[]} groups
 */

/* one question answered from several short named lists: the events a webhook destination is sent.
   `.adm-checkgroups` in packages/operator/src/styles/adm.css draws the groups; each group's boxes
   are ./CheckboxGroup.jsx's, drawn without a legend of their own so the fieldset here is the one
   that names them.

   a refusal is the question's rather than a group's or a box's — "choose at least one" is failed by
   every box together and fixed by any one of them — so it is placed once beneath the last group.
   it is marked on the boxes and not on the fieldsets, for ./CheckboxGroup.jsx's reason: a failed
   submit puts focus on the first box, which is the caller's (the box's own `id` is what it reaches
   for), and a box is where a reader landing on it is told why. the fieldset's own description is
   not reliably read on entry, and where it is, it is the sentence twice. */
/** @param {CheckboxGroupsProps} props */
export function CheckboxGroups({ id, name, legend, error, revision, groups }) {
	const errorId = error ? `${id}-err` : undefined;
	return (
		<fieldset className="adm-fieldset">
			<legend className="adm-fieldset__legend">{legend}</legend>
			<div className="adm-checkgroups">
				{groups.map((group) => (
					<fieldset className="adm-fieldset" key={group.id}>
						<legend className="adm-field__label">{group.legend}</legend>
						<CheckboxGroup id={group.id} name={name} errorId={errorId} items={group.items} />
					</fieldset>
				))}
			</div>
			{error ? (
				<FieldMessage key={revision} id={errorId}>
					{error}
				</FieldMessage>
			) : null}
		</fieldset>
	);
}
