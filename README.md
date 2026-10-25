# better-giving

Self-hosted donation platform for nonprofits. Your own processor, receipts and books, no platform fee.

Donors give on a form on the organisation's site, or on the page the deployment serves at `/donate`. Staff use the dashboard at `/admin` for campaigns, forms, gifts, donors, and the books. Charges land in the organisation's own Stripe, PayPal, Chariot, or NOWPayments account.

## Run it

Docker with Compose.

```sh
cp .env.example .env
docker compose build
docker compose run --rm migrate
docker compose up -d
```

Set `ADMIN_PASSWORD` (at least 12 characters) and `BETTER_AUTH_SECRET` in `.env` before the first start. The server refuses to start without either, and it refuses a password under 12 characters. Sign in at `http://localhost:3000/login` as `admin`, or on `BETTER_GIVING_PORT` when that is set, with the password from `.env`.

The dashboard opens. A form takes gifts once Settings has the organisation's registered name and EIN and one processor can settle a gift.

## Go further

- [Configuration](docs/configuration.md): environment, mail, processors, the organisation
- [Deployment](DEPLOY.md): a host of your own, Fly.io, backups, upgrades
- [Embed a form](docs/embed.md)
- [Architecture](docs/architecture.md)
- [Contributing](CONTRIBUTING.md)

## License

MIT. See [`LICENSE`](LICENSE). Fork it, host it, change it, sell it. Stewarded by Better Giving. You run your own instance.
