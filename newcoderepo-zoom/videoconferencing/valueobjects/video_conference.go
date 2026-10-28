package valueobjects

// VideoConferenceVo keeps the exact shape used for Webex so the frontend and the
// repository did not have to change. For Zoom:
//   - ID / MeetingNumber: the Zoom meeting ID (digits), both set
//   - WebLink: Zoom join_url (includes the encrypted passcode)
//   - Password: meeting passcode (the Meeting SDK join needs it)
//   - HostKey: host key of the Zoom host user; joiners use it with
//     claimHostWithHostKey() (the Webex MODERATOR + hostKey equivalent)
type VideoConferenceVo struct {
	ID            string `json:"id"`
	MeetingNumber string `json:"meetingNumber"`
	WebLink       string `json:"webLink"`
	Password      string `json:"password"`
	HostKey       string `json:"hostKey"`
	Title         string `json:"title"`
	Start         string `json:"start"`
	End           string `json:"end"`
}

type CreateVideoConferenceRequest struct {
	Title string `json:"title"`
	Start string `json:"start"`
	End   string `json:"end"`
}

type CreateVideoConferenceResponse struct {
	ID            string `json:"id"`
	MeetingNumber string `json:"meetingNumber"`
	WebLink       string `json:"webLink"`
	Password      string `json:"password"`
	HostKey       string `json:"hostKey"`
}
