# Security policy

## Reporting

Use GitHub private vulnerability reporting on this repository.
Do not open a public issue for a security report.
Do not include exploit details, credentials, or live customer data.

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x | yes |

## Secrets

Runtime secrets belong in the host environment. `.env.example` lists keys with empty values.
Do not commit `.env`, keystores, or generated crypto keys.
The product requirements in GChoPro-PRD.md §18 are mandatory, including argon2id, admin TOTP, session revocation, CSRF, CSP, field encryption, device-token hashing, the admin IP allowlist, rate limits, and the hash-chained audit log.
