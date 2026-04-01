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

## TODO as of 2026-04-01
### First Task
I want to be able to import `.daylio` Daylio export files instead of the less-functional Daylio `.csv` exports. Please remove all Daylio CSV importing functionality and replace it with `.daylio` importing functionality. `.daylio` files are ZIP files whose decompressed root contains a `backup.daylio` file, which is a base64-encoded JSON file. I have attached an example decoded `backup.daylio` as `backup.daylio.example.json`. You can ignore values associated with the keys "reminders", "writingTemplates", "milestones", "scales", and other key/value pairs that are not relevant to WhereWeWere. Note that the "id_tag_group" key/value pair within the "tags" array corresponds to the IDs within the objects comprising the "tag_groups" array.

### Second Task
- Add "Places" / "Moods" tabs to the Profile page
- **Moods tab** requires:
  - New server-side mood stats endpoints (daily avg mood, mood span, monthly mood breakdown, day-of-week avg mood, activity-mood correlations, year-in-pixels heatmap data)
  - Line chart: avg mood per day over 1 or 3 months (X-axis = days, Y-axis = mood 1-5)
  - Span chart: min/max mood range per day over 1 or 3 months (switchable with line chart)
  - Mood count summary for the visible date range
  - Monthly mood pie chart (count of each of the 5 moods)
  - Count of each mood per month (numeric display)
  - Day-of-week average mood bar chart
  - Activity-mood correlations table/chart
  - "Year in Pixels" chart: avg mood per day, based on existing `Heatmap` component pattern with mood-color squares

Please also help me delete old Mood entries from the database and start completely fresh.