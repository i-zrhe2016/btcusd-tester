# Deployment stdin regression

Mode: normal, self-verification. Level: regression.

Root cause reproduced on the production host without changing services: piping a three-command script through SSH to `bash -s` printed the line before `docker compose exec -T postgres true`, but never printed the line after it. Compose forwarded the script's remaining standard input to the container. The previous release backed up the database and returned zero without executing the rest of the deployment.

The backup now disables interactive input. CI executes a script extracted from the uploaded release as a file with closed stdin, then independently compares the remote deployed revision with `GITHUB_SHA`. The marker is written only after Compose readiness and both HTTP health checks succeed.

## Automated acceptance

Command: `python3 -I deployment/test_deploy_release.py`.
Executed on Linux in a fresh temporary directory on 2026-11-03: 5 tests passed. Docker, curl, flock and Tailscale use isolated test doubles; no deployment occurs in these tests. Real tar/archive operations and Bash script execution are exercised.

| Acceptance | Risk | Evidence | Result |
|---|---|---|---|
| Backup cannot consume remaining deployment commands | high | Script supplied via stdin with a Docker double that consumes stdin unless interaction is disabled; asserts new source, backup, build, health calls and exact success marker | pass |
| Build failure does not report success | high | Nonzero build exit restores previous source and omits marker | pass |
| Health failure does not report success | high | Nonzero HTTP check restores previous source and omits marker | pass |
| Invalid revision cannot start deployment | medium | Invalid SHA rejected with useful error before Docker invocation | pass |
| CI rejects silent no-op or stale release | high | Actual workflow shell block rejects empty/stale marker and accepts exact SHA | pass |

## Test Quality Gate

| Dimension | Result | Evidence / N/A reason |
|---|---|---|
| Acceptance coverage | pass | All changed script and workflow contracts mapped above |
| Happy path | pass | New source and exact revision recorded after health checks |
| Boundary | pass | Missing/stale/matching revision and invalid input |
| Negative/failure | pass | Build/health failures restore source; no success marker |
| AuthN | N/A | Existing Tailscale authentication unchanged |
| AuthZ | N/A | Existing deployment principal and permissions unchanged |
| State/invariants | pass | Failure retains previous source; success records intended SHA |
| Integration | pass | Real Bash/tar/filesystem, external services replaced |
| Real entrypoint/config | pass | Stdin defect reproduced using real SSH and Compose; fixed workflow command covered by test doubles. Actual publication requires separate live verification |
| Regression | pass | Backup-consumes-stdin behavior modeled explicitly in Docker double |
| Property/fuzz | N/A | Fixed shell state transitions and exact SHA comparison |
| Mutation | N/A | Direct real-host reproduction and defect-sensitive stdin test used |
| Browser/E2E | N/A | Deployment change; existing frontend interaction tests unaffected |
| Isolation/flake | pass | Temporary directories, bounded subprocess timeouts, no network in suite |

Additional executed static checks: `bash -n deployment/deploy-release.sh` and `git diff --check` passed. Live rollout and CI results must be verified separately after merge; this report does not claim publication success.
