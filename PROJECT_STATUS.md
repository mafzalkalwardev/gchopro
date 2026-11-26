# Project status

type: web
repo: https://github.com/mafzalkalwardev/gchopro
live:

- [x] 0 intake done
- [x] 1 docs done
- [x] 2 github done
- [x] 3 issues done
- [ ] 4 backend
- [ ] 5 frontend
- [ ] 6 review
- [ ] 7 media
- [ ] 8 readme
- [ ] 9 ship
- [ ] 10 closeout

## Notes

- Canonical spec is `GChoPro-PRD.md`. `PRD.md` is the launch index.
- Milestone issues: M1 #1, M2 #2, M3 #3, M4 #4, M5 #5, M6 #6, M7 #7, M8 #8.
- Product work follows milestones M0–M8 in GChoPro-PRD.md §24. Phases 4–10 stay open until those milestones cover them.
- M0 is foundation only. Screens, media, the SEO README, deploy, and graphify are later.
- Local Docker is not installed. Compose migrate and seed are checked in CI, not on this machine.
- M8 is the deployment milestone: production compose, backups, retention, and the runbook. The image and restore test run in CI.
- M1 is security and auth. Browser e2e is HTTPS on `admin.localhost` and `portal.localhost` and runs in CI.
