# Guild Bridge

Relays chat between two WoW guild Discord sync channels and a shared `#general`.

| From | To |
|---|---|
| Guild A sync channel | `#general` as `Name [A]`, and guild B sync as `[A] Name: msg` |
| Guild B sync channel | `#general` as `Name [B]`, and guild A sync as `[B] Name: msg` |
| `#general` (humans) | both sync channels as `[D] Name: msg` |

The bot ignores its own posts and anything already tagged `[A] ` / `[B] ` / `[D] `, so it can't loop.

## 1. Create the bot

1. Open https://discord.com/developers/applications and click **New Application**. Name it, for example, "Guild Bridge".
2. Go to the **Bot** tab:
   - Click **Reset Token** and copy the token. It's your `DISCORD_TOKEN`; keep it secret.
   - Turn on **Message Content Intent**.
   - Turn off **Public Bot**.
3. Go to **OAuth2** and copy the **Client ID**. Open this URL, with your ID in place of `CLIENT_ID`, and add the bot to your server:

   ```
   https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot&permissions=536955904
   ```

   That permission set is View Channel, Send Messages, Embed Links, Read Message History and Manage Webhooks.
4. If you locked the sync channels, add a member override on each one that allows the bot to **Send Messages**.

## 2. Configure

```
cp .env.example .env
```

Fill in the token and the three channel IDs. To copy an ID, turn on Discord **Developer Mode** (User Settings → Advanced), then right-click the channel → **Copy Channel ID**.

## 3. Run

```
npm install
npm run discover   # relays, and also logs the raw shape of every sync-channel message
npm start          # normal run
```

## 4. First test

1. Type in guild chat in-game. It should appear in `#general` as `YourName [A]`, and in the other guild's sync channel.
2. Post in `#general`. Check whether it shows up **in-game** for both guilds.
   - If the bot's post appears in the sync channel but **not in-game**, Blizzard isn't relaying bot posts. Set `RELAY_INTO_GAME=false` for a one-way bridge (game → `#general`).
   - If the console says `Could not post into #...`, Discord is blocking the bot in that channel. Check the bot's channel permissions.

## Deploy

Any always-on machine running Node 22 or newer works:

```
npm ci --omit=dev
npm start
```

Set the `.env` values as environment variables on the host instead of copying the file.
