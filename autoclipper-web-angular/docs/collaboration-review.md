# Collaboration and review panel

The editor's collaboration panel reads and writes review state through the existing
gateway routes in `CollaborationApi`. It does not synthesize activity, comments,
approvals, or review links in the browser.

## User-visible behavior

- A review status or comment list is shown as empty only after the corresponding
  server read succeeds. Failed reads offer retry and keep prior confirmed comments
  visible with a stale-data notice where applicable.
- Approval, return to editor, comment removal, and review-link revocation require
  an explicit confirmation before issuing the existing mutation.
- A review-link revocation is shown as complete after the server accepts it, even
  if refreshing the link list then fails. A later read reconciles the displayed
  status with the server.
- Link and audit reads are scoped to the current edit and current permission. If
  the route changes, access is downgraded, or the server denies the read, prior
  private rows are cleared and late responses are ignored.
- Reviewer and reader roles cannot invoke link-management or review-decision
  actions through the panel methods. The server remains the final authority for
  role, revision, and transition validation.

## Existing API boundaries

The panel uses the current review, approvals, comments, review-links, and audit
routes exposed by `CollaborationApi`. A successful browser response is the source
for each displayed state. Review links expose their bearer token only in the
creation response, so the panel keeps that value in component memory for copying;
it does not persist the token or log it.

The API's comments are independent observations associated with a timestamp;
they do not provide threaded replies. The UI's “responder” action creates another
timestamped observation, not a server-side thread. Audit history only includes
events the server emits. No activity or notification is fabricated to fill gaps.

Workspace invitations and member permissions remain in the existing Workspace
Team module, backed by its separate workspace endpoints. This panel does not
change those routes or the Team screen's state handling.
