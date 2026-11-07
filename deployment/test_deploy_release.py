"""Hermetic regressions for deployment stdin handling, rollback and version verification.

Run: python3 -I deployment/test_deploy_release.py
Docker, curl and Tailscale are replaced; no production resources are accessed.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest


REVISION = "a" * 40
DEPLOYMENT = Path(__file__).resolve().parent


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app = self.root / "app"
        self.app.mkdir()
        for directory in ("frontend", "services", "deployment", "scripts"):
            (self.app / directory).mkdir()
        for filename in ("Cargo.toml", "Cargo.lock", "docker-compose.yml", ".dockerignore"):
            (self.app / filename).write_text("old\n")
        (self.app / "frontend/version").write_text("old\n")
        release = self.root / "release"
        (release / "frontend").mkdir(parents=True)
        (release / "frontend/version").write_text("new\n")
        self.archive = self.root / f"release-{REVISION}.tar.gz"
        subprocess.run(["tar", "-czf", str(self.archive), "-C", str(release), "frontend"], check=True)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.env = dict(os.environ, PATH=f"{self.bin}{os.pathsep}{os.environ['PATH']}",
                        TEST_LOG=str(self.root / "commands"), GITHUB_SHA=REVISION,
                        DEPLOY_HOST="test.invalid")
        self.tool("docker", '''
            printf '%s\\n' "$*" >> "$TEST_LOG"
            case "$*" in
              'compose exec '*)
                case "$*" in *--interactive=false*) ;; *) cat >/dev/null ;; esac
                printf 'database backup\\n' ;;
              'compose ps '*) printf 'container\\n' ;;
              'inspect '*)
                case "$*" in
                  *State.Health*) printf 'healthy\\n' ;;
                  *Config.Labels*) printf 'btcusd-tester-web:latest btcusd-tester\\n' ;;
                  *) printf 'image\\n' ;;
                esac ;;
              'image rm '*|'image prune '*) ;;
              'compose build '*) test "${TEST_FAIL_BUILD:-0}" != 1 ;;
            esac
        ''')
        self.tool("curl", '''
            printf '%s\\n' "$*" >> "$TEST_LOG"
            test "${TEST_FAIL_HEALTH:-0}" != 1
        ''')
        self.tool("flock", "exit 0")
        self.script = (DEPLOYMENT / "deploy-release.sh").read_text()
        self.script = self.script.replace("/opt/btcusd-tester-backups", str(self.root / "backups"))
        self.script = self.script.replace("/opt/btcusd-tester", str(self.app))
        self.script = self.script.replace("/var/lock/btcusd-tester-deploy.lock", str(self.root / "lock"))
        self.script = self.script.replace("/tmp/btcusd-release-", str(self.root / "release-"))

    def tool(self, name, body):
        path = self.bin / name
        path.write_text("#!/usr/bin/env bash\nset -eu\n" + textwrap.dedent(body))
        path.chmod(0o755)

    def deploy(self, revision=REVISION, *services):
        return subprocess.run(["bash", "-s", "--", revision, *services], input=self.script,
                              text=True, capture_output=True, env=self.env, timeout=15)

    def test_stdin_script_completes_and_records_verified_revision(self):
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.app / ".deployed-revision").read_text().strip(), REVISION)
        self.assertEqual((self.app / "frontend/version").read_text(), "new\n")
        self.assertIn(f"Deployed {REVISION}", result.stdout)
        self.assertEqual((self.root / f"backups/{REVISION}/database.sql").read_text(), "database backup\n")
        commands = (self.root / "commands").read_text()
        self.assertIn("compose build web market-data backtest payments", commands)
        self.assertIn("image tag btcusd-tester-web:latest btcusd-rollback-web", commands)
        self.assertIn("image tag btcusd-tester-web:latest btcusd-rollback-payments", commands)
        self.assertIn("/healthz", commands)
        self.assertIn("/api/market/meta", commands)

    def test_only_requested_services_are_rebuilt(self):
        result = self.deploy(REVISION, "web")
        self.assertEqual(result.returncode, 0, result.stderr)
        commands = (self.root / "commands").read_text()
        self.assertIn("compose build web\n", commands)
        self.assertNotIn("compose build web market-data", commands)
        self.assertIn("rebuilt: web", result.stdout)

    def test_invalid_service_is_rejected_before_docker(self):
        result = self.deploy(REVISION, "database")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Invalid service: database", result.stderr)
        self.assertFalse((self.root / "commands").exists())

    def test_old_rollback_images_and_backups_are_pruned(self):
        old = [f"{index:040x}" for index in range(1, 6)]
        (self.app / ".release-history").write_text("".join(f"{revision}\n" for revision in old))
        for revision in old:
            (self.root / f"backups/{revision}").mkdir(parents=True)
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        commands = (self.root / "commands").read_text()
        self.assertIn(f"image rm btcusd-rollback-web:{old[0]}", commands)
        self.assertFalse((self.root / f"backups/{old[0]}").exists())
        self.assertTrue((self.root / f"backups/{old[1]}").exists())
        self.assertEqual((self.app / ".release-history").read_text().splitlines()[-1], REVISION)
        self.assertEqual(len((self.app / ".release-history").read_text().splitlines()), 5)

    def test_build_failure_restores_source_without_success_marker(self):
        self.env["TEST_FAIL_BUILD"] = "1"
        result = self.deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("restoring previous images and source", result.stderr)
        self.assertEqual((self.app / "frontend/version").read_text(), "old\n")
        self.assertFalse((self.app / ".deployed-revision").exists())
        self.assertNotIn("Deployed ", result.stdout)

    def test_health_failure_rolls_back_without_success_marker(self):
        self.env["TEST_FAIL_HEALTH"] = "1"
        result = self.deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("restoring previous images and source", result.stderr)
        self.assertEqual((self.app / "frontend/version").read_text(), "old\n")
        self.assertFalse((self.app / ".deployed-revision").exists())

    def test_invalid_revision_is_rejected_before_docker(self):
        result = self.deploy("invalid")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Invalid commit SHA", result.stderr)
        self.assertFalse((self.root / "commands").exists())

    def test_workflow_rejects_missing_or_stale_revision(self):
        command = (DEPLOYMENT / "deploy-ci.sh").read_text()
        self.env.update(GITHUB_RUN_ID="123", GITHUB_RUN_ATTEMPT="1")
        self.tool("sleep", "exit 0")
        self.tool("timeout", 'shift; exec "$@"')
        self.tool("tailscale", '''
            case "$*" in
              *'cat /opt/btcusd-tester/.deployed-revision'*) printf '%s' "${TEST_REVISION:-}" ;;
              *'if test -f '*) printf '0\\n' ;;
            esac
        ''')
        for revision in ("", "b" * 40, REVISION):
            with self.subTest(revision=revision):
                result = subprocess.run(["bash", "-e", "-c", command], env=dict(self.env, TEST_REVISION=revision),
                                        capture_output=True, text=True, timeout=15)
                if revision == REVISION:
                    self.assertEqual(result.returncode, 0, result.stderr)
                else:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("Deployment revision mismatch", result.stderr)

    def run_ci(self, scenario):
        self.env.update(GITHUB_RUN_ID="123", GITHUB_RUN_ATTEMPT="1",
                        TEST_SCENARIO=scenario, TEST_COUNTER=str(self.root / "counter"))
        self.tool("sleep", "exit 0")
        self.tool("timeout", 'shift; exec "$@"')
        self.tool("tailscale", '''
            printf '%s\\n' "$*" >> "$TEST_LOG"
            case "$*" in
              *'systemd-run '*)
                if [ "$TEST_SCENARIO" = start_disconnect ] && ! test -f "$TEST_COUNTER"; then
                  touch "$TEST_COUNTER"; exit 255
                fi ;;
              *'if test -f '*)
                if [ "$TEST_SCENARIO" = status_disconnect ] && ! test -f "$TEST_COUNTER"; then
                  touch "$TEST_COUNTER"; exit 255
                fi
                if [ "$TEST_SCENARIO" = failure ]; then printf '42\\n'; else printf '0\\n'; fi ;;
              *'cat /opt/btcusd-tester/.deployed-revision'*) printf '%s\\n' "$GITHUB_SHA" ;;
              *'output.log'*) printf 'remote build diagnostic\\n' ;;
            esac
        ''')
        command = (DEPLOYMENT / "deploy-ci.sh").read_text()
        if scenario == "timeout":
            command = command.replace("SECONDS + 1800", "SECONDS - 1")
        return subprocess.run(["bash", "-e", "-c", command], env=self.env,
                              capture_output=True, text=True, timeout=15)

    def test_ci_recovers_disconnect_during_start_and_status(self):
        for scenario in ("start_disconnect", "status_disconnect"):
            with self.subTest(scenario=scenario):
                (self.root / "counter").unlink(missing_ok=True)
                result = self.run_ci(scenario)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn(f"Verified deployment {REVISION}", result.stdout)
                self.assertIn("remote build diagnostic", result.stdout)
                self.assertIn("reconnecting", result.stderr)

    def test_ci_reports_remote_failure_with_diagnostics(self):
        result = self.run_ci("failure")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Remote deployment failed (exit code 42)", result.stderr)
        self.assertIn("remote build diagnostic", result.stdout)
        self.assertNotIn("Verified deployment", result.stdout)

    def test_remote_start_is_idempotent_after_lost_acknowledgement(self):
        state = self.root / "remote-state"
        self.env.update(GITHUB_RUN_ID="123", GITHUB_RUN_ATTEMPT="1",
                        TEST_STATE=str(state), TEST_COUNTER=str(self.root / "unit-loaded"))
        self.tool("timeout", 'shift; exec "$@"')
        self.tool("sleep", "exit 0")
        self.tool("systemctl", '''
            if test -f "$TEST_COUNTER"; then printf 'loaded\\n'; else printf 'not-found\\n'; fi
        ''')
        self.tool("systemd-run", '''
            touch "$TEST_COUNTER"
            printf 'started\\n' >> "$TEST_LOG"
            while [ "$1" != /bin/bash ]; do shift; done
            "$@"
        ''')
        self.tool("tar", '''
            printf 'printf "build finished\\\\n"; exit 0\\n'
        ''')
        self.tool("tailscale", '''
            command=$3
            case "$command" in
              'cat /opt/btcusd-tester/.deployed-revision') printf '%s\\n' "$GITHUB_SHA" ;;
              *)
                bash -c "$command"
                case "$command" in
                  *systemd-run*)
                    if ! test -f "$TEST_STATE/ack-lost"; then
                      touch "$TEST_STATE/ack-lost"; exit 255
                    fi ;;
                esac ;;
            esac
        ''')
        command = (DEPLOYMENT / "deploy-ci.sh").read_text()
        command = command.replace('/var/log/btcusd-deploy/$run', str(state))
        result = subprocess.run(["bash", "-e", "-c", command], env=self.env,
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / "commands").read_text(), "started\n")
        self.assertEqual((state / "exit-code").read_text(), "0\n")
        self.assertEqual((state / "output.log").read_text(), "build finished\n")
        self.assertIn(f"Verified deployment {REVISION}", result.stdout)

    def test_ci_timeout_reports_remote_task_and_log_location(self):
        result = self.run_ci("timeout")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("remote task may still be running", result.stderr)
        self.assertIn("btcusd-deploy-123-1", result.stderr)
        self.assertIn("/var/log/btcusd-deploy/123-1/output.log", result.stderr)

    def test_ci_rejects_invalid_build_service(self):
        command = (DEPLOYMENT / "deploy-ci.sh").read_text()
        self.env.update(GITHUB_RUN_ID="123", GITHUB_RUN_ATTEMPT="1", BUILD_SERVICES="database")
        result = subprocess.run(["bash", "-e", "-c", command], env=self.env,
                                capture_output=True, text=True, timeout=15)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Invalid service: database", result.stderr)

    def test_ci_forwards_selected_services_to_remote_deploy(self):
        self.env["BUILD_SERVICES"] = "web payments"
        result = self.run_ci("success")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f'"{REVISION}" web payments', (self.root / "commands").read_text())


if __name__ == "__main__":
    unittest.main()
