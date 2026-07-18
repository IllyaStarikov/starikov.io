# bin

A small collection of standalone utility scripts — the one-off and occasional
tools that don't belong in my dotfiles but are worth keeping somewhere findable.
Each tool lives in its own directory with its own README.

## Scripts

| Script | What it does |
| ------ | ------------ |
| [`pocketcasts-reset`](pocketcasts-reset/) | Unfollow every podcast in your Pocket Casts account, to start fresh. |

## Conventions

- One directory per tool, each with a `README.md` and usage instructions.
- Python tools target the standard library only where possible (no `pip install`).
- Formatting/linting via [`ruff`](https://docs.astral.sh/ruff/) using the
  repo-level [`ruff.toml`](ruff.toml) (100-char lines, double quotes).

## License

[MIT](LICENSE)
