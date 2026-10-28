package handler

import (
	"context"
	"fmt"
	"time"

	"github.com/swaggest/usecase"

	"github.com/gartner-gpc/pulse-server/cmd/pulse-server/pulse"
	"github.com/gartner-gpc/pulse-server/cmd/pulse-server/response"
	"github.com/gartner-gpc/pulse-server/internal/context/videoconferencing/service"
	"github.com/gartner-gpc/pulse-server/internal/context/videoconferencing/valueobjects"
	httperrors "github.com/gartner-gpc/pulse-server/internal/errors/http"
	"github.com/gartner-gpc/pulse-server/internal/openapi/tags"
	"github.com/gartner-gpc/pulse-server/pkg/errors"
)

type createVideoConferenceHandler struct {
	svc service.VideoConferenceServiceInterface
}

func createVideoConference() usecase.Interactor {
	svc := service.GetVideoConferenceService()
	h := &createVideoConferenceHandler{
		svc: svc,
	}

	u := usecase.NewInteractor(h.createVideoConferenceHandler)

	u.SetTitle("Create Video Conference")
	u.SetDescription("Create a Zoom meeting.")
	u.SetTags(tags.GroupUser)

	return u
}

func (h *createVideoConferenceHandler) createVideoConferenceHandler(
	ctx context.Context,
	input *valueobjects.CreateVideoConferenceRequest,
	output *response.Response[valueobjects.CreateVideoConferenceResponse],
) error {
	c := pulse.GetPulseContext(ctx)

	start, err := parseMeetingTime(input.Start)
	if err != nil {
		c.Logger().Error().
			Err(err).
			Msg("Invalid start time")

		return err
	}

	if start.Before(time.Now().UTC()) {
		err := errors.New("Start time must be in the future")

		c.Logger().Error().
			Err(err).
			Msg("Start time must be in the future")
		return err
	}

	if input.End != "" {
		end, err := parseMeetingTime(input.End)
		if err != nil {
			return err
		}

		if end.Before(start) {
			err := errors.New("End time must be in the future")

			c.Logger().Error().
				Err(err).
				Msg("End time must be in the future")
			return err
		}
	}

	videoConference := &valueobjects.VideoConferenceVo{
		Title: input.Title,
		Start: input.Start,
		End:   input.End,
	}

	if err := h.svc.CreateVideoConference(ctx, videoConference); err != nil {
		c.Logger().Error().Err(err).Msg("failed to create video conference")

		return errors.Join(
			err,
			httperrors.ErrInternalServerError,
		)
	}

	output.Data = valueobjects.CreateVideoConferenceResponse{
		ID:            videoConference.ID,
		MeetingNumber: videoConference.MeetingNumber,
		WebLink:       videoConference.WebLink,
		Password:      videoConference.Password,
		HostKey:       videoConference.HostKey,
	}

	return nil
}

func parseMeetingTime(value string) (time.Time, error) {
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339} {
		parsed, err := time.Parse(layout, value)
		if err == nil {
			return parsed, nil
		}
	}

	return time.Time{}, fmt.Errorf("invalid start time %q", value)
}
