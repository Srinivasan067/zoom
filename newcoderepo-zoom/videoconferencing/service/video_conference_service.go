package service

import (
	"context"
	"sync"

	"github.com/gartner-gpc/pulse-server/internal/context/videoconferencing/adapter"
	"github.com/gartner-gpc/pulse-server/internal/context/videoconferencing/valueobjects"
)

type VideoConferenceServiceInterface interface {
	CreateVideoConference(ctx context.Context, videoConference *valueobjects.VideoConferenceVo) error
	CreateGuestToken(ctx context.Context, meetingNumber, displayName string) (string, error)
}

var (
	_ VideoConferenceServiceInterface    = &VideoConferenceService{}
	_ VideoConferenceRepositoryInterface = (*adapter.VideoConferenceRepository)(nil)
	_ ZoomApiClientInterface             = (*adapter.ZoomApiClient)(nil)
)

type VideoConferenceService struct {
	repository VideoConferenceRepositoryInterface
	zoom       ZoomApiClientInterface
}

var (
	videoConferenceServiceInstance *VideoConferenceService
	videoConferenceServiceOnce     sync.Once
)

func GetVideoConferenceService() *VideoConferenceService {
	videoConferenceServiceOnce.Do(func() {
		videoConferenceServiceInstance = &VideoConferenceService{
			repository: adapter.GetVideoConferenceRepository(),
			zoom:       adapter.GetZoomApiClient(),
		}
	})

	return videoConferenceServiceInstance
}

func (s *VideoConferenceService) CreateVideoConference(ctx context.Context, videoConference *valueobjects.VideoConferenceVo) error {
	if err := s.zoom.CreateMeeting(ctx, videoConference); err != nil {
		return err
	}

	return s.repository.CreateVideoConference(ctx, videoConference)
}

func (s *VideoConferenceService) CreateGuestToken(ctx context.Context, meetingNumber, displayName string) (string, error) {
	return s.zoom.CreateGuestToken(ctx, meetingNumber, displayName)
}
