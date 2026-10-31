# Accounts & Sign-in

WhereWeWere has password sign-in with separate accounts. Each account's journal (check-ins, notes, mood, sleep, music, tracks, lists, stats, settings and integrations) is private to it: nobody else can see or change it, administrators included. The venue catalog is shared, like Foursquare's: everyone can find and edit venues, but who checked in where stays private.

There is no self sign-up and no email. An administrator creates accounts and resets passwords.

## First sign-in

A new install has one administrator account named `default`, with no usable password. Set one from the server:

```bash
# Docker Compose
docker compose exec server node dist/server/src/scripts/set-password.js default --generate

# Development
npm run user:set-password --workspace=server -- default --generate
```

It prints a temporary password. Sign in with it, choose your own password, and rename the account under **Settings → Account** if you like.

An install that predates accounts keeps its existing user (and all of its data) as the administrator; set its password the same way, using its username.

## Signing in

Sign in with your username and password. Usernames are not case-sensitive (`Zach` and `zach` are the same account).

- **Remember me** checked: you stay signed in on that device for 30 days, and every visit extends that (30 days *since you last used it*).
- **Remember me** unchecked: the session ends when the browser is closed, or after 12 hours without activity, whichever comes first.

Repeated failed attempts are throttled for a while. A disabled account can't sign in.

Forgot your password? Ask an administrator to reset it (below). If you are the only administrator, see [Recovery](#recovery-when-no-admin-can-sign-in).

### Signing out

Use **Sign out** in the menu under your name (top right), or in **Settings → Account**. Signing out (or being signed out because the session expired or was revoked) also wipes what this browser cached of your data: the offline copy of recent API responses, unsaved drafts (e.g. notes), and similar local data. Only device preferences that hold nothing personal are kept: the theme and background choices.

## Passwords

- At least 8 characters (up to 256). Long passphrases are welcome.
- Change yours in **Settings → Account → Password**. Changing it signs out all your other devices.
- **Temporary passwords**: a password set by an administrator (new account or reset) or by the recovery command must be replaced at the next sign-in. Until then the app shows only the "Choose a new password" screen.

## Usernames

- 3–30 characters: letters, numbers, `_`, `.` and `-`.
- Case-insensitive and unique: you can't have both `Sam` and `sam`.
- You can change your own username and display name in **Settings → Account**. The display name (optional) is what the app shows; it falls back to the username.

## Signed-in devices

**Settings → Account → Signed-in devices** lists every browser signed in to your account, with when it was last active and whether it is remembered. You can:

- sign out any other device;
- **Sign out everywhere**, which ends every session including the current one.

Changing your password also signs out every other device. An administrator resetting your password or disabling your account signs you out everywhere.

## Managing users (administrators)

Administrators get a **Settings → Users** tab:

- **List** every account with its display name, admin / disabled / must-change-password state, and when it was last seen.
- **Add a user**: username, optional display name, and a temporary password (use **Generate** and the copy button, then hand it over). Tick **Administrator** to let them manage users too. They choose their own password at first sign-in.
- **Reset password**: sets a new temporary password, signs the user out everywhere, and makes them choose a new one at next sign-in.
- **Make admin / Remove admin**.
- **Disable / Enable**: a disabled user is signed out and can't sign in; all of their data is kept. This is the non-destructive option.
- **Delete**: permanently deletes the account **and all of its data**. You must type the username to confirm. It cannot be undone (restore from that user's own backup if needed). Venues they added to the shared catalog are kept.

Your own row has no actions: manage your own account in **Settings → Account**. Administrators can't see other users' journals; the Users tab only manages accounts.

## Webhook URLs

Inbound webhooks (Sleep as Android, Plex) use per-user secret URLs of the form

```
https://<your-host>/api/v1/webhook/<name>/<secret>
```

The secret identifies whose journal the data goes into. Each user finds their own full URLs in the Sleep and Media settings tabs. The older URLs without a secret no longer work: update them in Sleep as Android and Plex.

If a URL leaks, use **Settings → Account → Webhook URLs secret → Regenerate**. The old URLs stop working immediately, so paste the new ones into Sleep as Android and Plex afterwards.

The music scrobbler (multi-scrobbler) uses a per-user key instead; see [Music](music.md).

## Recovery when no admin can sign in

From the server, set a new temporary password for any account (the username is not case-sensitive):

```bash
# Docker Compose: prints a generated temporary password
docker compose exec server node dist/server/src/scripts/set-password.js <username> --generate

# Development (prompts for the password; add --generate to generate one)
npm run user:set-password --workspace=server -- <username>
```

The user is signed out everywhere and must choose a new password at the next sign-in (add `--keep` to skip that). The command doesn't change admin status: run it for an administrator's username.
