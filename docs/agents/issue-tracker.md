# Issue tracker: Linear

Issues and specs for this repo live in the Linear project **Skyguide** on team `YGG`. The project spans two repos: this one (skydive-app — React web app + Nitro server) and **skyguide-skse** (the SKSE plugin). Use the `linear` CLI for all operations.

Project: https://linear.app/yggdraz/project/skyguide-29ffb22af3d0 (slug `skyguide-29ffb22af3d0`)

## Conventions

- **Create an issue**: `linear issue create -t "..." -d "..." --project Skyguide` (use `--description-file -` with stdin for multi-line descriptions).
- **Read an issue**: `linear issue view <ID>` (e.g. `YGG-12`).
- **List / filter**: `linear issue query --project Skyguide` with `--state` (types: triage, backlog, unstarted, started, completed, canceled), `--assignee @me`, `-U` (unassigned), `--label`, `--search`.
- **Sub-issues**: `linear issue create --parent YGG-12 ...` or `linear issue update --parent YGG-12 <child>`.
- **Blocking**: `linear relation` manages blocks/blocked-by. A ticket is unblocked when every blocker is completed/canceled.
- **Comments**: `linear issue comment add <ID> --body "..."` / `comment list <ID>`.
- **Labels**: `linear issue update <ID> --add-label "..."` / `--remove-label "..."`.
- **Start work**: `linear issue start <ID>` (checks out its branch, marks started); `linear issue id` prints the issue ID of the current branch.
- **Close**: post the explanation with `linear issue comment add`, then `linear issue update <ID> -s completed`.
- **Commits/PRs**: `linear issue describe <ID>` prints a commit trailer; `linear issue pull-request <ID>` opens a GitHub PR for the issue.

## When a skill says "publish to the issue tracker"

Create a Linear issue in the Skyguide project.

## When a skill says "fetch the relevant ticket"

`linear issue view <ID>` plus `linear issue comment list <ID>`.
