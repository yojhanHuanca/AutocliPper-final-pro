# Private source playback

`GET /v1/uploads/{id}/source-playback` issues a short-lived URL for previewing an uploaded source in the Editor. The caller must have the `editor` permission on the upload's active project, and the upload must be confirmed. Project authorization also rejects deleted projects. Pending, aborted, missing, or mismatched source objects do not receive playback URLs.

Project verifies the upload's canonical workspace object key and checks the stored object's size, ETag, and content type before signing a `GetObject` request. The response contains only the URL, its 120-second lifetime, video content type, byte count, and SHA-256; it omits storage object keys, ETags, and storage credentials. The object remains in the private bucket. The signed response overrides disposition to `inline` and cache control to `private, no-store`.

The signed URL is a bearer capability. Keep it in memory, do not log it, persist it, or place it in a referrer. It expires after 120 seconds; request a fresh URL from the authenticated endpoint when needed. The signature does not bind a `Range` header, so the browser can issue normal `Range: bytes=…` requests directly to storage for seeking. Storage responds with `206 Partial Content` and `Content-Range` for satisfiable ranges.

The storage bootstrap configures the frontend origin for `GET`/`HEAD`, permits `Range`, and exposes `Accept-Ranges`, `Content-Range`, and `Content-Length`. Existing buckets need that CORS configuration applied through the storage bootstrap before cross-origin browser playback. No live storage configuration was changed while implementing this endpoint.

The local unit test uses only a loopback HTTP fixture and fake S3 credentials. The acceptance test additionally covers an uploaded fixture, project authorization, a real storage `Range` response, the short TTL, and access denial after project deletion when run against the isolated local stack.
