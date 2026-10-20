# Media: recovery of failed-task derivative cleanup

Status: implemented with isolated recovery acceptance. This owner-local cleanup is not a privacy-request fulfillment and does not remove source uploads or successful results.

## Scope

Media owns `processing_tasks.cleanup_pending` and the four fixed derivative object names under `workspaces/{workspaceId}/media/derivatives/{taskId}/`: `clip.mp4`, `audio.wav`, `captions.srt`, and `captions.vtt`. When a derivative task fails or is cancelled and object removal fails, the task remains terminal with `cleanup_pending=true`. Media's dispatcher reclaims the per-task advisory lease, removes only those four keys derived from the task's stored workspace and id, and clears `cleanup_pending` after deletion succeeds.

The SQL row is retained as a tombstone/status record. A cleanup failure leaves `cleanup_pending=true` for a later dispatcher pass. If object deletion succeeded but the following SQL update failed, a new Media process repeats the same fixed-key deletes; already missing objects are treated as successful by the S3-compatible object store, then Media clears the flag. The cleanup does not accept keys from queue payloads or callers and does not enumerate/delete a workspace prefix.

## Isolated acceptance

The recovery fixture restores its own Media database and RustFS volume, then creates a failed terminal task with `cleanup_pending=true` and four derivative objects, plus four control objects for a separate workspace. A database trigger injects failure while clearing the flag, after object deletion. The fixture verifies the task remains pending, shuts down the first Media runtime, starts a fresh runtime to retry, and checks the flag clears while the control workspace's four objects remain. A third restart confirms the terminal cleanup is idempotent. This exercises the actual dispatcher, database, Redis, and S3-compatible endpoint without touching the shared stack.

## Limits

This only covers derivatives of failed/cancelled Media processing tasks. It does not cover successful outputs, source uploads, inspection originals, Analysis transcripts/segments, editor/review references, logs, backups, or external provider copies. It does not add a user-triggered deletion API or establish retention periods; deletion of successful/shared content remains blocked on owner authorization and cross-service reference policy.
