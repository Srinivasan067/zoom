package service

import (
	"context"

	"github.com/gartner-gpc/pulse-server/internal/context/videoconferencing/valueobjects"
)

type VideoConferenceRepositoryInterface interface {
	CreateVideoConference(ctx context.Context, videoConference *valueobjects.VideoConferenceVo) error
}
