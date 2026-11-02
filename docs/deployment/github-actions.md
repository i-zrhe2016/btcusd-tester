# GitHub CI/CD

`.github/workflows/ci-cd.yml` runs frontend tests/build, Rust workspace tests and Compose validation for pull requests and main pushes. Successful main runs deploy to the existing Tailscale host. Manual runs deploy only when main is selected.

## Required setup

Create a Tailscale OAuth client with permission to create ephemeral devices tagged `tag:ci`. Save its client ID and secret as GitHub Actions secrets `TS_OAUTH_CLIENT_ID` and `TS_OAUTH_SECRET` in the repository or the `production` environment. Never commit these values.

In the tailnet policy, authorize the OAuth client's tag ownership, permit `tag:ci` to reach the deployment host, and add a Tailscale SSH accept rule from `tag:ci` to the deployment host as `root`. Limit the destination to this host rather than the whole tailnet. Interactive SSH approval is unsuitable for an unattended runner.

Optional Actions variable `DEPLOY_HOST` overrides `deploy.taile2c45c.ts.net`. The existing host must have Docker Compose with `up --wait`, curl, flock, and the stack at `/opt/btcusd-tester`, including production `.env`, `docker-compose.override.yml`, certificates and market data. The current HTTP health endpoint is port 8083.

The `production` GitHub environment may require reviewer approval if desired. Do not run deployment on untrusted pull-request code.

## Release and recovery

The runner archives the exact checked-out commit, uploads it over Tailscale SSH, and executes `deployment/deploy-release.sh`. The script takes an exclusive lock, backs up PostgreSQL and tracked source under `/opt/btcusd-tester-backups/<sha>`, tags the current images, builds and starts the application, waits for container health, and checks HTTP and market metadata. Production settings and data remain in place. Successful deployments record `.deployed-revision`.

On failure after source extraction, the script restores the prior source and application images and starts them again. Database backups are retained for manual recovery; the script does not automatically restore the database, so incompatible future database migrations require an explicit migration and recovery plan. Backups and rollback images need periodic retention management based on available storage.

## Verification status

The workflow requires the Tailscale secrets and policy before end-to-end deployment can run. Local syntax checks do not prove GitHub runner connectivity or successful Rust CI execution.
