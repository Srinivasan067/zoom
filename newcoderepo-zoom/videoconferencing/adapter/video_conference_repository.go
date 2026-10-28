package adapter

import (
	"context"
	"sync"

	"github.com/gartner-gpc/pulse-server/cmd/pulse-server/db"
	"github.com/gartner-gpc/pulse-server/internal/context/videoconferencing/valueobjects"
	"github.com/gartner-gpc/pulse-server/internal/services"
)

// Unchanged from the Webex version: provider-agnostic, MongoDB collection
// "video_conferences" through the pulse store. Persistence is still not wired
// (same as before); the commented block shows how to enable it.

const (
	collectionVideoConferences = "video_conferences"
)

type VideoConferenceRepository struct {
	store db.StoreInterface
}

type videoConferenceMongoRecord struct {
	MeetingID string `bson:"meeting_id"`
	Title     string `bson:"title"`
}

var (
	videoConferenceRepositoryInstance *VideoConferenceRepository
	videoConferenceRepositoryOnce     sync.Once
)

func GetVideoConferenceRepository() *VideoConferenceRepository {
	videoConferenceRepositoryOnce.Do(func() {
		store, _ := services.GetService[db.StoreInterface]()
		videoConferenceRepositoryInstance = &VideoConferenceRepository{
			store: store,
		}
	})

	return videoConferenceRepositoryInstance
}

func (r *VideoConferenceRepository) CreateVideoConference(ctx context.Context, videoConference *valueobjects.VideoConferenceVo) error {
	// TODO implement

	/**
	defer utils.Timer(time.Now(), utils.MyName())
	c := pulse.GetPulseContext(ctx)

	tx := r.openVideoConferences()
	record := videoConferenceMongoRecord{MeetingID: videoConference.ID, Title: videoConference.Title}
	if err := tx.Insert(record); err != nil {
		c.Logger().Error().Err(err).Msg("unable to save video conference")
		return err
	}

	// Finding a single record:
	// query := pquery.Cond{"meeting_id": meetingID}
	// if err := tx.Find(query).One(&record); err != nil { ... }
	*/

	// Persistence is not wired yet. Returning nil lets the created Zoom meeting reach the caller.
	return nil
}

func (r *VideoConferenceRepository) openVideoConferences() db.ExecutorInterface {
	return r.store.Ex(db.PulseDB, collectionVideoConferences)
}
