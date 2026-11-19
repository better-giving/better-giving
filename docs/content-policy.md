# Content policy

This page is for the organisation that deploys Standalone, and for anyone who finds something on a deployment that should not be there. The organisation that runs a deployment is responsible for what its public pages show.

## What is not allowed

Not on a public page of a deployment:

- anything illegal where the deployment operates
- child sexual abuse material
- hate against people for who they are
- harassment, threats, or someone's private information
- fraud, including a fundraiser that asks for money for something that is not real
- pretending to be another person or organisation

## What the public can write

Two places on a deployment show words from the public:

- A **supporter fundraiser** is a page a member of the public starts for the organisation. It holds a title, a story and an optional photo (`packages/app/src/lib/server/db/schema.ts`, `supporterPage`).
- A **gift note** is a note a donor leaves with a gift and chooses to show on the donation page (`donation.note_public`).

Staff write everything else, such as campaign pages.

## Hide a page

Open Supporter pages in `/admin` (`packages/app/src/lib/admin/destinations.ts`). Press Hide on the page. You can add a note, and the supporter reads it word for word on their own page (`packages/app/src/lib/admin/supporter-pages/supporter-pages.tsx`, `packages/app/src/lib/supporter/area/manage.tsx`). Visitors no longer see a hidden page, and the gifts it raised stay on the books. Press Show again to bring it back, which clears the note.

To take a gift note off the donation page, open Messages under Donations in `/admin` and press Hide message (`packages/app/src/routes/_app.admin.donations.messages.tsx`). The gift itself is untouched.

## Report a page

Anyone can report a page to the organisation that runs the deployment. Use the contact address the organisation publishes. Say which page it is and what is wrong with it.

If you run a deployment, publish a contact address on your site and read it. When a report is about child sexual abuse material, hide the page at once and report it to your local authority.

On Better Giving's own managed service, report to {{CONDUCT_CONTACT}}. Better Giving responds within 2 business days.

## Who can start a fundraiser

A supporter must be 18 or older, or have a parent's or guardian's consent. The payment processors you connect also have their own age rules.

The software does not check age. Applying this rule is your policy to keep, for example in your fundraiser terms and in how you answer reports.
