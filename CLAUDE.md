# Claude Code instructions for this repo

## Automated routine (people-list updater)

- **Do NOT send PushNotification at any point during a routine run** — neither on completion nor on error. Run silently in all cases.
- If the build fails, commit it to the transcript but do not push and do not notify.
- Zero-change runs (nothing new qualifies) produce no output and no notification.
