# RepoForge Runner

Worker process that turns a RepoForge run into an isolated Pi session.

The runner reads its contract from environment variables so it can be launched by the control API, cron, systemd, Docker, or a queue worker later.

## Required environment

- `REPOFORGE_CONTROL_URL`
- `REPOFORGE_RUN_ID`
- `REPOFORGE_PROJECT_ID`
- `REPOFORGE_REPO_URL`
- `REPOFORGE_PROMPT`

Optional:

- `REPOFORGE_BRANCH`
- `REPOFORGE_MODEL`
- `REPOFORGE_DRY_RUN=1`
- `REPOFORGE_KEEP_WORKSPACE=1`

## Development

```bash
npm install
npm run build
```

The MVP intentionally posts logs back to the control API as structured events. Later runners can add sandboxing, artifact uploads, PR creation, and queue leases without changing the UI contract.
