package handler

import (
	"context"
	"strings"

	"github.com/swaggest/usecase"

	"github.com/gartner-gpc/pulse-server/cmd/pulse-server/pulse"
	"github.com/gartner-gpc/pulse-server/cmd/pulse-server/response"
	"github.com/gartner-gpc/pulse-server/internal/context/videoconferencing/service"
	httperrors "github.com/gartner-gpc/pulse-server/internal/errors/http"
	"github.com/gartner-gpc/pulse-server/internal/openapi/tags"
	"github.com/gartner-gpc/pulse-server/pkg/errors"
)

// Zoom signatures are bound to a meeting, so the request also carries the
// meeting number (Webex guest tokens only needed the display name).
type createGuestTokenRequest struct {
	MeetingNumber string `json:"meetingNumber"`
	DisplayName   string `json:"displayName"`
}

// Signature is the Zoom Meeting SDK JWT passed to client.join({ signature }).
type createGuestTokenResponse struct {
	Signature string `json:"signature"`
}

type createGuestTokenHandler struct {
	svc service.VideoConferenceServiceInterface
}

func createGuestToken() usecase.Interactor {
	svc := service.GetVideoConferenceService()

	h := &createGuestTokenHandler{
		svc: svc,
	}

	u := usecase.NewInteractor(h.createGuestTokenHandler)

	u.SetTitle("Create Guest Token")
	u.SetDescription("Create a Zoom Meeting SDK signature for the embedded meeting.")
	u.SetTags(tags.GroupUser)

	return u
}

func (h *createGuestTokenHandler) createGuestTokenHandler(
	ctx context.Context,
	input *createGuestTokenRequest,
	output *response.Response[createGuestTokenResponse],
) error {
	c := pulse.GetPulseContext(ctx)

	meetingNumber := normalizeMeetingID(input.MeetingNumber)
	if !validExternalMeetingID(meetingNumber) {
		err := errors.New("meeting number is not valid")

		c.Logger().Error().Err(err).Msg("meeting number is not valid")
		return err
	}

	signature, err := h.svc.CreateGuestToken(ctx, meetingNumber, strings.TrimSpace(input.DisplayName))
	if err != nil {
		c.Logger().Error().Err(err).Msg("failed to create guest token")

		return errors.Join(
			err,
			httperrors.ErrInternalServerError,
		)
	}

	output.Data = createGuestTokenResponse{
		Signature: signature,
	}

	return nil
}
