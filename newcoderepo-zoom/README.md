# Webex → Zoom: `videoconferencing` (Go) + `zoom` (Next.js)

Zoom versions of `oldcoderepo-pattern/videoconferencing` and `oldcoderepo-pattern/video-meetings`. Same
architecture, file layout, patterns and page flow; only the provider changes.

```
newcoderepo-zoom/
  videoconferencing/        → pulse-server: internal/context/videoconferencing/
  zoom/                     → frontend:     app/zoom/  (sibling of app/video-meetings)
```

## What the Webex code did, and the Zoom equivalent

| Webex | Zoom |
|---|---|
| `POST /api/v1/video/webex/meeting` → Webex `POST /meetings` | `POST /api/v1/video/zoom/meeting` → Zoom `POST /users/{host}/meetings` |
| `POST …/webex/guest-token {displayName}` → Webex guest token | `POST …/zoom/guest-token {meetingNumber, displayName}` → **Meeting SDK signature** (JWT signed in Go with the SDK secret; Zoom signatures are per meeting, hence `meetingNumber`) |
| `POST …/webex/join {meetingId, displayName}` → Webex join link | `POST …/zoom/join {meetingId, displayName}` → the meeting's Zoom `join_url` |
| Static `WEBEX_ACCESS_TOKEN` | Server-to-Server OAuth (cached ~1 h token), or optional static `ZOOM_ACCESS_TOKEN` |
| `WEBEX_HOST_EMAIL`, else `/people/me` | `ZOOM_HOST_EMAIL`, else `/users/me` |
| Meeting `hostKey`; joiners take MODERATOR with it | Host user's `host_key` (`ZOOM_HOST_KEY`, else read from the host user); joiners call `claimHostWithHostKey` |
| Repository: MongoDB `video_conferences`, **save is a TODO (returns nil)** | **Unchanged.** Same repository, same TODO. No DB calls. |
| Page: Create meeting → details in the page URL → Copy link → name → Start meeting / Join Externally / New meeting; Mute / Video / Share / Background / Stop | Same flow and same URL params (`id, meetingNumber, webLink, password, hostKey`). The Zoom SDK draws video, share and its own toolbar inside the stage. |

Response envelope is unchanged: `response.Response[T]` → `{ "data": … }`. Errors are `{ "error": "…" }`.

## Backend: `videoconferencing/`

Copy into `pulse-server/internal/context/videoconferencing/`, replacing the Webex files:

| Delete | Add/replace with |
|---|---|
| `adapter/webex_api_client.go` | `adapter/zoom_api_client.go` |
| `service/webex_api_client_interface.go` | `service/zoom_api_client_interface.go` |
| everything else | the same file names (`routes.go`, handlers, service, valueobjects, repository) |

* Same packages, same imports (`pulse`, `response`, `httperrors`, `tags`, `pkg/errors`, `db`, `services`,
  `github.com/swaggest/usecase`). **No new Go dependencies.**
* Old `*_test.go` files: delete or rename them. They target Webex types. The mocks under `mocks/pulse-server/internalmocks`
  are generated from the interfaces (`VideoConferenceServiceInterface` now has
  `CreateGuestToken(ctx, meetingNumber, displayName)`), so re-run your mock generation.
* The `pulse.Route` paths are now `/api/v1/video/zoom/...`, still `pulse.AuthNone` like the Webex routes.

### Configuration: AWS Secrets Manager → environment variables

No `utils/env.go` changes. The code reads plain environment variables (`os.Getenv`, in `zoomVar()` in
`adapter/zoom_api_client.go`). DevOps stores the values in **AWS Secrets Manager**, and the deployment injects them into the
pulse-server container as environment variables, the same way the existing `WEBEX_CLIENT_*` secrets reach the app.

**Ask DevOps to add these** (same mechanism they use for `WEBEX_CLIENT_ID` / `WEBEX_CLIENT_SECRET` / `WEBEX_CLIENT_TOKEN`):

| Env var name | Required | Value |
|---|---|---|
| `ZOOM_ACCOUNT_ID` | yes | Server-to-Server OAuth app → Account ID |
| `ZOOM_CLIENT_ID` | yes | Server-to-Server OAuth app → Client ID |
| `ZOOM_CLIENT_SECRET` | yes | Server-to-Server OAuth app → Client Secret |
| `ZOOM_SDK_KEY` | yes (in-page join) | General app with Meeting SDK → Client ID |
| `ZOOM_SDK_SECRET` | yes (in-page join) | General app with Meeting SDK → Client Secret |
| `ZOOM_HOST_EMAIL` | optional | Zoom user who owns created meetings. If unset, the user behind the credentials is used. |

Leave these **unset** (only for special cases): `ZOOM_ACCESS_TOKEN` (manual token override), `ZOOM_HOST_KEY` (read
from Zoom automatically), `ZOOM_API_BASE` / `ZOOM_OAUTH_BASE` (test overrides, like `WEBEX_API_BASE`).

Server-to-Server app scopes: create/read meetings and read users (granular: `meeting:write:meeting:admin`,
`meeting:read:meeting:admin`, `user:read:user:admin`).

Check the three Server-to-Server values (prints JSON with `access_token` when they are correct):
`curl -X POST "https://zoom.us/oauth/token?grant_type=account_credentials&account_id=ACCOUNT_ID" -u "CLIENT_ID:CLIENT_SECRET"`

**Token: dynamic, not hard-coded.** Leave `ZOOM_ACCESS_TOKEN` empty. With Account ID + Client ID + Client Secret the
backend fetches a Server-to-Server token itself and refreshes it before it expires (Zoom tokens last 1 hour, so a
hard-coded token would stop working, and it would leak through the public repo).

**You need two sets of Zoom credentials.** Account ID + Client ID + Client Secret come from a *Server-to-Server OAuth*
app and are used to create meetings. The guest-token signature needs the Client ID/Secret of a separate *General app with
Meeting SDK enabled* (`ZOOM_SDK_KEY` / `ZOOM_SDK_SECRET`). With only the first three, `/meeting` and `/join` work, but
`/guest-token` returns "zoom sdk key is not configured".

## Frontend: `zoom/`

Copy the folder next to `video-meetings` (for example `app/zoom/` → URL `/peer-community/zoom`). If you put it elsewhere,
update `url` / `canonicalUrl` in `layout.tsx`.

* It uses only what the Webex page already used: `next`, `react`, `zod`, `clsx`, SCSS modules, and `@/services/profile`,
  `@/util/next`, `@/public/img/og-white-bg.png`.
* The hook lives **inside** the folder (`use-zoom-meeting.ts`). There is no `@/components/hooks/...` file to add.
* **Do not** `npm install @zoom/meetingsdk`: it requires React 18.3.1 and breaks on React 19. `zoom-sdk.ts` loads
  SDK 6.10.0 from Zoom's CDN (`https://source.zoom.us/6.10.0/...`) only when someone presses *Start meeting*.
* API calls go to `/peer-community/nextapi/video/zoom/{meeting,guest-token,join}`, the same convention as the Webex
  `nextapi/video/webex/...` routes. **Add those three proxy routes** by copying your Webex `nextapi` routes, replacing
  `webex` with `zoom`, and forwarding **POST** with the JSON body for all three. Webex's join was a GET redirect; the Zoom
  page POSTs to `/join` and opens the returned link itself.
  To skip the proxy, set `NEXT_PUBLIC_ZOOM_API_BASE=https://<pulse-server>/api/v1/video/zoom` (pulse-server then needs CORS).
* If your app has a Content-Security-Policy, allow `https://source.zoom.us` (scripts) plus Zoom's media/websocket origins.

### Files

| File | Webex counterpart | Notes |
|---|---|---|
| `layout.tsx`, `layout.module.scss`, `meeting-display-name.tsx` | same | Only title/URL text changed |
| `page.tsx`, `page.module.scss` | same | Same flow. The stage hosts the Zoom SDK; controls sit below it so they never cover Zoom's toolbar. |
| `background-picker.tsx`, `virtual-backgrounds.ts` | same | Same presets/upload; applied with Zoom `updateVirtualBackgroundList` + `setVirtualBackground` |
| `use-zoom-meeting.ts` | `@/components/hooks/useWebexMeeting` | join → guest-token → SDK init/join → claim host with hostKey; mute; background; leave/cleanup |
| `zoom-sdk.ts` | `webex-meetings.d.ts` (+ Webex SDK) | CDN loader + typings for the Component View API used |
| `zoom-api.ts` | inline fetch + zod in `page.tsx` | Typed calls to the 3 routes, same `{data}` / `{error}` parsing |

### Zoom vs Webex behaviour differences

* **Camera on/off and screen share** are started from **Zoom's own toolbar** inside the stage. Zoom's Component View has no
  API for them, so our bar shows the video state but has no Video/Share buttons. Users also click Zoom's **Join Audio**
  once; after that, our **Mute** works.
* **Virtual backgrounds** use Zoom's native segmentation. Whether Zoom accepts the generated (data URL) or uploaded (blob URL)
  images still needs to be confirmed in a real meeting. Errors are shown as a notice.
* As with Webex, the **host key is in the shareable link**, so anyone with the link can become host (POC behaviour).

## What was verified (offline, no network calls)

| Check | Result |
|---|---|
| Their **original Webex code** compiles against the stand-in packages (`GOPROXY=off`) | ✅, which shows the stand-ins match the real APIs |
| Zoom `videoconferencing`: `go build`, `go vet`, `gofmt` | ✅ |
| Go logic tests against an in-process fake Zoom server | ✅ field mapping, start/end → duration, host key (env and lookup), OAuth token caching, `/users/me` fallback, signature HMAC + payload, join link, 404 path, handler validation and `ErrInternalServerError` wrapping |
| Zoom `zoom/` folder type-check (strict + `noUncheckedIndexedAccess`) with the real zod/clsx and React 19 types | ✅ |
| Page in Chrome with the 3 routes mocked and **all external requests blocked** | ✅ greeting; Create meeting → `/meeting` body + URL params; Copy link URL restores the meeting; Join Externally → `/join` + opens link; Start meeting → `/guest-token` → SDK load (blocked) → error + retry; invalid link; backend `{error}` shown |
| Real Zoom meeting, real pulse-server, real Next.js build | ❌ Not done (no credentials, no network by request). Next.js was replaced by a stand-in for the three navigation APIs the page uses (`useRouter().replace`, `useSearchParams`, `usePathname`), which are called exactly as in the Webex page. |
