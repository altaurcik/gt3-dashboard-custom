export const event = Object.freeze({
  name: "Portimão", season: "2026", profile: "SRO", namespace: "RAC_PROD",
  meetingId: "f7ed3638-c61a-4e0a-b7c4-1b0e90a4e620",
  competitionId: "33dbb86b-471c-486f-844f-491e3407f26e",
  raceId: "7ab0947f-e429-4b00-9f58-cbc78e143fdc",
  qualifyingId: "d9a0680a-07db-4dd4-9e41-a47d1cd4fc2a",
  start: "2026-10-17T16:00:00Z", durationSeconds: 10800,
  timeZone: "Europe/Lisbon", favorite: "3", trackLength: 4653,
  sourceBase: "https://ps-cache.web.swisstiming.com/node/db/RAC_PROD/",
  officialUrl: "https://www.gt-world-challenge-europe.com/watch-live",
  eventUrl: "https://www.gt-world-challenge-europe.com/event/255/portimao",
  resultsUrl: "https://www.gt-world-challenge-europe.com/results?filter_meeting_id=255",
  youtubeId: "uAR3tUAxdDw",
});

export function channel(kind, id) {
  return `SRO_${event.season}_${kind}_${id}_JSON`.toUpperCase();
}
