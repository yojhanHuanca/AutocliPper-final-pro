# Splitting an editor draft

Project exposes `POST /v1/edits/{draftId}/split`. The request body contains `cutSeconds`, an absolute timestamp on the source video timeline:

```json
{"cutSeconds": 38.5}
```

The caller needs editor access to the source upload, a valid CSRF token, a quoted current `If-Match` value (for example `"3"`), and a UUID `Idempotency-Key`. A missing `If-Match` returns 428; an obsolete version returns 412. The cut must lie strictly inside the current revision, and both resulting clips must satisfy the existing 0.1–120 second duration limit. Each output is also materialized against the inspected source; split-screen and transcript references retain their existing validation.

The operation creates two new editor drafts in one PostgreSQL transaction. Both reuse the original upload, project, and workspace. The original draft and its revision history remain unchanged, so the two results are returned explicitly as `left` and `right`; the original remains visible in the project draft list. Nothing is copied to object storage, and the operation does not create processing jobs, reserve storage, render media, or add a usage charge.

User subtitle cues are divided at the cut. A cue crossing the cut is clipped into both outputs while keeping the same text; if either fragment would be shorter than the subtitle minimum, the cut is rejected instead of silently dropping that text. A side with no remaining user cues uses the `none` caption source. Transcript caption provenance stays attached to its existing analysis and is independently validated for both ranges. Other clip settings, including framing and aspect ratio, are preserved.

The request hash and two deterministic, creator-scoped idempotency keys are stored on the output drafts. A retry with the same key and payload returns the same pair, including when requests arrive concurrently. Reusing the key with a different source version or cut returns 409. The database transaction writes both drafts and their first immutable revisions together, so an insert failure cannot leave only one half of the split. The original draft is locked and its version rechecked immediately before those writes.

This endpoint is a backend operation; the current Angular Editor has not yet wired its split control to it.
