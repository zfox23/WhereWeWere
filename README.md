# WhereWeWere

*WhereWeWere* is a Web application for mindfully journaling our presence as we move through life.

## Integrations

WhereWeWere integrates with:

- Immich, to show photos relevant to a check-in's location and time.
- Maloja, to show musical scrobbles relevant to a check-in's time.
- Dawarich, to show specific location history data associated with a given day or time around a checkin.

## Motivation

I've been using Foursquare Swarm, Last.fm, Google Location History, Google Photos, and other similar services since ~2010, and it's starting to scare me how much data third parties have on me. That fear remains even though I've allowed those parties to have that data.

I've begun a technological exodus, leaving third-party applications behind in exchange for self-hosted apps. This not always be the most economical choice, especially with hard drive prices skyrocketing, but it feels safer and more educational.

On March 27, 2026, I purchased one month of Claude Code Pro in an attempt to vibe code a Swarm replacement. I also want to integrate data from other systems I've used for the past several years. This repository is the result of that experiment.

## TODO as of 2026-03-30
- If the user has set up Dawarich integration in Settings, show all dates on the homepage timeline, even if there are no checkins for that day. Then, let the user click on the text corresponding to any day's timestamp to see the user's location history on that day on Dawarich.  Similarly, if the user clicks on a timestamp associated with the checkin, they should be sent to Dawarich to see their timeline two hours before and two hours after that checkin. An example link to Dawarich for seeing the map associated with all of March 23, 2026 is `https://map.home.mydomain.io/map/v2?start_at=2026-03-23T00%253A00&end_at=2026-03-23T23%253A59`.
- Create a new route which, given a checkin ID, displays a single checkin and its associated data. Add a new "link" icon next to the Edit button which links to that specific checkin's page.
- Remove the "delete" button on the main checkin card, instead relocating the delete functionality to the checkin's edit page.
- Begin searching for nearby locations as soon as the user first navigates to the webapp. The goal here is to speed up the location search on the `/check-in` page. If the user has moved "significantly" between first navigating to the webapp and navigating to `check-in`, re-search for nearby locations.
- There seems to be a bug on the checkin page where all of the locations are disabled and unclickable. Perhaps this has to do with the `disabled={importing === venue.osm_id}` logic in `VenueSearch.tsx`. Please fix this bug.
- I don't want scrobbles to repeat when I'm looking at multiple checkin cards at the same time. For example, right now, I'm seeing the same song associated with two checkins made within ten minutes, when I only want to see the scrobble closest in time to one of those checkins. Help me come up with some logic for choosing which scrobbles to show so that it's more likely a scrobble will be associated with one and only one given checkin. This logic does not apply if I'm looking at only a single checkin.
- There are a few contrast issues with dark mode - please do a full pass on colors to make sure that text and icons still show up cleanly while in dark mode.
- I'm still having a problem where a previously-started job is uncancellable. I'm fairly confident the logic is fixed for future jobs, but I need to force-cancel the most recent job. Please tell me how to do that from the command line.