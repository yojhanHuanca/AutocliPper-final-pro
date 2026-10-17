# Creator workflow: current contract limits

This note describes what the frontend can verify in the current gateway contract. It is a product and implementation reference, not a promise of future behavior.

## Projects and access

- The project list requests at most 100 items per workspace and supports name search. The current screen does not paginate beyond that result set.
- Creating a project requires a workspace and an `owner`, `admin`, or `editor` role. Readers can inspect project content where the API allows it, but cannot upload, process, or create editor drafts.
- The projects API has no global upload list. A creator must resume a source by entering its upload ID; the server still has to confirm that the source belongs to the open project.

## Video upload and inspection

- The current client accepts MP4, WebM, MOV, and MKV files up to 100 MiB. It uses a signed PUT upload. Although the contract also describes multipart uploads, this client does not implement resumable multipart transfer.
- SHA-256 is calculated with Web Crypto from `File.arrayBuffer()`, which holds a file-sized buffer in memory. The browser API used here does not provide incremental digest progress. The UI reports transfer stages, not a fabricated byte percentage.
- Transfer cancellation becomes available after the upload intent exists. The digest phase before intent creation cannot be interrupted by the current browser API. If cancellation cleanup cannot be confirmed, the UI keeps the upload ID so its state can be checked.
- Inspection returns measured metadata and status, not a source-video preview. The interval must be selected manually. When the API omits measured duration, the UI shows the local 300-second limit and the server remains authoritative.

## Processing and editor drafts

- Processing uses the manually selected interval and can return MP4, SRT, and VTT artifacts after success. The frontend does not claim that the service automatically finds highlights.
- `PipelineStatusDto` contains processing state and output identifiers but no source `uploadId`. A pipeline started in the current view can be linked to that source in memory; after reload or manual ID lookup, its relationship cannot be verified, so the transcript is not silently attached to a draft.
- Creating an `EditorDraftDto` is a separate action from rendering a pipeline output. The draft opens in the editor with the selected interval and format; subtitles are included only when the current view can verify the completed pipeline link.
