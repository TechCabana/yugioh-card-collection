---
description: Manually trigger the YuGiOh Process Data GitHub Action (Airtable sync + deploy)
---

Run the `process data` trigger from this repo's CLAUDE.md (§6):

1. `gh workflow run process-data.yml`
2. Watch the run, report enriched/skipped/blocked counts.
3. Name any blocked serial, field and missing Airtable option — never auto-add a select option.
4. Confirm the deploy finished and the live site reflects the change.
