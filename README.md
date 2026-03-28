# WhereWeWere

*WhereWeWere* is a Web application for mindfully journaling our presence in meaningful locations.

## Motivation

I've been using Foursquare Swarm since ~2010, and it's starting to scare me how much data third parties have on me. That fear remains even though I've allowed those parties to have that data.

I've begun a technological exodus, leaving third-party applications behind in exchange for self-hosted apps. This not always be the most economical choice, especially with hard drive prices skyrocketing, but it feels safer and more educational.s

On March 27, 2026, I purchased one month of Claude Code Pro in an attempt to vibe code a Swarm replacement. This repository is the result of that initial experiment.

## TODO as of 2026-03-27
### P1
- Import Swarm checkin feature:
    ```
    I want to import my previous checkins from Swarm. I downloaded my checkin data and it was saved across nine different CSV files. I have attached truncated versions of all nine checkin CSV files. Please implement a Swarm CSV to WhereWeWere import function, allowing me to upload all nine `checkins*.csv` files at the same time for batch import.
    ```
- Reorganize app into new pages:
    1. Home
        - Shows an infinitely-scrollable feed of recent checkins
        - Has a search field at the top, letting me filter checkins by venue name or note content from within the same text field, and lets me filter by checkins created between a date range ("before" or "after" fields are both optional) 
        - Lets me press a Floating Action Button to add a new checkin
    2. Profile
        - Shows me stats:
            - Number of checkins
            - Number of unique venues
            - Number of active days
            - Current active day streak
            - All-time best active day streak
            - Top venues by venue category
            - Top venues by venue name
            - A GitHub-like heatmap of yearly activity
            - Checkins per country
            - A map showing me all of my checkins. Tapping on a location pin lets me see how many times and when I've checked in to that place. Location pins are coded by color like a heatmap: of all the currently-visible location pins, red pins are checked into most within the visible area, and green pins are checked into least within the visible area
        3. Settings
            - Lets me change my username and password
            - Lets me import Swarm CSV data
            - Lets me specify my Dawarich URL and API key
            - Lets me specify my Immich URL and API key
- UI/UX improvements
    - On Docs page, code blocks show up as white text with a white highlighted background
    - Remove Leaflet text/link on embedded maps
    - "Stats" page > "Top Venues" is missing label text
    - "Stats" page > "Categories" is missing label text

### P2
- Installable PWA support

### P3
- Figure out if it's possible to recreate Swarm's feature where it suggests checkins if I'm in a particular place for long enough
- If user has specified a Dawarich URL and API key, allow user to press a button in Settings to export checkin data to Dawarich Places
- Immich integration:
    - Click a button which links to Immich to see all photos taken near this checkin's location
    - Click a button which links to Immich to see all photos taken at around the time of the checkin (say, plus three hours and minus one hour)