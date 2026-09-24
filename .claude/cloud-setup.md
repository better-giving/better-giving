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
sandboxapi.givechariot.com
sandbox-quickbooks.api.intuit.com
```

## Setup script

```bash
#!/bin/bash
set -uo pipefail
log=/tmp/setup.log; exec > >(tee -a "$log") 2>&1
try() { for i in 1 2 3; do "$@" && return 0; sleep $((i*3)); done; echo "SETUP FAIL: $*"; return 1; }

# kru store
try git clone -q https://github.com/ap-justin/kru-store ~/.kru
[ -f ~/.kru/setup.sh ] && bash ~/.kru/setup.sh

# plugins
try claude plugin marketplace add ap-justin/kru
try claude plugin install kru@kru --scope user
try claude plugin marketplace add anthropics/claude-plugins-official
try claude plugin install typescript-lsp@claude-plugins-official --scope user
try npm install -g typescript-language-server typescript@6

# better-giving-oss: pnpm at package.json's packageManager
# the session-start hook links the pinned binary onto PATH
try sh -c 'curl -fsSL https://get.pnpm.io/install.sh | env SHELL=/bin/bash PNPM_VERSION=10.19.0 sh -'
# chromium for packages/form's browser specs, at the playwright version packages/form pins
try npx -y playwright@1.62.1 install --with-deps chromium

node --version; "$HOME/.local/share/pnpm/.tools/pnpm-exe/10.19.0/pnpm" --version; go version; claude plugin list
exit 0
```
