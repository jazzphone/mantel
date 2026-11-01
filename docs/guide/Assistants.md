# Assistants (MCP)

Mantel can let an assistant help you set up the house: Claude Code, Claude Desktop, or any other app that speaks the Model Context Protocol (MCP). The assistant can read your home, change settings, and build screens and Home Grid layouts. Setting up a new tablet or a new screen can then be a conversation instead of an afternoon in Mantel Settings.

An assistant always acts **for one person**. That person's role decides what it may see and do, and the audit log shows each change as theirs, made through the assistant. Mantel shows the assistant each change before it is made, and every change can be undone. An assistant is never given the Alarm PIN.

## Turn assistants on

Assistants are off at first. To turn them on, open **Mantel Settings** → **Advanced** → **Assistants (MCP)** and turn on **Allow Assistants**. Only the Owner can do this. While it is off, Mantel refuses every assistant; their keys and sign-ins are kept and work again when you turn it back on.

The same page has the house's other switches:

| Setting | What it does | At first |
|---|---|---|
| **Allow Assistants** | Whether Mantel answers assistants at all | Off |
| **Signed-In Assistants from Away** | An assistant that signed in (below) and was allowed "from away" may be used outside the home network. Personal keys always work on the home network only. | Off |
| **Assistants May Control the House** | A signed-in assistant can be allowed to turn things on and off, as its person may. It also needs **Allow Control of the House** (General). Never with a personal key. | Off |
| **Changes per Minute** | How many changes one assistant may make in a minute. Planning a change doesn't count. | 60 |
| **New Keys Last** | How long a new personal key works | 30 days |

Owners and Admins can connect an assistant. Anyone else can't, and if a person's role changes, their assistant's access changes at once.

## Connect an assistant

The page shows Mantel's **Address**, ending in `/mcp`. Connect from your home network.

### With a personal key

1. Select **New Personal Key…**, name it ("Claude Code on the office Mac"), and tick what it may do (below).
2. Select **Make Key** and confirm it is you.
3. Mantel shows the key **once**, with the command for Claude Code. Copy it, then select **I Have Saved It**. Mantel keeps only a hash of the key.

In Claude Code, run the command the page shows:

```bash
claude mcp add --transport http mantel http://mantel.example:8100/mcp --header "Authorization: Bearer mmcp_…"
```

For Claude Desktop, add Mantel to `claude_desktop_config.json` through the `mcp-remote` bridge, with the address and the key as a Bearer token. Other clients take the address and the key the same way.

### By signing in

A client that can sign in, such as Claude Code, needs only the address. When it first connects, it opens Mantel in your browser. Sign in, and Mantel asks **Allow \<assistant\> to connect as \<you\>?**, showing the address it will return to and what it may do, as ticks. Allow it only if you just started connecting that assistant yourself. A signed-in assistant can also be allowed **from away** and to **control the house**, when the Owner allows those.

### What an assistant may do

| Tick | Lets it |
|---|---|
| **Read** | Read the house, its settings, screens and Music |
| **Change Settings** | Change the house's, screens', tablets', accessories' and Music's settings |
| **Screens and Home Grid** | Add, rename, move and remove screens, and lay out their Home Grid |
| **Audit Log** | Read the audit log and settings history |
| **Restore** | Roll a settings document back to an earlier version |
| **Control the House** | Turn things on and off as you may (signed-in assistants only) |

These are the most it may do: your own role still decides each action. People, roles, passkeys, connections' secrets and service accounts are out of every assistant's reach.

## What changing something looks like

An assistant first **plans** each change: Mantel checks it exactly as Mantel Settings would, and shows what would change. Nothing is saved at that point. Applying it needs that plan. If anything changed in between (someone else saved the same screen, for example), Mantel refuses and the assistant plans again. A good assistant shows you the plan and applies it only when you say so.

Every applied change answers how to undo it, and the settings history keeps every version, so asking "undo that" works. A change Mantel refuses comes back with the field and the reason, the same words Mantel Settings would use, so the assistant can fix it.

Things an assistant can do in one conversation:

- **Set up a new wall tablet:** make it a screen (copied from another, or from a template), lay out its Home Grid with its room first, and point the tablet at it. Enrolling the tablet stays a person's step: the assistant gives you the link to open on the tablet.
- **Build a screen from a template:** kitchen, hallway, family, nightstand, guest room or living room, filled from your own house.
- **Copy a screen:** export one screen and import it as another, with its lights and cameras matched to another room's by name.
- **Fix Music after a move:** when Music Assistant's library changes and playlist pills stop working, it matches each one again by name and lists any it couldn't match.
- **Answer "what changed this week?"** from the audit log.

An assistant can also open a **preview** of a screen in its own browser, to look at what it built. The preview link works once, for five minutes, and the screen it opens can't change anything or open Mantel Settings.

## See and end an assistant

**Assistants (MCP)** lists each connected assistant: a personal key or a sign-in, what it may do, when it was last used and from where, and until when it works. The Owner sees everyone's; an Admin sees their own. **Revoke** cuts one off at once. Signing out everywhere (**Me** → **Sessions**) ends your assistants too.

In the **Audit Log**, **Through** → **An Assistant** shows only what assistants did. Each row says which assistant it was.

## Security

- An assistant's access is a sign-in of the person's own, with a ceiling. Mantel checks the person, their role and the assistant's ticks on every request.
- A personal key works on the home network only, and never controls the house. A key shown once can't be shown again.
- A signed-in assistant gets a token that lasts 15 minutes and is renewed as it is used; a stolen renewal token used twice ends the sign-in. Its tokens work only at `/mcp`, never as a browser's sign-in.
- Mantel never reaches Home Assistant for an assistant except through the same checked, audited path a screen's button uses.

See [Commands and Audit](Commands-and-Audit.md) and [Security Model](Security-Model.md).
