# Privacy

This page is for the organisation that deploys Standalone. It says what personal data a deployment holds, where it lives, and what you do about a donor's request to see or erase it. It describes what the code does today. It is not legal advice, and it is not a privacy statement for your donors. Write that yourself from what is here.

## Who is responsible

You are. The organisation that runs a deployment is the data controller for everything in it. Better Giving maintains the software and receives none of the data.

## What a deployment stores

Every table below is in the deployment's own database (`packages/app/src/lib/server/db/schema.ts`, `auth-schema.ts`).

**Donors** (`contact`). A donor's display name, first and last name, email address and phone number. Whether they said yes to being written to, kept as a yes, a no, or nothing recorded. The last answer wins, so a later gift can withdraw an earlier yes.

**Gifts** (`donation`). The amount, currency, fee and date of each gift, and the donor it belongs to. Also what the donor typed: a note, and if they chose one, a dedication ("in honor of" or "in memory of") with the person's name. A dedication can name someone to tell, with that person's name and email address. The page the gift was made on is kept as the browser's `Origin` value. A note the donor made public is stored with the name printed over it.

**Employer matching** (`gift_match`). The employer name a donor gives for a matching-gift claim, and a private link token for the donor's page about that gift.

**Supporter fundraisers** (`supporter`, `supporter_page`, `supporter_link`, `supporter_session`). A member of the public who starts a fundraiser gives a name and an email address. Their page holds a title, a story, a goal and an optional photo, and these are public once the page is live. Sign-in links and sessions are stored as hashes, and expired ones are swept out.

**Staff accounts** (`auth_user`, `auth_account`, `auth_session`, `auth_verification`). A name and email address for each colleague you invite. A colleague's password is stored as a hash. The deployer's own password is a setting in `.env` and is not stored in the database. Each staff session keeps the IP address and browser user agent it was opened from.

**Payments** (`payment`, `recurring_plan`). Which processor took a gift, its reference ids and its state. The app never sees a card number. The donor's browser sends card details to the processor.

**Logs.** The server writes ordinary output, and where it goes depends on your host.

## What goes to other services

- **Payment processors.** Each gift's amount and currency, and a reference to the gift (`packages/app/src/lib/server/donations/quote.ts`). No name a donor typed is sent to the processor. The processor collects what the donor enters on its own fields, under its own privacy policy.
- **Your mail provider.** The app sends mail over SMTP. Receipts, thank-you notes, dedication notices, matching-gift packs and supporter sign-in links go through your provider, so it sees the recipient's address and the message.
- **Zapier and webhooks.** If you connect them, gift events carry the donor's name and email address to the hook address you set.

## Where it lives, and backups

All of it is in one database file on your host. Photos are in the same file.

A backup is a copy of that file, so it holds every table above. Treat a backup like the database. [Deployment](../DEPLOY.md#backups) shows how to take one and how to restore it.

## Consent

The donation form asks whether the donor wants to hear from the organisation. The box is unticked until the donor ticks it (`packages/app/src/lib/donate/steps/details.tsx`). A donor you enter by hand in `/admin` has no answer recorded, which is different from a no.

Notes show on a public page only if the donor ticked the box for that. Staff can take a public note down.

## Access and erasure requests

There is no screen for either. You do them in the database file.

**Access.** Look the donor up by email address in `contact`, then read their rows in `donation`, `gift_match`, `supporter` and `supporter_page`. Give the donor a copy.

**Erasure.** The app never hard-deletes a donor who has gifts. Gift rows point at the donor, and the database refuses a delete that leaves them pointing at nothing. The schema has an `archived_at` column on `contact` for this, but no screen or job in the app sets it today. You set it yourself. To erase a donor by hand:

1. Take a backup first.
2. On the donor's `contact` row, clear the first name, last name, legal name, email address and phone number. Reset `attributes` to `{}`, set the display name to a placeholder such as `Erased donor`, and set `archived_at`.
3. On each of their `donation` rows, clear the note, the dedication kind and name, and the notified name and email address. Set `note_public` and `note_anonymous` to 0, and clear `note_hidden_at` and `note_shown_name`. The database refuses a shown name on a note that is not public.
4. Clear the employer on their `gift_match` rows.
5. If they ran a fundraiser, hide the page in `/admin`, delete their `supporter_link` and `supporter_session` rows, and replace the `supporter` name and email address with placeholders. Both are required, and the address must be lowercase and unique. A page that has gifts is never deleted, so the page stays.
6. Stop any repeating gift at the processor, and ask the processor and your mail provider to erase what they hold.
7. Remember the older backups. They still hold the erased data until they are replaced.

**What must stay.** The amount, currency and date of each gift, and its receipt record. Tax and accounting records need them, and the ledger is never edited. Keep these rows and let them point at the archived donor.

Check your local rules for how long you must keep records, and for how fast you must answer a request.
