# org-admin
Utilities to handle the organization's permissions

## Installation

```bash
npm install @fastify-org/org-admin
```

## Commands

### Onboard a user

This command adds a user to the specified teams in the GitHub organization.

```bash
node --env-file=.env index.js onboard --org <org> --username <user> --team <team_1> --team <team_n> [--dryRun]
```

For the fastify organization, the command would look like:

```bash
node --env-file=.env index.js onboard --username <user> --team collaborators --team plugins --team website --team frontend
```

### Offboard a user

This command removes a user from the active teams in the GitHub organization and npm teams
and adds the user to the `emeritus` team if it exists.

```bash
node --env-file=.env index.js offboard --org <org> --username <user> [--dryRun]
```

### Check emeritus members

This command checks the last contribution date of org's members.
It creates an issue listing the users that have been inactive for more than a specified number of months.


```bash
node --env-file=.env index.js emeritus --org <org> [--monthsInactiveThreshold] [--dryRun]
```

For the fastify organization, the command would look like:

```bash
node --env-file=.env index.js emeritus --monthsInactiveThreshold 24
```

### List sponsors

This command reads the organization's sponsors from both GitHub Sponsors and
Open Collective and lists them. Recurring sponsors that stopped paying (cancelled
or overdue) are flagged as `lapsed`. The list is logged and written to a
`sponsors.json` file with three keys: `github`, `openCollective` and `flagged`
(the lapsed sponsors across both sources).

```bash
node --env-file=.env index.js sponsors --org <org>
```

For the fastify organization, the command would look like:

```bash
node --env-file=.env index.js sponsors
```

Reading Open Collective backers is public and needs no token. Open Collective
exposes per-charge data, so a lapsed contribution shows its `lastChargedAt` /
`nextChargeDate`. GitHub does not expose individual charges, so a GitHub sponsor
is only flagged as `lapsed` when a recurring sponsorship has been cancelled
(its `lastChargedAt` is always `null`). To raise the Open Collective rate limit
you may optionally set `OC_PERSONAL_TOKEN` in `.env` (a personal token from your
own account — Open Collective has no org-level token).

## License

Licensed under [MIT](./LICENSE).
