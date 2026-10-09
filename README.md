# The X Factor kit for Claude Code

Four add-ons that make Claude Code safer and easier to follow, for people learning it.

| Part | What it does | How you use it |
|---|---|---|
| **Blast Radius** | Stops risky deletes and git commands, shows exactly what they would remove, and waits for you. | A red box appears above the prompt: press **Approve once** or **Reject**. |
| **File Tree** | A side pane listing the files Claude reads, edits and commits, as it happens. | `/filetree` |
| **Replay Theater** | After Claude edits files, step through each change as before and after. | Press **Replay** above the prompt, or `/replay` |
| **Cash Tax** | Warns before a long conversation you left idle gets expensive to pick up again. | `/cashtax`, `/keepwarm` |

The first time you start Claude Code after installing, a short welcome explains each part. Type `/kit` any time to see it again.

## Install

You need a recent Claude Code. If you are not sure, run `claude update` in a terminal first, or update the Claude desktop app.

### In the Claude desktop app (the usual way)

Start a Code session and paste this message:

> Install the X Factor kit for Claude Code on this computer. On Windows, download https://raw.githubusercontent.com/kevinfactor/claude-kit/main/install.ps1, read it, and run it with `powershell -ExecutionPolicy Bypass -File install.ps1 -Beginner`. On a Mac, follow the "Mac" steps in https://github.com/kevinfactor/claude-kit/blob/main/README.md. Then tell me to start a new session.

Leave out `-Beginner` if you have used Claude Code before (see below).

Then start a new session. The welcome message appears above the prompt.

### Windows, by hand

In PowerShell, from a copy of this repository:

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1 -Beginner
```

### Mac

1. Download https://github.com/kevinfactor/claude-kit/archive/refs/heads/main.zip and unzip it so the `plugins` folder ends up at `~/.claude/kits/claude-kit/plugins`.
2. In `~/.claude/settings.json`, keeping everything already there, add the plugin folders to `env.CLAUDE_CODE_PLUGIN_DIRS`, separated by `:`. All five: `kit-guide`, `blast-radius`, `file-tree`, `replay-theater`, `cash-tax`. Beginners: leave out `cash-tax`.
3. Beginners also add `"pluginConfigs": { "blast-radius": { "options": { "strict": true } } }`.
4. Start a new session.

### In a terminal session

```
/plugin marketplace add kevinfactor/claude-kit
/plugin install kit-guide@claude-kit
/plugin install blast-radius@claude-kit
/plugin install file-tree@claude-kit
/plugin install replay-theater@claude-kit
/plugin install cash-tax@claude-kit
```

Answer `y` to add the marketplace, then press Enter to install for your user. Installed this way, the kit also works in the desktop app.

## Beginner mode

- **Blast Radius** holds every delete, even a single file. Without it, deleting one plain file goes through; folders, wildcards and bulk deletes are always held.
- **Cash Tax** is left out.

## Good to know

- **Blast Radius is a safety net, not a guarantee.** It reads the commands Claude runs. A program that deletes files from inside its own code gets past it.
- **Cash Tax's prices are what the API would charge.** On a Pro or Max plan they show how much of your usage a message takes, not money you pay. It assumes the cache lasts 60 minutes; change that in `/config` if yours differs.
- **`/keepwarm` is not free:** each ping is one cheap cache read, and it stops by itself after 6.
- **Update:** run the same install again. It replaces the kit's files and keeps your settings. Your old `settings.json` is saved beside it as `settings.json.before-kit-<date>`.
- **Turn a part off:** ask Claude to remove that part's folder from `CLAUDE_CODE_PLUGIN_DIRS` in your Claude settings, then start a new session.
