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

# kru store
git clone -q https://github.com/ap-justin/kru-store ~/.kru || true
[ -f ~/.kru/setup.sh ] && bash ~/.kru/setup.sh || true

# plugins
claude plugin marketplace add ap-justin/kru || true
claude plugin install kru@kru --scope user || true
claude plugin install typescript-lsp@claude-plugins-official --scope user || true
npm install -g typescript-language-server typescript@6 || true

# better-giving-oss: pnpm at package.json's packageManager
curl -fsSL https://get.pnpm.io/install.sh | env SHELL=/bin/bash PNPM_VERSION=10.19.0 sh - || true
ln -sf "$HOME/.local/share/pnpm/pnpm" /usr/local/bin/pnpm || true
# chromium for packages/form's browser specs, at the playwright version packages/form pins
npx -y playwright@1.62.1 install --with-deps chromium || true

node --version; pnpm --version; go version
```
