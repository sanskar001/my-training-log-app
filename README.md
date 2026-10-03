# Athlete Log V1

Simple static athlete journal for GitHub Pages.

## Files

- `index.html` — UI
- `styles.css` — responsive styling and animations
- `app.js` — GitHub API, validation, save/verify, filtering and download

## Setup

1. Put these files in the **public** `my-training-log-app` repository.
2. Keep `my-training-log-data` **private**.
3. Create a fine-grained PAT that has access only to `my-training-log-data` with `Contents: Read and write`.
4. Open the GitHub Pages URL and paste the token into the connection screen.

## Security note

The token is intentionally not hard-coded or stored in the repository. It is held in JavaScript memory for the current page session.

Because this is a static browser application, the token is still available to the page while the app is open. Use a narrowly scoped fine-grained token and never commit it to GitHub. For a stronger security model later, replace browser-held PAT authentication with OAuth/server-side authentication.

## Data

The app stores one JSON file:

`data/athlete.json`

The app reads the latest file, merges/replaces the selected week, writes it back using the GitHub Contents API, then reads it again and compares the saved week before showing success.
