# Commonly used CI workflows

This repo consists of reusable workflow specifications for commonly used languages within the Wayke project. The workflow files are referenced and used by deployable services.

## northstar publish

`northstar-publish.yaml` is a reusable workflow that projects a source repo's current state into [`wayke-se/northstar`](https://github.com/wayke-se/northstar). Pushes are serialised per source repo (`cancel-in-progress: false`) so no event is dropped, and the publisher retries with `git pull --rebase` on conflict. The extraction logic itself lives in [`northstar/EXTRACT_PROMPT.md`](https://github.com/wayke-se/northstar/blob/master/EXTRACT_PROMPT.md) — this workflow only orchestrates checkouts, runs Claude Code against that prompt, and pushes the result.

It can be triggered two ways:

1. **Chained from a k8s deploy (default).** The `k8s-deploy.yaml`, `k8s-multi-deploy.yaml`, and `k8s-blue-green.yaml` reusable workflows now run a `publish-northstar` job automatically after a successful deploy, gated on `github.ref_name in (main, master, test)`. It is opt-out via `publish-to-northstar: false`. Callers must forward two new secrets — see below.
2. **Standalone push trigger.** For repos that don't deploy via the `k8s-*` workflows, drop [`examples/northstar-publish.yaml`](examples/northstar-publish.yaml) into the source repo to publish directly on push to `main`, `master`, or `test`. That caller uses `secrets: inherit` and needs no further setup.

Two org-level secrets are expected: `ANTHROPIC_API_KEY` and `NORTHSTAR_WRITE_TOKEN` (a PAT with write access to `wayke-se/northstar`). Both should already exist at the org level — no per-repo secret creation needed.

### Existing k8s deploy callers — two-line addition

Existing source-repo callers of `k8s-*.yaml` use an explicit `secrets:` map (for `credentials`). GitHub forbids mixing `secrets: inherit` with an explicit map, so the two new secrets must be mapped explicitly too. Add two lines:

```yaml
jobs:
  deploy:
    uses: wayke-se/ci/.github/workflows/k8s-deploy.yaml@master
    with:
      service: my-service
      image: ...
      cluster: ...
      environment: ...
      kustomize: deploy/overlays/test
    secrets:
      credentials: ${{ secrets.AZURE_CREDENTIALS_TEST }}
      anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
      northstar-write-token: ${{ secrets.NORTHSTAR_WRITE_TOKEN }}
```

To opt a repo out (e.g. infra-only, no contracts to project), pass `publish-to-northstar: false` and skip the two extra secret lines.
