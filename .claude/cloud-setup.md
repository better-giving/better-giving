## Environment variables

```
KRU_STORE_REPO=ap-justin/kru-store
```

## Network access

Custom, with *include defaults* on, plus:

```
get.pnpm.io
cdn.playwright.dev
playwright.download.prss.microsoft.com
ppa.launchpadcontent.net
mcp.context7.com
mcp.better-auth.com
api-m.sandbox.paypal.com
sandboxapi.givechariot.com
sandbox-quickbooks.api.intuit.com
```

## Setup script

```bash
#!/bin/bash
# kru v0.159.0
set -uo pipefail
exec > >(tee -a /tmp/setup.log) 2>&1

try() {
  for _ in 1 2 3; do "$@" && return 0; sleep 2; done
  echo "SETUP FAIL: $*"
}

# kru store
try git clone -q https://github.com/ap-justin/kru-store ~/.kru
[ -f ~/.kru/setup.sh ] && try bash ~/.kru/setup.sh

# plugins
try claude plugin marketplace add anthropics/claude-plugins-official
try claude plugin marketplace add ap-justin/kru
try claude plugin install kru@kru --scope user
try claude plugin enable cc-plugin-you-should-know@builtin --scope user
try claude plugin install typescript-lsp@claude-plugins-official --scope user
try npm install -g typescript-language-server typescript@6

# better-giving-oss: pnpm at package.json's packageManager; .claude/cloud-install.sh puts it on PATH
try env SHELL=/bin/bash PNPM_VERSION=10.19.0 sh -c 'curl -fsSL https://get.pnpm.io/install.sh | sh -'
# chromium for packages/form's browser specs, at the playwright version packages/form pins
try npx -y playwright@1.62.1 install --with-deps chromium

node --version; "$HOME/.local/share/pnpm/.tools/pnpm-exe/10.19.0/pnpm" --version; go version; claude plugin list
exit 0
```
