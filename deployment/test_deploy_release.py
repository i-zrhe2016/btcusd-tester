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
        for directory in ("frontend", "services", "deployment"):
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
              'inspect '*) printf 'image\\n' ;;
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

    def deploy(self, revision=REVISION):
        return subprocess.run(["bash", "-s", "--", revision], input=self.script,
                              text=True, capture_output=True, env=self.env, timeout=15)

    def test_stdin_script_completes_and_records_verified_revision(self):
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.app / ".deployed-revision").read_text().strip(), REVISION)
        self.assertEqual((self.app / "frontend/version").read_text(), "new\n")
        self.assertIn(f"Deployed {REVISION}", result.stdout)
        self.assertEqual((self.root / f"backups/{REVISION}/database.sql").read_text(), "database backup\n")
        commands = (self.root / "commands").read_text()
        self.assertIn("compose build web market-data backtest", commands)
        self.assertIn("/healthz", commands)
        self.assertIn("/api/market/meta", commands)

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
        workflow = (DEPLOYMENT.parent / ".github/workflows/ci-cd.yml").read_text()
        command = textwrap.dedent(workflow.split("      - name: Deploy and verify\n        run: |\n", 1)[1])
        self.tool("tailscale", '''
            case "$*" in
              *'cat /opt/btcusd-tester/.deployed-revision'*) printf '%s' "${TEST_REVISION:-}" ;;
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


if __name__ == "__main__":
    unittest.main()
