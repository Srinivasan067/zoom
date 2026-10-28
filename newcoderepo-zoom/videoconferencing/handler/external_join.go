package handler

import (
	"context"
	"strings"

	"github.com/swaggest/usecase"

	"github.com/gartner-gpc/pulse-server/cmd/pulse-server/pulse"
	"github.com/gartner-gpc/pulse-server/cmd/pulse-server/response"
	"github.com/gartner-gpc/pulse-server/internal/context/videoconferencing/adapter"
	httperrors "github.com/gartner-gpc/pulse-server/internal/errors/http"
	"github.com/gartner-gpc/pulse-server/internal/openapi/tags"
	"github.com/gartner-gpc/pulse-server/pkg/errors"
)

type externalJoinRequest struct {
	MeetingID   string `json:"meetingId"`
	DisplayName string `json:"displayName"`
}

type externalJoinResponse struct {
	JoinLink string `json:"joinLink"`
}

type externalJoinLinks interface {
	CreateExternalJoinLink(ctx context.Context, meetingID, displayName string) (string, error)
}

type externalJoinHandler struct {
	zoom externalJoinLinks
}

func createExternalJoinLink() usecase.Interactor {
	h := &externalJoinHandler{zoom: adapter.GetZoomApiClient()}

	u := usecase.NewInteractor(h.createExternalJoinLink)

	u.SetTitle("Create External Join Link")
	u.SetDescription("Create a Zoom link for joining a meeting outside the page.")
	u.SetTags(tags.GroupUser)

	return u
}

func (h *externalJoinHandler) createExternalJoinLink(
	ctx context.Context,
	input *externalJoinRequest,
	output *response.Response[externalJoinResponse],
) error {
	c := pulse.GetPulseContext(ctx)

	meetingID := normalizeMeetingID(input.MeetingID)
	if !validExternalMeetingID(meetingID) {
		err := errors.New("meeting id is not valid")

		c.Logger().Error().Err(err).Msg("meeting id is not valid")
		return err
	}

	displayName := strings.TrimSpace(input.DisplayName)
	if len(displayName) > 128 {
		err := errors.New("display name is too long")

		c.Logger().Error().Err(err).Msg("display name is too long")
		return err
	}

	joinLink, err := h.zoom.CreateExternalJoinLink(ctx, meetingID, displayName)
	if err != nil {
		c.Logger().Error().Err(err).Msg("failed to create external join link")

		return errors.Join(
			err,
			httperrors.ErrInternalServerError,
		)
	}

	output.Data = externalJoinResponse{JoinLink: joinLink}

	return nil
}

// normalizeMeetingID strips the spaces/dashes Zoom shows in meeting IDs ("123 4567 8901").
func normalizeMeetingID(value string) string {
	return strings.NewReplacer(" ", "", "-", "").Replace(strings.TrimSpace(value))
}

// validExternalMeetingID: Zoom meeting IDs are 9 to 11 digits.
func validExternalMeetingID(meetingID string) bool {
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
