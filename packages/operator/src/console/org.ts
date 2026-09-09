// the organisation's legal identity as the console surface carries it, named once for both ends of
// the wire.
//
// it is here for the reason ./token.ts is here, and it arrived the same way: a console surface
// started rendering a profile, so the shape moved out of the app rather than being copied into the
// console. the deployment writes this member of ./report.ts's
// envelope and the console draws a box per field, the two packages import nothing of each other's,
// and a list written out on each side is a field one half stops sending and the other goes on
// drawing a box for.
//
// **what a value may be is next door in ./org-rules.ts, and a rule about one of these fields is
// stated there and nowhere else.** those rules are here in the leaf rather than on either side of
// the wire because two surfaces apply them to the same nine values: the deployment parses every
// profile it is sent, and the console applies the same rules in front of the person typing so that
// a name over its cap or a value that is not an EIN is answered at the box rather than after a
// round trip. a copy on either side would be a second opinion about whether a receipt may be
// printed, and the half that drifts is the one nothing reports — which is what one module removes.
// the deployment stays the authority, exactly as ../origins.ts's second paragraph puts it for the
// site list: this surface is reachable by anything holding a console session, so the worker parses
// whatever it is sent.
//
// so this file is the names and the order, and nothing else. the split is worth keeping: what
// crosses the wire is a vocabulary every reader of the envelope needs, and the rules are a schema
// only the two ends that judge a value reach for.

/**
 * the field names, which are also the error keys and also the column names.
 *
 * one vocabulary rather than three, and it is carried by the key rather than by the message: a
 * refusal keyed by field is something a console puts beside the box that has to change, and the
 * sentence in it is a sentence a fundraiser reads.
 *
 * the order is the order a screen asks for them in — who the organisation is and where it is —
 * and it is the order the deployment states them in too.
 *
 * `org_profile.deductibility_statement` is deliberately not one of them. no operator screen asks
 * for a wording and no press posts one: the standard 501(c)(3) sentence is what a served config
 * carries, and a fork wanting different words edits ../deductibility.ts. a name on this list is a
 * box a console draws and a column a save states, and that column is neither.
 */
export const ORG_PROFILE_FIELDS = [
	'legal_name',
	'tax_id',
	'address_line1',
	'address_line2',
	'city',
	'region',
	'postal_code',
	'country',
	'notification_email'
] as const;

export type OrgProfileField = (typeof ORG_PROFILE_FIELDS)[number];

/**
 * the profile as it crosses the wire: one string per field, absent where the deployment holds
 * nothing.
 *
 * absent rather than `undefined`, because that is what a column holding null becomes on the way
 * out and what a form yields for a box nobody filled in. a console reading one states a value for
 * every box regardless — an absent key is an empty box, not a box with no seed.
 */
export type OrgProfileValues = Partial<Record<OrgProfileField, string>>;
