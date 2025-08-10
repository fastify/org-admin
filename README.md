# org-admin
Utilities to handle the organization's permissions

## Installation

```bash
npm install @fastify-org/org-admin
```

## Commands

### Onboard a user

- [ ] TODO

### Offboard a user

- [ ] TODO

### Check emeritus members

This command checks the last contribution date of org's members.
It creates an issue listing the users that have been inactive for more than a specified number of months.


```bash
node --env-file=.env index.js emeritus --org <org> [--monthsInactiveThreshold] [--dryRun]
```

## License

Licensed under [MIT](./LICENSE).
