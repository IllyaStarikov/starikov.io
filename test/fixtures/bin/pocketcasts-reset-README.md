# pocketcasts-reset

Unfollow **every** podcast in your [Pocket Casts](https://pocketcasts.com)
account in one go, so you can start fresh.

Pocket Casts has no built-in "remove all" button and no bulk-unsubscribe in the
UI — you normally have to open each podcast and unfollow it one at a time. This
script does it for you via the (unofficial) Pocket Casts JSON API.

## Requirements

- Python 3.9+ (standard library only — nothing to `pip install`)

## Usage

First, do a **dry run** to see exactly what would be removed. This only logs in
and lists your subscriptions; it changes nothing:

```bash
python3 pocketcasts_reset.py --dry-run
```

When you're ready, run it for real. You'll be asked to type the exact number of
subscriptions to confirm before anything is removed:

```bash
python3 pocketcasts_reset.py
```

### Credentials

Your account email and password are read from environment variables if set,
otherwise you're prompted interactively (the password prompt is hidden):

```bash
export POCKETCASTS_EMAIL="you@example.com"
export POCKETCASTS_PASSWORD="..."
python3 pocketcasts_reset.py --dry-run
```

Credentials and tokens are never written to disk or logged.

### Options

| Flag | Description |
| ---- | ----------- |
| `--dry-run` | List what would be unfollowed and exit. Changes nothing. |
| `--yes` | Skip the confirmation prompt (for automation). |
| `--email EMAIL` | Account email (else `POCKETCASTS_EMAIL`, else prompt). |
| `--delay SECONDS` | Pause between unsubscribe calls (default `0.3`). |

## How it works

It calls three endpoints on `https://api.pocketcasts.com`:

| Step | Request |
| ---- | ------- |
| Log in | `POST /user/login` with `{email, password, scope: "webplayer"}` → bearer token |
| List | `POST /user/podcast/list` with the bearer token → your subscriptions |
| Unfollow | `POST /user/podcast/unsubscribe` with `{uuid}` for each podcast |

## Caveats

- **This API is unofficial** (reverse-engineered from the Pocket Casts web
  player). It is not supported by Pocket Casts and may change or break at any
  time.
- Unfollowing is a bulk action that **cannot be undone in one step** — you can
  re-add podcasts individually afterward, but there's no "undo".
- Use at your own risk.

## License

[MIT](../LICENSE)
