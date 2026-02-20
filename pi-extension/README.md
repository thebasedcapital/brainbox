# pi-brainbox

Hebbian memory for Pi — learns what files you need before you search for them.

## Install

```bash
pi install pi-brainbox
```

Or local install: copy directory to `~/.pi/agent/extensions/pi-brainbox/`

## What It Does

- **Passive learning**: records every file read/edit/search automatically, strengthening connections between co-accessed files
- **Neural recall**: intercepts searches and surfaces high-confidence file predictions before you grep — skipping the search entirely when confidence is high
- **Persistent widget**: sidebar panel showing live memory state, top superhighways, and token savings

## Configuration

Set `BRAINBOX_DB` to use a custom database path:

```bash
export BRAINBOX_DB=~/.my-project/brainbox.db
```

Default: `~/.brainbox/brainbox.db`

## Commands

| Command      | Description                              |
|-------------|------------------------------------------|
| `/brainbox` | Show memory stats, top neurons, savings |

## Tools

| Tool               | Description                                              |
|-------------------|----------------------------------------------------------|
| `brainbox_recall`  | Query neural memory for relevant files given a task     |
| `brainbox_error`   | Record an error and get fix-file suggestions            |
| `brainbox_stats`   | Show neuron count, synapse count, superhighways, savings |

## How Hebbian Learning Works

Files accessed together strengthen their synaptic connection. Frequently used paths become myelinated superhighways (faster recall, higher confidence). Unused connections decay over time, keeping the graph lean.

## Links

- Main repo: [github.com/thebasedcapital/brainbox](https://github.com/thebasedcapital/brainbox)
