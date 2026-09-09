---
name: reset
description: tear down the dev deployment and pack a fresh worker bundle, so `pnpm console` sets up from nothing.
disable-model-invocation: true
---

# reset

Delete everything a `pnpm console` set-up created — servers, worker, database, local console state — and pack the worker bundle the next set-up will deploy, so the next `pnpm console` runs the whole chain from nothing. The user typed `/reset` asking for exactly this deletion: proceed straight through.

**Already-gone is success.** Every target below may be absent, and each step names the signal its own tool gives for that. Report it as already-gone and carry on to the next step.

Read the worker and database names from `packages/app/wrangler.jsonc` (`name`, and the d1 binding's `database_name`) at run time; they are the deployment's single source of truth, and the steps below spell them `<name>` and `<database_name>`.

**One command per call.** The permission classifier refuses a compound that reads a secret inside a pipeline, and refuses `wrangler` under an environment-variable prefix; both go through as plain single commands. So keep a secret read to an assignment line of its own, and leave the prefix off unless the account note at the end says to add it.

## Steps

1. **Kill the console's servers.** `pnpm console` runs two: the ui dev server on 5322 and the go api on 5325; a hand-started binary defaults to 5320. Kill whatever holds those ports:
   `lsof -ti tcp:5320 -ti tcp:5322 -ti tcp:5325 | xargs kill`
   Done when all three ports hold no listener.

2. **Delete this deployment's Stripe webhook endpoint.** It lives on the Stripe account and outlives the worker; left behind, it goes on receiving every gift the account takes, and a worker still at that address answers each with a mail about a payment settled against no gift. The address is `https://<name>.<subdomain>.workers.dev/api/stripe/webhook`, and three things stand between the run and it:

   - **`<subdomain>`** — `GET https://api.cloudflare.com/client/v4/accounts/<account_id>/workers/subdomain`, bearer the `oauth_token` in `~/Library/Preferences/.wrangler/config/default.toml`, `<account_id>` from `pnpm wrangler whoami`.
   - **The key** — `STRIPE_SECRET_KEY` in `packages/app/.dev.vars`, read into a shell variable on a line of its own and passed as `--api-key` so it stays out of the transcript. **Pass it on every call.** The `stripe` CLI carries a login of its own and it is a different Stripe account: a call without `--api-key` lists somebody else's endpoints, and the address is absent from those, so the run reports already-gone over an endpoint that is still there.
   - **The calls** — `stripe webhook_endpoints list --limit 100 --api-key "$SK"`, then `stripe webhook_endpoints delete <id> --api-key "$SK" --confirm` for each id whose `url` is the address; the delete prints an account preamble ahead of its JSON, so the id comes off the list.

   Done when the list no longer holds the address; no match is already-gone. Every other address the list carries is another deployment's and stays.

3. **Delete the app's worker.** From the repo root: `pnpm wrangler delete` — the name comes from `wrangler.jsonc`, every secret and var dies with the worker, and a non-interactive run auto-confirms. Done on `Successfully deleted <name>`, or on `code: 10007` — Cloudflare's "this Worker does not exist on your account", which is already-gone.

4. **Delete the donation page's worker a set-up made before the page moved into the app may have left.** `pnpm wrangler delete --name <name>-donate`. No press puts one up any more — the donation page is the app's own route, `/{form_id}` (`packages/app/src/routes/$formId.tsx`) — but a deployment made when one did still holds it, and left behind it keeps answering with a page pointing at a deployment that no longer exists. Done on step 3's two signals, and **`10007` is the ordinary outcome here** — it arrives as a failed command, pnpm exiting non-zero over its own wrapper error with Cloudflare's reason several lines above, so read the output for the code rather than the exit status. The step can go once no deployment from before that change is left.

5. **Delete the database.** `pnpm wrangler d1 delete <database_name> -y`. This is the one-way door of the run — the records are unrecoverable, which is what a reset is for. Done when wrangler confirms or the name is already absent.

6. **Wipe local console state.** Delete the directory `$BETTER_GIVING_HOME` if set, else the os config home (`~/Library/Application Support/better-giving` on macos). It holds the account claim, the oauth token and the deployment session, so the next `pnpm console` starts at the Cloudflare allow page. Done when the directory is gone.

7. **Rebake the console's config.** `go run ./cmd/bake` from `packages/console`. The pack reads the committed `internal/release/config.json`, so the bake is what carries a migration added since the last one into the bundle (`cmd/bake/main.go` states the arrangement). Done when the bake names the file and the commit it stamped; a changed file is the user's to commit.

8. **Pack the worker bundle.** `pnpm run bundle` from the repo root. A checkout-built binary is version `dev`, so the deploy press looks for a release that was never cut and refuses with `that release carries no worker-dev.tar.gz`; this writes the one it reads instead. It is the slow step — two builds and a dry run — and it is here because a reset is the moment the next deploy is certain to want a bundle built from the tree as it stands. Done when the script names the archive it wrote and its module, asset and migration counts.

9. **Verify and report.** `pnpm wrangler d1 list` prints nothing under its own banner, the three ports are quiet, and the bundle holds every migration in the tree: `tar tzf packages/console/bundle/worker-dev.tar.gz | grep -c 'migrations/.*sql'` equals `ls packages/app/migrations/*.sql | wc -l`. Report each target as deleted or already-gone, then name the next command: `pnpm console`.

## What survives, deliberately

- **The turnstile widget** — the next set-up press adopts it by name (`packages/console/internal/first`).
- **Other deployments' webhook endpoints** — the same Stripe account at other addresses, each somebody else's set-up, and step 2 touches exactly one. One whose deployment is gone is deleted in the Stripe dashboard.
- **The workers.dev subdomain** — account-level, reused as is.

## If wrangler names the wrong account

Two Cloudflare accounts on one wrangler login make deletes ambiguous (and deploys fail with "Authentication error 10000"). Pin with `CLOUDFLARE_ACCOUNT_ID=<id>` on the wrangler command — and only here, because that prefix is itself what the permission classifier refuses on an otherwise-fine delete.
