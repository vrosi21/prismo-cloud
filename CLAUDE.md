# Prismo Cloud

Self-hosted media cloud and planner. How it fits together: README.md. What was done
when, and what is open: HANDOVER.md.

## Prismo board

This project's board is **"prismo roadmap"**, in Prismo's folder `projects`. Keep it current:
- At the start of a session: `/prismo` (or `node ~/.claude/skills/prismo/prismo.mjs check --as prismo-cloud`),
  then `list --folder projects --tag prismo` to see where things stand.
- When work starts, finishes or gets blocked: update its card (status doing / done / waiting).
- New work that will take more than one session: add a task card for it (tags `prismo`, `area:<part>`).
- Once per session: one `log` line saying what changed.
- If the check fails (401 or 403): stop and tell me "Prismo needs a new plan token:
  Settings > new token > plan, then run scripts\install-skill.ps1". Do not try other ways in.

## Deploying

A push to `main` is tested and deployed by GitHub Actions (server, then web). Changes to
`deploy/compose.yaml` or `deploy/server.sh` need `deploy/deploy.sh` by hand first (README,
"The live site"). Commit and push only when the user asks.
