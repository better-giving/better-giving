# Security policy

## Supported versions

Standalone is alpha. Only the latest release gets security fixes. Upgrade to it before you report, if you can. See [Deployment](DEPLOY.md) for how upgrades work.

## Report a vulnerability

Email {{SECURITY_CONTACT}}.

Do not open a public issue, pull request or discussion for a vulnerability. A public report tells everyone before there is a fix.

Send what you have:

- what is affected, and the release or commit you tested
- the steps to reproduce it
- what an attacker gains

You do not need a complete write-up. A short report is better than none.

## What happens next

1. We acknowledge your report.
2. We confirm the problem and work on a fix. We tell you if we cannot reproduce it, or if we think it is not a vulnerability.
3. We publish a release with the fix, and a note that says what was fixed.
4. We credit you in that note, unless you ask us not to.

Please keep the details private until the fix is released.

## Scope

This policy covers the code in this repository. A deployment is run by the organisation that deployed it. A problem in one deployment's own settings, keys or host is for that organisation to fix. Tell its operator.
