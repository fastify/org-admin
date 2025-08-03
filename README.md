# org-admin
Utilities to handle the organization's permissions

## Installation

```bash
npm install @fastify-org/org-admin
```

## Commands

### Onboard a user

```bash
npx @fastify-org/org-admin onboard <username> --org <org> [--dry-run]
```

### Offboard a user

```bash
npx @fastify-org/org-admin offboard <username> --org <org> [--dry-run]
```

### Check emeritus members

This command checks the last contribution date of members
and marks them as emeritus if they haven't contributed in the last 12 months.

```bash
npx @fastify-org/org-admin emeritus --org <org> [--dry-run]
```

## License

Licensed under [MIT](./LICENSE).
