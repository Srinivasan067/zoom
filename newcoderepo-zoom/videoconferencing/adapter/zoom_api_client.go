package adapter

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gartner-gpc/pulse-server/internal/context/videoconferencing/valueobjects"
)

// Zoom replacement for webex_api_client.go. Same shape:
//   - CreateMeeting          Webex POST /meetings          -> Zoom POST /users/{host}/meetings
//   - CreateGuestToken       Webex POST /guests/token      -> Zoom Meeting SDK signature (JWT, signed locally)
//   - CreateExternalJoinLink Webex POST /meetings/join     -> Zoom GET /meetings/{id} join_url
//   - host email             WEBEX_HOST_EMAIL | /people/me -> ZOOM_HOST_EMAIL | /users/me
//   - host key               Webex meeting hostKey         -> Zoom user host_key (ZOOM_HOST_KEY | GET /users/{host})
//
// Configuration: environment variables. In AWS they come from Secrets Manager,
// injected into the container by the deployment (same path as the WEBEX_* values).
//
//	ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET  Server-to-Server OAuth app (REST API)
//	ZOOM_SDK_KEY, ZOOM_SDK_SECRET                        General app with Meeting SDK (signatures)
//	ZOOM_HOST_EMAIL                                      optional: meeting owner; falls back to /users/me
//	ZOOM_ACCESS_TOKEN                                    optional, leave unset: OAuth token is fetched + refreshed
//	ZOOM_HOST_KEY                                        optional, leave unset: read from the host user
//	ZOOM_API_BASE, ZOOM_OAUTH_BASE                       optional overrides (tests), like WEBEX_API_BASE

const (
	defaultZoomAPIBase    = "https://api.zoom.us/v2"
	defaultZoomOAuthBase  = "https://zoom.us"
	guestDisplayName      = "GPC Guest"
	defaultMeetingMinutes = 60
	joinBeforeHostMinutes = 15
	signatureTTL          = 2 * time.Hour
	tokenRefreshMargin    = 60 * time.Second
)

// zoomVar is the single place Zoom configuration is read.
func zoomVar(name string) string {
	return strings.TrimSpace(os.Getenv(name))
}

type ZoomApiClient struct {
	httpClient http.Client
	apiBase    string
	oauthBase  string

	tokenMu     sync.Mutex
	accessToken string
	tokenExpiry time.Time
}

var (
	zoomApiClientInstance *ZoomApiClient
	zoomApiClientOnce     sync.Once
)

func GetZoomApiClient() *ZoomApiClient {
	zoomApiClientOnce.Do(func() {
		zoomApiClientInstance = &ZoomApiClient{
			httpClient: http.Client{Timeout: 15 * time.Second},
			apiBase:    zoomAPIBase(),
			oauthBase:  zoomOAuthBase(),
		}
	})

	return zoomApiClientInstance
}

type zoomMeetingSettings struct {
	JoinBeforeHost bool `json:"join_before_host"`
	JbhTime        int  `json:"jbh_time"`
	WaitingRoom    bool `json:"waiting_room"`
	ApprovalType   int  `json:"approval_type"`
	HostVideo      bool `json:"host_video"`
	ParticipantVid bool `json:"participant_video"`
}

type zoomMeetingRequest struct {
	Topic     string              `json:"topic"`
	Type      int                 `json:"type"`
	StartTime string              `json:"start_time"`
	Duration  int                 `json:"duration"`
	Timezone  string              `json:"timezone"`
	Settings  zoomMeetingSettings `json:"settings"`
}

type zoomMeetingResponse struct {
	ID        int64  `json:"id"`
	Topic     string `json:"topic"`
	StartTime string `json:"start_time"`
	Duration  int    `json:"duration"`
	JoinURL   string `json:"join_url"`
	Password  string `json:"password"`
	HostEmail string `json:"host_email"`
	// start_url is deliberately not mapped: it carries the host's ZAK.
}

type zoomUserResponse struct {
	ID      string `json:"id"`
	Email   string `json:"email"`
	HostKey string `json:"host_key"`
}

type zoomTokenResponse struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in"`
}

func (c *ZoomApiClient) CreateMeeting(
	ctx context.Context,
	videoConference *valueobjects.VideoConferenceVo,
) error {
	if videoConference == nil || videoConference.Title == "" || videoConference.Start == "" {
		return fmt.Errorf("title and start are required")
	}

	start, err := parseZoomTime(videoConference.Start)
	if err != nil {
		return err
	}
	duration := defaultMeetingMinutes
	if videoConference.End != "" {
		end, err := parseZoomTime(videoConference.End)
		if err != nil {
			return err
		}
		if minutes := int(end.Sub(start).Minutes()); minutes > 0 {
			duration = minutes
		}
	}

	hostEmail, err := c.hostEmail(ctx)
	if err != nil {
		return err
	}

	requestBody, err := json.Marshal(zoomMeetingRequest{
		Topic:     videoConference.Title,
		Type:      2, // scheduled
		StartTime: start.UTC().Format("2006-01-02T15:04:05Z"),
		Duration:  duration,
		Timezone:  "UTC",
		Settings: zoomMeetingSettings{
			JoinBeforeHost: true, // Webex: enabledJoinBeforeHost
			JbhTime:        joinBeforeHostMinutes,
			WaitingRoom:    false, // Webex: unlockedMeetingJoinSecurity "allowJoin"
			ApprovalType:   2,     // no registration
			HostVideo:      true,
			ParticipantVid: true,
		},
	})
	if err != nil {
		return err
	}

	body, err := c.post(ctx, "/users/"+url.PathEscape(hostEmail)+"/meetings", requestBody)
	if err != nil {
		return err
	}

	var created zoomMeetingResponse
	if err := json.Unmarshal(body, &created); err != nil {
		return err
	}
	if created.ID == 0 {
		return fmt.Errorf("zoom meeting response was empty")
	}

	meetingID := strconv.FormatInt(created.ID, 10)
	videoConference.ID = meetingID
	videoConference.MeetingNumber = meetingID
	videoConference.WebLink = created.JoinURL
	videoConference.Password = created.Password
	videoConference.HostKey = c.hostKey(ctx, hostEmail)
	if created.Topic != "" {
		videoConference.Title = created.Topic
	}
	if created.StartTime != "" {
		videoConference.Start = created.StartTime
	}
	if videoConference.End == "" {
		videoConference.End = start.Add(time.Duration(duration) * time.Minute).UTC().Format(time.RFC3339)
	}

	return nil
}

func (c *ZoomApiClient) CreateExternalJoinLink(ctx context.Context, meetingID, displayName string) (string, error) {
	meetingID = normalizeMeetingNumber(meetingID)
	if !validMeetingID(meetingID) {
		return "", fmt.Errorf("meeting id is not valid")
	}

	meeting, err := c.getMeeting(ctx, meetingID)
	if err != nil {
		return "", err
	}
	if meeting.JoinURL == "" {
		return "", fmt.Errorf("zoom join link response was empty")
	}

	name := strings.TrimSpace(displayName)
	if name == "" {
		name = guestDisplayName
	}

	return withDisplayName(meeting.JoinURL, name), nil
}

func (c *ZoomApiClient) getMeeting(ctx context.Context, meetingID string) (zoomMeetingResponse, error) {
	body, err := c.get(ctx, "/meetings/"+url.PathEscape(meetingID))
	if err != nil {
		return zoomMeetingResponse{}, err
	}

	var meeting zoomMeetingResponse
	if err := json.Unmarshal(body, &meeting); err != nil {
		return zoomMeetingResponse{}, err
	}
	return meeting, nil
}

// CreateGuestToken signs a Zoom Meeting SDK JWT (HS256) with the SDK secret.
// Payload per https://developers.zoom.us/docs/meeting-sdk/auth/ . role 0 =
// attendee; joiners become host with the host key, as with Webex.
func (c *ZoomApiClient) CreateGuestToken(_ context.Context, meetingNumber, _ string) (string, error) {
	sdkKey := zoomVar("ZOOM_SDK_KEY")
	sdkSecret := zoomVar("ZOOM_SDK_SECRET")
	if sdkKey == "" || sdkSecret == "" {
		return "", fmt.Errorf("zoom sdk key is not configured")
	}

	meetingNumber = normalizeMeetingNumber(meetingNumber)
	if !validMeetingID(meetingNumber) {
		return "", fmt.Errorf("meeting number is not valid")
	}
	mn, err := strconv.ParseInt(meetingNumber, 10, 64)
	if err != nil {
		return "", fmt.Errorf("meeting number is not valid")
	}

	iat := time.Now().Add(-30 * time.Second) // small clock-skew allowance, as in Zoom's sample
	exp := iat.Add(signatureTTL)

	header, _ := json.Marshal(map[string]string{"alg": "HS256", "typ": "JWT"})
	payload, err := json.Marshal(map[string]any{
		"appKey":   sdkKey,
		"sdkKey":   sdkKey,
		"mn":       mn,
		"role":     0,
		"iat":      iat.Unix(),
		"exp":      exp.Unix(),
		"tokenExp": exp.Unix(),
	})
	if err != nil {
		return "", err
	}

	enc := base64.RawURLEncoding
	unsigned := enc.EncodeToString(header) + "." + enc.EncodeToString(payload)
	mac := hmac.New(sha256.New, []byte(sdkSecret))
	mac.Write([]byte(unsigned))

	return unsigned + "." + enc.EncodeToString(mac.Sum(nil)), nil
}

// hostEmail mirrors the Webex host email lookup: env first, then the token's own user.
func (c *ZoomApiClient) hostEmail(ctx context.Context) (string, error) {
	if email := zoomVar("ZOOM_HOST_EMAIL"); email != "" {
		return email, nil
	}

	user, err := c.getUser(ctx, "me")
	if err != nil {
		return "", fmt.Errorf("zoom host email is not configured: %w", err)
	}
	if user.Email == "" {
		return "", fmt.Errorf("zoom host email is not configured")
	}
	return user.Email, nil
}

// hostKey is best effort: an empty host key only means joiners cannot claim host.
func (c *ZoomApiClient) hostKey(ctx context.Context, hostEmail string) string {
	if key := zoomVar("ZOOM_HOST_KEY"); key != "" {
		return key
	}
	user, err := c.getUser(ctx, hostEmail)
	if err != nil {
		return ""
	}
	return user.HostKey
}

func (c *ZoomApiClient) getUser(ctx context.Context, userID string) (zoomUserResponse, error) {
	body, err := c.get(ctx, "/users/"+url.PathEscape(userID))
	if err != nil {
		return zoomUserResponse{}, err
	}

	var user zoomUserResponse
	if err := json.Unmarshal(body, &user); err != nil {
		return zoomUserResponse{}, err
	}
	return user, nil
}

func (c *ZoomApiClient) post(ctx context.Context, path string, payload []byte) ([]byte, error) {
	bearer, err := c.zoomBearer(ctx)
	if err != nil {
		return nil, err
	}
	return c.send(ctx, http.MethodPost, c.endpoint(path), "Bearer "+bearer, payload)
}

func (c *ZoomApiClient) get(ctx context.Context, path string) ([]byte, error) {
	bearer, err := c.zoomBearer(ctx)
	if err != nil {
		return nil, err
	}
	return c.send(ctx, http.MethodGet, c.endpoint(path), "Bearer "+bearer, nil)
}

// zoomBearer returns ZOOM_ACCESS_TOKEN when set (like WEBEX_ACCESS_TOKEN), otherwise
// a cached Server-to-Server OAuth token (account_credentials grant, ~1 hour).
func (c *ZoomApiClient) zoomBearer(ctx context.Context) (string, error) {
	if static := zoomVar("ZOOM_ACCESS_TOKEN"); static != "" {
		return static, nil
	}

	accountID := zoomVar("ZOOM_ACCOUNT_ID")
	clientID := zoomVar("ZOOM_CLIENT_ID")
	clientSecret := zoomVar("ZOOM_CLIENT_SECRET")
	if accountID == "" || clientID == "" || clientSecret == "" {
		return "", fmt.Errorf("zoom access token is not configured")
	}

	c.tokenMu.Lock()
	defer c.tokenMu.Unlock()
	if c.accessToken != "" && time.Now().Before(c.tokenExpiry.Add(-tokenRefreshMargin)) {
		return c.accessToken, nil
	}

	query := url.Values{"grant_type": {"account_credentials"}, "account_id": {accountID}}
	basic := base64.StdEncoding.EncodeToString([]byte(clientID + ":" + clientSecret))
	endpoint := strings.TrimRight(c.oauthBase, "/") + "/oauth/token?" + query.Encode()

	body, err := c.send(ctx, http.MethodPost, endpoint, "Basic "+basic, nil)
	if err != nil {
		return "", err
	}

	var token zoomTokenResponse
	if err := json.Unmarshal(body, &token); err != nil {
		return "", err
	}
	if token.AccessToken == "" {
		return "", fmt.Errorf("zoom access token response was empty")
	}

	c.accessToken = token.AccessToken
	c.tokenExpiry = time.Now().Add(time.Duration(token.ExpiresIn) * time.Second)
	return c.accessToken, nil
}

func (c *ZoomApiClient) send(ctx context.Context, method, endpoint, authorization string, payload []byte) ([]byte, error) {
	var reader io.Reader
	if len(payload) > 0 {
		reader = bytes.NewReader(payload)
	}

	req, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", authorization)
	req.Header.Set("Accept", "application/json")
	if len(payload) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}

	if resp.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf(
			"zoom returned status %d: %s",
			resp.StatusCode,
			truncate(string(body), 512),
		)
	}

	return body, nil
}

func (c *ZoomApiClient) endpoint(path string) string {
	base := strings.TrimRight(c.apiBase, "/")
	if base == "" {
		base = defaultZoomAPIBase
	}
	return base + path
}

func zoomAPIBase() string {
	if base := strings.TrimSpace(os.Getenv("ZOOM_API_BASE")); base != "" {
		return base
	}
	return defaultZoomAPIBase
}

func zoomOAuthBase() string {
	if base := strings.TrimSpace(os.Getenv("ZOOM_OAUTH_BASE")); base != "" {
		return base
	}
	return defaultZoomOAuthBase
}

func parseZoomTime(value string) (time.Time, error) {
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339} {
		parsed, err := time.Parse(layout, value)
		if err == nil {
			return parsed, nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid start time %q", value)
}

// normalizeMeetingNumber strips the spaces/dashes Zoom shows in meeting IDs.
func normalizeMeetingNumber(value string) string {
	return strings.NewReplacer(" ", "", "-", "").Replace(strings.TrimSpace(value))
}

// validMeetingID: Zoom meeting IDs are 9 to 11 digits.
func validMeetingID(meetingID string) bool {
	if len(meetingID) < 9 || len(meetingID) > 11 {
		return false
	}
	for _, r := range meetingID {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// withDisplayName adds the "uname" hint Zoom's web client uses to prefill the
// participant name. Clients that do not support it simply ignore it.
func withDisplayName(joinURL, displayName string) string {
	parsed, err := url.Parse(joinURL)
	if err != nil {
		return joinURL
	}
	query := parsed.Query()
	query.Set("uname", displayName)
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func truncate(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}
