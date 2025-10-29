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

This command removes a user from the active teams in the GitHub organization and npm maintainers.

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

## License

Licensed under [MIT](./LICENSE).
