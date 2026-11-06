# Deployment reconnect verification

Scope: Actions deployment orchestration only. Mode: normal; level: regression.
Result: PASS for hermetic regression acceptance; production rollout not performed.
Verification was performed by the implementing agent, not an independent verifier.

Changes run in an isolated clone on branch `fix/deploy-reconnect`.

| Acceptance | Risk | Evidence | Result |
| --- | --- | --- | --- |
| Recover lost start acknowledgement without duplicate execution | high | test_remote_start_is_idempotent_after_lost_acknowledgement executes generated remote command with isolated systemd/tool substitutes; exactly one build, persisted log/exit code, verified revision | pass |
| Recover SSH interruption during start/status | medium | test_ci_recovers_disconnect_during_start_and_status | pass |
| Surface remote failure with build diagnostics | high | test_ci_reports_remote_failure_with_diagnostics, exit 42 and diagnostic assertions | pass |
| Reject stale/missing deployed revision | high | test_workflow_rejects_missing_or_stale_revision | pass |
| Bound waiting and give recovery location | medium | test_ci_timeout_reports_remote_task_and_log_location; expired deadline | pass |
| Preserve deploy success, rollback and input validation | high | Existing four release regressions | pass |

Executed on deployment host in `/tmp/grailab-deploy-reconnect-tests`, with Docker, curl, Tailscale and systemd operations replaced by isolated fixtures. No production deployment was started.

Commands: `bash -n deployment/deploy-ci.sh deployment/deploy-release.sh`; `python3 -I deployment/test_deploy_release.py` (9 tests passed); `git diff --check` (passed). Remote availability of systemd 255 and `/usr/bin/systemd-run` checked.

| Test Quality Gate dimension | Result | Evidence / N/A reason |
| --- | --- | --- |
| Acceptance coverage | pass | Matrix above |
| Happy path/contract | pass | Release marker, log and caller confirmation asserted |
| Boundary | pass | Expired deadline; missing/stale revision |
| Negative/failure | pass | SSH 255 recovery, remote 42 diagnostics, rollback |
| AuthN | N/A | Existing Tailscale identity/login unchanged |
| AuthZ | N/A | Existing production root SSH authorization unchanged |
| State transition/invariant | pass | Lost acknowledgement executes task once; no success for failed release |
| Integration/contract | pass | Actual Bash subprocesses, generated remote shell, filesystem exit marker and log |
| Real entrypoint/config | pass | CI invokes tested script; remote command executed with hermetic dependencies; systemd availability verified |
| Regression | pass | 9 tests passed |
| Property/fuzz | N/A | No new general parser or numerical transformation |
| Mutation | N/A | Explicit failure/recovery scenarios and side-effect assertions cover targeted defects |
| Browser/E2E | N/A | No browser or HTTP behavior changed |
| Isolation/flake | pass | Temporary fixtures; deterministic disconnect injection, no timing sleeps |

Limitations: actual transient-unit execution over a dropped production SSH connection and a new Actions run remain unverified until rollout. The underlying host disk I/O stall is not fixed by this orchestration change. If confirmation expires, the error explicitly says the remote task may still run and names the unit and log. The existing host deployment lock continues to prevent overlapping deployment work.
