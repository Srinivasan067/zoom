package handler

import (
	"net/http"

	"github.com/gartner-gpc/pulse-server/cmd/pulse-server/pulse"
)

func GetRoutes() []pulse.Route {
	return []pulse.Route{
		{
			Name:    "Create Video Conference",
			Method:  http.MethodPost,
			Pattern: "/api/v1/video/zoom/meeting",
			UseCase: createVideoConference(),
			Auth:    pulse.AuthNone,
		},
		{
			Name:    "Create Guest Token",
			Method:  http.MethodPost,
			Pattern: "/api/v1/video/zoom/guest-token",
			UseCase: createGuestToken(),
			Auth:    pulse.AuthNone,
		},
		{
			Name:    "Create External Join Link",
			Method:  http.MethodPost,
			Pattern: "/api/v1/video/zoom/join",
			UseCase: createExternalJoinLink(),
			Auth:    pulse.AuthNone,
		},
	}
}
