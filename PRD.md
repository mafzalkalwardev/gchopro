# PRD — GChoPro

The canonical specification is [GChoPro-PRD.md](GChoPro-PRD.md). This file is the launch index. It does not add scope. If the two disagree, GChoPro-PRD.md wins.

## Problem

Operators who own Android phones with physical SIM cards need a secure way to send and receive SMS from those SIMs. GChoPro is that platform: an admin panel, a user portal, a background worker, and a gateway app on the phone. See GChoPro-PRD.md §1.

## Users

- **Admin.** Pairs phones, assigns one SIM to each user, manages subscriptions, policies, alerts, and the audit log. GChoPro-PRD.md §5.
- **User.** Signs in with credentials the admin issued and messages from the assigned SIM only.
- **Device.** The paired Android gateway. It is not a human account.

## Stories

- As an admin, I want to pair a gateway phone and see each SIM, so that I can bind one SIM to one user.
- As an admin, I want password resets to revoke sessions immediately, so that a replaced credential cannot keep a portal tab open.
- As a user, I want to send and receive SMS on my assigned SIM, including optional Chinese↔English translation, so that I can message without handling the phone.
- As an admin, I want a suspected suspension to pause that SIM and alert me, so that recovery stays a manual re-test.
- As an operator, I want pacing and caps, so that sends stay inside carrier fair use.

## Non-goals

From GChoPro-PRD.md §2.2 and §26:

- No features that disguise traffic, rotate SIMs to dodge blocks, move a blocked SIM's messages to another SIM, or automatically recover a suspended SIM.
- No online payments, Google Play distribution, default-SMS-app behavior, WhatsApp, MMS, RCS, or voice.
- No self-registration and no public bulk-send API in v1.
- User API keys and webhooks (F20) and white-label (F21) are not built.

## Success

Milestones M0–M8 in GChoPro-PRD.md §24 are done in order, and the acceptance checklists in §22.2 pass. `PROGRESS.md` records what was verified.

## Constraints

Free tools only unless a paid tool is listed under Paid later in `MEMORY.md`.

- Exact stack and repository layout: GChoPro-PRD.md §21.
- Security requirements: §18. Configuration comes from environment variables. No secrets in git.
- Compliance: §2.2 and §19.
- Ambiguities use the defaults in §26.

## Acceptance criteria

- [ ] Devices and multi-SIM (GChoPro-PRD.md §22.2)
- [ ] Users, sessions, subscriptions (§22.2)
- [ ] Messaging and pacing (§22.2)
- [ ] SIM health and alerts (§22.2)
- [ ] Translation (§22.2)
- [ ] Analytics (§22.2)
- [ ] Security (§22.2)
- [ ] Compliance (§22.2)
