package service

import (
	"context"

	"github.com/gartner-gpc/pulse-server/internal/context/videoconferencing/valueobjects"
)

// ZoomApiClientInterface replaces WebexApiClientInterface.
type ZoomApiClientInterface interface {
	CreateMeeting(ctx context.Context, videoConference *valueobjects.VideoConferenceVo) error
	// CreateGuestToken returns a Zoom Meeting SDK signature (JWT). Unlike the
	// Webex guest token, a Zoom signature is bound to one meeting number.
	CreateGuestToken(ctx context.Context, meetingNumber, displayName string) (string, error)
}
