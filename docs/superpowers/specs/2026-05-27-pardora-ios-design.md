# Pardora iOS Design

Date: 2026-05-27

## Summary

Pardora is a native iOS companion app for the Stable Audio 3 Lab radio stream. The v1 app is listener/control focused: it plays the active radio stream, shows the current track and queue, captures like/skip/dislike feedback, lets the user select or delete queued tracks, exposes preference memory, and moves server/TTS/prompt-model controls into a dedicated Settings tab.

Pardora will live in this repo under `apps/pardora-ios/` so the Swift app, radio API contract, tests, and docs can evolve together while the radio server is still changing.

## Goals

- Build a real SwiftUI app layout rather than a repackaged mobile web page.
- Keep the Now Playing surface focused on listening and feedback.
- Move configuration controls out of the player into a Settings page.
- Reuse the current Stable Audio radio server as the source of truth.
- Keep v1 narrow enough to implement and verify without broad backend redesign.

## Non-Goals

- No phone-triggered generation in v1.
- No rewrite of `/api/radio` or the Next.js radio page.
- No iCloud sync, user accounts, push notifications, CarPlay, widgets, or watchOS.
- No offline cache of generated tracks beyond normal stream buffering.
- No server-side auth design unless required by deployment before implementation.

## Existing Server Contract

The current radio server already has most of the v1 contract:

- `GET /api/radio` returns `RadioStreamState`, including current track, history, preference memory, stream readiness, stream URLs, playlist URLs, queue-ahead count, and settings.
- `GET /api/radio?stream=1` returns the playable MP3 stream.
- `POST /api/radio` supports `configure`, `selectTrack`, `skipTrack`, `deleteTrack`, and `rating` actions.

The app should treat the server response as authoritative. Local state should only represent transient UI state such as selected tab, playback controls, refresh status, and temporary request errors.

Relevant local source:

- `lib/radio.ts` defines `RadioState`, `RadioStreamState`, `RadioTrackRecord`, style IDs, queue helpers, and stream URL builders.
- `app/api/radio/route.ts` exposes the JSON action API and stream endpoint.
- `app/radio/RadioStationClient.tsx` is the current web implementation to match behavior, not structure.

## Recommended Architecture

Use a native SwiftUI app with a small typed radio API client.

The app should use:

- `TabView` as the app shell.
- One `NavigationStack` per tab for secondary screens.
- `AVPlayer` for native playback of the stream URL.
- A root-owned observable app model for server state, refresh cadence, and shared services.
- A separate playback controller so player state does not mix with JSON fetching.

Apple's current SwiftUI navigation docs describe tab navigation with `TabView` and stack navigation with `NavigationStack`; Apple's AVFoundation docs describe `AVPlayer` as the transport controller for local, remote, and streamed media. Those APIs match Pardora's v1 shape.

## App Structure

Proposed directory layout:

```text
apps/pardora-ios/
  Pardora.xcodeproj/
  Pardora/
    PardoraApp.swift
    AppRootView.swift
    Models/
      RadioModels.swift
      AppSettings.swift
    Services/
      RadioAPIClient.swift
      RadioPlayer.swift
    Features/
      NowPlaying/
      Queue/
      Memory/
      Settings/
    Resources/
  PardoraTests/
```

If an Xcode project proves noisy to scaffold by hand, the first implementation phase may use a Swift package for model/client tests plus an Xcode app project for the runnable target.

## Tabs

### Now

The Now tab is the launch screen and primary listening surface.

It shows:

- App name and selected style.
- Current track title, provenance, queue-ahead count, and stream readiness.
- Native play/pause control backed by `AVPlayer`.
- Track progress when the stream/player can report it.
- Like, Skip, and Dislike controls.
- Request/status messages for failed refreshes or failed control actions.

Behavior:

- Play uses the server-provided `streamUrl` when present, falling back to `lanStreamUrl` if needed.
- Like sends `rating: "up"` for the current track prompt.
- Skip sends the dedicated `skipTrack` action if available.
- Dislike sends `rating: "down"` and relies on the server to reject/advance the current track.
- After each action, refresh the server state and update the player item if the current track changes.

### Queue

The Queue tab shows the selected style's radio lineup.

It supports:

- Current-track highlighting.
- Play/select a queued MP3 track.
- Delete a queued track.
- Visible liked state for liked queued items.
- Pull-to-refresh.

Deletion follows the server's current behavior. Rated tracks keep feedback metadata server-side; unrated tracks may have audio and metadata removed.

### Memory

The Memory tab exposes preference memory without editing it directly in v1.

It shows:

- Likes and dislikes for the selected style.
- Taste-profile sections if the server returns them.
- Empty states per style.

Direct editing of memory is deferred. The v1 feedback path remains Like/Skip/Dislike.

### Settings

Settings contains controls that should not crowd the player.

It supports:

- Radio server origin.
- Selected style.
- Prompt model.
- Announcement enabled toggle.
- TTS provider and voice.
- Announcement prefix and suffix.
- Refresh/test connection.

Settings changes call `configure` and then refresh server state. Local settings should be persisted with `UserDefaults`, but server-returned values win after a successful refresh.

## Data Flow

1. App launches and loads local settings, including server origin.
2. `RadioAPIClient` calls `GET /api/radio`.
3. The root app model stores decoded `RadioStreamState`.
4. Now tab chooses the playable stream URL and configures `RadioPlayer`.
5. User actions call `POST /api/radio`.
6. Successful actions replace the app model with the returned state.
7. Failed actions show a nonblocking error on the relevant tab.

The app should refresh periodically while foregrounded. A five-second cadence matches the current web page. The user can also manually refresh from Queue or Settings.

## Models

Swift models should mirror only the fields the app needs, while tolerating extra JSON fields from the server.

Core model types:

- `RadioStreamState`
- `RadioTrackRecord`
- `RadioPreference`
- `RadioTasteProfile`
- `RadioPlaylistUrls`
- `RadioStyleID`
- `RadioTTSProvider`

Decoding should be resilient:

- Unknown enum values fall back to safe display strings or an `.unknown(String)` case where useful.
- Optional fields remain optional.
- Dates may be kept as strings unless a screen needs date math.

## Error Handling

Use explicit, visible states:

- No server configured.
- Server unavailable.
- Stream not ready.
- Control action failed.
- Decode/schema mismatch.
- Playback failed.

Errors should not block the entire app when stale state is available. Keep the last successful state visible and show the newest error inline.

## Verification Plan

Implementation must verify incrementally:

- Swift model decoding tests with fixture JSON copied from `GET /api/radio`.
- API client tests using mocked `URLProtocol` or an injectable transport.
- Playback controller unit coverage where practical, with manual simulator/device smoke for real stream playback.
- Existing repo gate: `make checkall`.
- iOS build gate once the app target exists, for example `xcodebuild` against the Pardora scheme.
- Simulator smoke for tab navigation and settings layout.

If `make checkall` is unrelated to the iOS project but fails, do not claim the slice is complete; separate the failure and fix or report it.

## Implementation Phases

### Phase 1: App Scaffold and Read-Only State

Create `apps/pardora-ios/`, the Xcode project, core models, API client, app settings, and tab shell. Decode `GET /api/radio` and render read-only Now, Queue, Memory, and Settings screens.

### Phase 2: Native Playback

Add `AVPlayer` stream playback, play/pause UI, stream readiness state, and foreground refresh behavior.

### Phase 3: Control Actions

Wire Like, Skip, Dislike, queue select, queue delete, and Settings configure actions to `POST /api/radio`.

### Phase 4: Polish and Verification

Add previews, accessibility labels, fixture tests, simulator smoke, docs, and the final verification gate.

## V1 Decisions

- The shipped default server origin is `https://radio.pardev.net`, with Settings allowing manual override for LAN or development servers.
- No auth token field is included in v1. Add it only if the server requires auth.
- The first implementation is iPhone-first and should remain usable on iPad through SwiftUI adaptive layout, but no dedicated iPad split-view design is required for v1.

## Sources

- Local: `lib/radio.ts`
- Local: `app/api/radio/route.ts`
- Local: `app/radio/RadioStationClient.tsx`
- Apple Developer Documentation: `TabView` and tab navigation, https://developer.apple.com/documentation/SwiftUI/TabView and https://developer.apple.com/documentation/swiftui/enhancing-your-app-content-with-tab-navigation
- Apple Developer Documentation: `AVPlayer`, https://developer.apple.com/documentation/avfoundation/avplayer
