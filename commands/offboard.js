export default async function offboard ({ logger }, { username, dryRun }) {
  // Implement offboarding logic here
  if (dryRun) {
    logger.info(`[DRY RUN] Would offboard user: ${username}`)
  } else {
    logger.info(`Offboarding user: ${username}`)
  }
}
