---
name: fix-pr-review
description: Fetch the latest automated PR review (Codex review bot, or human reviews), triage each actionable finding, fix the valid ones, verify, commit/push, and re-request review. Use when a PR has new review comments to address, or run via /loop to auto-respond as Codex reviews arrive.
argument-hint: "[PR-number]"
allowed-tools: Bash(gh *) Bash(git *) Bash(rtk *) Bash(bash -n *) Bash(pnpm *) Bash(cargo *) Bash(just *) Bash(wc *) Bash(grep *) Bash(ls *) Bash(mktemp *) Read Edit Write
---

# Fix PR Review

Address automated PR review feedback in one pass: fetch new findings, triage,
fix the valid ones, verify, push, and re-request review. Built for the Codex
review bot (it auto-reviews on each push and replies to `@codex review`), but
works for any reviewer's inline comments.

## Arguments

- `$1` (optional): PR number. If omitted, resolve the PR for the current
  branch via `gh pr view --json number`.

## Procedure

### 1. Identify the PR
- If a PR number was given, still fetch its head branch: `gh pr view <n> --json number,headRefName,url`. Compare `headRefName` against the local branch (`git rev-parse --abbrev-ref HEAD`); if they differ, STOP and tell the user (or check out the PR branch first) — otherwise step 3's HEAD comparison misclassifies findings as stale and step 7 pushes fixes to the wrong branch.
- If no PR number was given, resolve it from the current branch: `gh pr view --json number,headRefName,url`; if no PR exists for the current branch, stop and tell the user.
- Resolve `owner/name` via `gh repo view --json nameWithOwner`.

### 2. Fetch the latest review
- Inline comments: `gh api repos/<owner>/<name>/pulls/<n>/comments --jq 'sort_by(.created_at) | .[] | {user: .user.login, path, line: (.line // .original_line), body, created_at, commit: .commit_id}'`
- Review summaries / states: `gh pr view <n> --json reviews`
- Issue-level comments (your prior `@codex review` replies): `gh pr view <n> --json comments`

### 3. Scope to NEW findings only
- Get current HEAD: `git rev-parse HEAD`. A finding is relevant only if its `commit_id` is HEAD (it reviewed the latest push) OR it was posted after your last reply comment on this PR.
- Findings tied to an older commit may already be fixed — always re-read the current file before acting.
- If there are NO new actionable findings (only 👍 / approval / stale comments): report "no new review findings — nothing to do" and STOP. **This is the loop's natural termination.**

### 4. Triage each finding — DO NOT fix blindly
For each new finding decide:
- **Valid + actionable** → fix it.
- **Invalid / false positive** → do NOT touch code; reply on the PR explaining why, and skip.
- **Out of scope / needs human judgment** (architecture, product, security trade-offs) → STOP and escalate to the user with a summary. Do not push a speculative fix.
- **Watch for fix-induced regressions**: a fix can create a new problem (a real example on this repo: seeding env files then leaving an invalid `VITE_RP_ID`, which the next review round flagged). Reason about downstream effects before applying.

### 5. Apply fixes
- Re-read the region you're changing first. Edit the minimum needed; keep the change scoped to the finding. No drive-by refactors.

### 6. Verify before pushing (mandatory)
- Shell scripts: `bash -n <file>`.
- Reproduce the reviewer's scenario with a dry-run when feasible (e.g. run the changed function against a temp fixture via `mktemp`) — don't just assume the fix works.
- TS / build-affecting: `tsc -b` or `pnpm build` on the affected package. Rust contracts: `cargo test` (after `stellar contract build`).
- If verification fails, fix and re-verify (max 3 cycles) before pushing.

### 7. Commit + push
- Stage only the files you changed (never `git add -A`).
- Message: `fix(<scope>): <what>` + a body naming the reviewer, the finding, and how it was addressed. Include the `Co-Authored-By` trailer.
- `git push` to the PR branch (the local `commit.gpgsign=false` is already set on this repo; do NOT pass `--no-verify` or otherwise bypass hooks).

### 8. Reply + re-request review
- `gh pr comment <n> --body "..."`: summarize what changed, what you intentionally did NOT change and why, reference the commit SHA, then end with `@codex review` to trigger the next automated pass.

## Stop / loop-termination conditions (IMPORTANT)

- **Terminate** when step 3 finds no new actionable findings (Codex reacted 👍, or only stale/approved comments remain).
- **Escalate to the user (stop, do NOT push)** when:
  - The same finding (same `path:line` + same gist) recurs after you already addressed it once — this is a disagreement loop with the bot; let the human decide.
  - You've already pushed **5 review-response commits** on this PR in the current session — a hard cap against runaway Codex⇄Claude churn. Count from the conversation history.
  - A finding needs a product / architecture / security judgment call.
- Never push a fix you can't verify. Never silence a finding by bypassing checks (no `--no-verify`, no disabling the reviewer, no editing the reviewer's config to suppress it).

## Running on a schedule

To auto-respond as Codex reviews arrive, run this skill on a loop:

```
/loop 5m /fix-pr-review <PR-number>
```

- Codex usually posts a review a few minutes after each push, so a ~5m
  interval matches its cadence (and keeps the prompt cache warm).
- The loop ends itself when step 3 reports "no new findings" for the PR, or
  when a stop condition above fires.
- Omit the interval (`/loop /fix-pr-review <n>`) to let the model self-pace
  between checks.
