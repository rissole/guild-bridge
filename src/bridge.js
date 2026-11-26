// Guild Bridge: relays chat between two WoW guild sync channels and a shared #general.
//
//   guild A sync  ->  #general (webhook, "Name [A]")  +  guild B sync ("[A] Name: msg")
//   guild B sync  ->  #general (webhook, "Name [B]")  +  guild A sync ("[B] Name: msg")
//   #general      ->  guild A sync + guild B sync     ("[D] Name: msg")
//
// Loop guard: anything posted by this bot or its webhook is ignored, as is any message
// that already carries a bridge tag such as "[A] ".

import { Client, Events, GatewayIntentBits } from 'discord.js';

function env(key, fallback) {
  const v = process.env[key] ?? fallback;
  if (v === undefined || v === '') {
    console.error(`Missing required setting ${key} (see .env.example)`);
    process.exit(1);
  }
  return v;
}

const cfg = {
  token: env('DISCORD_TOKEN'),
  generalId: env('GENERAL_CHANNEL_ID'),
  generalLabel: env('GENERAL_LABEL', 'D'),
  sides: [
    { label: env('GUILD_A_LABEL', 'A'), channelId: env('GUILD_A_CHANNEL_ID') },
    { label: env('GUILD_B_LABEL', 'B'), channelId: env('GUILD_B_CHANNEL_ID') },
  ],
  relayIntoGame: env('RELAY_INTO_GAME', 'true') === 'true',
  discover: process.argv.includes('--discover') || env('DISCOVER', 'false') === 'true',
  gameMaxLen: Number(env('GAME_MAX_LEN', '255')),
};

const WEBHOOK_NAME = 'Guild Bridge';
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tagRe = new RegExp(
  `^\\[(${[cfg.generalLabel, ...cfg.sides.map((s) => s.label)].map(escapeRe).join('|')})\\] `,
);
const noMentions = { parse: [] };

// Blizzard posts a placeholder when an unlinked player talks in guild chat
// ("Sent a message to guild chat but has not yet linked their Discord account.").
// It carries no chat text, so don't relay it.
const skipRe = new RegExp(env('SKIP_PATTERN', 'has not (yet )?linked their Discord account'), 'i');
function isSkipped(msg) {
  return [msg.content, ...msg.embeds.flatMap((e) => [e.title, e.description])].some((t) => t && skipRe.test(t));
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

let general; // TextChannel
let webhook; // Webhook in #general
const sideChannels = new Map(); // channelId -> { label, channel }

function speakerName(msg) {
  return msg.member?.displayName ?? msg.author.globalName ?? msg.author.username;
}

function messageText(msg) {
  const parts = [msg.cleanContent.trim()];
  for (const a of msg.attachments.values()) parts.push(a.url);
  for (const s of msg.stickers.values()) parts.push(`[sticker: ${s.name}]`);
  return parts.filter(Boolean).join(' ');
}

function truncate(text, max) {
  return text.length <= max ? text : text.slice(0, max - 1) + '…';
}

// Webhook usernames may not contain "discord" or "clyde" and are capped at 80 chars.
function webhookName(name, label) {
  const clean = name.replace(/discord/gi, 'dc').replace(/clyde/gi, 'cl');
  return truncate(`${clean} [${label}]`, 80);
}

const lastError = new Map(); // channelId -> timestamp, to avoid log spam
async function sendToGame(side, label, name, text) {
  if (!cfg.relayIntoGame) return;
  const content = truncate(`[${label}] ${name}: ${text}`, cfg.gameMaxLen);
  try {
    await side.channel.send({ content, allowedMentions: noMentions });
  } catch (err) {
    const now = Date.now();
    if (now - (lastError.get(side.channel.id) ?? 0) > 10 * 60_000) {
      lastError.set(side.channel.id, now);
      console.error(`Could not post into #${side.channel.name} (guild ${side.label}): ${err.code ?? ''} ${err.message}`);
    }
  }
}

async function sendToGeneral(label, msg, text) {
  try {
    await webhook.send({
      content: truncate(text, 2000),
      username: webhookName(speakerName(msg), label),
      avatarURL: msg.author.displayAvatarURL(),
      allowedMentions: noMentions,
    });
  } catch (err) {
    console.error(`Could not post into #general: ${err.code ?? ''} ${err.message}`);
  }
}

function logDiscover(msg) {
  console.log(
    JSON.stringify({
      channel: msg.channel.name,
      id: msg.id,
      type: msg.type,
      author: { id: msg.author.id, username: msg.author.username, globalName: msg.author.globalName, bot: msg.author.bot },
      memberNick: msg.member?.nickname ?? null,
      webhookId: msg.webhookId,
      applicationId: msg.applicationId,
      flags: msg.flags.toArray(),
      content: msg.content,
      embeds: msg.embeds.map((e) => ({ title: e.title, description: e.description, author: e.author?.name })),
    }),
  );
}

client.once(Events.ClientReady, async (c) => {
  general = await c.channels.fetch(cfg.generalId);
  for (const s of cfg.sides) {
    const channel = await c.channels.fetch(s.channelId);
    sideChannels.set(s.channelId, { label: s.label, channel });
  }
  const hooks = await general.fetchWebhooks();
  webhook =
    hooks.find((h) => h.owner?.id === c.user.id && h.name === WEBHOOK_NAME) ??
    (await general.createWebhook({ name: WEBHOOK_NAME }));

  console.log(`Logged in as ${c.user.tag}`);
  console.log(`  #${general.name} <-> ${[...sideChannels.values()].map((s) => `#${s.channel.name} [${s.label}]`).join(', ')}`);
  console.log(`  relay into game: ${cfg.relayIntoGame}, discover logging: ${cfg.discover}`);
});

// Discover mode: also dump the raw gateway payload, which includes fields discord.js doesn't map
// (e.g. where the game's character-name badge lives).
client.on(Events.Raw, (packet) => {
  if (cfg.discover && packet.t === 'MESSAGE_CREATE' && sideChannels.has(packet.d.channel_id)) {
    console.log('RAW ' + JSON.stringify(packet.d));
  }
});

client.on(Events.MessageCreate, async (msg) => {
  if (!webhook) return; // not ready yet
  if (msg.system) return;
  if (msg.author.id === client.user.id || msg.webhookId === webhook.id) return;

  const side = sideChannels.get(msg.channelId);
  const isGeneral = msg.channelId === cfg.generalId;
  if (!side && !isGeneral) return;

  if (cfg.discover && side) logDiscover(msg);
  if (tagRe.test(msg.content)) return;
  if (side && isSkipped(msg)) return;

  const text = messageText(msg);
  if (!text) return;
  const name = speakerName(msg);

  if (side) {
    // From the game (or a linked player typing in the sync channel directly).
    await sendToGeneral(side.label, msg, text);
    for (const other of sideChannels.values()) {
      if (other !== side) await sendToGame(other, side.label, name, text);
    }
  } else {
    // From #general: humans only, so other bots in #general don't leak into the game.
    if (msg.author.bot || msg.webhookId) return;
    for (const s of sideChannels.values()) await sendToGame(s, cfg.generalLabel, name, text);
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    client.destroy().finally(() => process.exit(0));
  });
}

client.login(cfg.token);
