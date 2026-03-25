require('dotenv').config();
const {
  Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes,
  ActivityType, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const mongoose = require('mongoose');
const axios    = require('axios');

// ─── Express ──────────────────────────────────────────────────────────────────
const express = require('express');
const app = express();
app.use(express.json());
app.get('/', (req, res) => res.send('Bot is running!'));

// ─── Config ───────────────────────────────────────────────────────────────────
const API_SECRET           = process.env.API_SECRET           || 'stradaz-secret-key'
const DISCORD_TOKEN        = process.env.DISCORD_TOKEN;
const CLIENT_ID            = process.env.CLIENT_ID;
const GUILD_ID             = process.env.GUILD_ID;
const ROBLOX_COOKIE        = process.env.ROBLOX_COOKIE;
const GROUP_ID             = process.env.GROUP_ID             || '11350952';
const GAME_ID              = process.env.GAME_ID              || '7968913182';
const LOG_CHANNEL_ID       = process.env.LOG_CHANNEL_ID;
const MONGODB_URI          = process.env.MONGODB_URI;
const OPEN_CLOUD_API_KEY   = process.env.OPEN_CLOUD_API_KEY;
const MAIN_UNIVERSE_ID     = process.env.MAIN_UNIVERSE_ID;
const TRAINING_UNIVERSE_ID = process.env.TRAINING_UNIVERSE_ID;
const MAIN_PLACE_ID        = process.env.MAIN_PLACE_ID;
const TRAINING_PLACE_ID    = process.env.TRAINING_PLACE_ID;

const IMAGE          = `https://gpi.hyra.io/${GROUP_ID}/icon`;
const WEBHOOK_URL    = process.env.WEBHOOK_URL    || '';
const WEBHOOK_AVATAR = process.env.WEBHOOK_AVATAR || IMAGE;
const ALERT_CHANNEL_ID = process.env.ALERT_CHANNEL_ID || '1483999123924324505';

// ─── Permission Role IDs ──────────────────────────────────────────────────────
// ALL commands require one of these two roles
const GLOBAL_ROLE_IDS  = ['1469865951452467220', '1469859492249473219'];
// Restart servers requires this specific role only
const RESTART_ROLE_ID  = '1469865951452467220';
// Status minimum role (MR+)
const STATUS_MIN_ROLE_ID = '1469860250730369025';

console.log('TOKEN:',              DISCORD_TOKEN        ? 'OK' : 'MISSING');
console.log('CLIENT_ID:',          CLIENT_ID            ? 'OK' : 'MISSING');
console.log('GUILD_ID:',           GUILD_ID             ? 'OK' : 'MISSING');
console.log('MONGODB:',            MONGODB_URI          ? 'OK' : 'MISSING');
console.log('OPEN CLOUD KEY:',     OPEN_CLOUD_API_KEY   ? 'OK' : 'MISSING');
console.log('MODCALL CHANNEL:',    process.env.MODCALL_CHANNEL_ID ? 'OK' : 'MISSING');
console.log('MAIN UNIVERSE:',      MAIN_UNIVERSE_ID     ? 'OK' : 'MISSING');
console.log('TRAINING UNIVERSE:',  TRAINING_UNIVERSE_ID ? 'OK' : 'MISSING');
console.log('MAIN PLACE ID:',      MAIN_PLACE_ID        ? 'OK' : 'MISSING');
console.log('TRAINING PLACE ID:',  TRAINING_PLACE_ID    ? 'OK' : 'MISSING');

// ─── Bot Ready Flag ───────────────────────────────────────────────────────────
let botReady = false;

// ─── Mongoose Schemas ─────────────────────────────────────────────────────────
const rankLogSchema = new mongoose.Schema({
  timestamp:      { type: Date, default: Date.now },
  staffDiscordId: String,
  staffTag:       String,
  robloxUsername: String,
  robloxId:       Number,
  oldRank:        String,
  newRank:        String,
  reason:         String,
  action:         String,
});
const RankLog = mongoose.model('RankLog', rankLogSchema);

const banSchema = new mongoose.Schema({
  robloxUsername: { type: String, required: true },
  robloxUserId:   { type: String, default: null },
  game:           { type: String, enum: ['main', 'training'], required: true },
  reason:         { type: String, required: true },
  bannedBy:       { type: String, required: true },
  bannedById:     { type: String, required: true },
  bannedAt:       { type: Date, default: Date.now },
  expiresAt:      { type: Date, default: null },
  active:         { type: Boolean, default: true },
});
const Ban = mongoose.model('Ban', banSchema);

const alertClaimSchema = new mongoose.Schema({
  discordId:  { type: String, required: true },
  discordTag: { type: String, required: true },
  jobId:      { type: String, required: true },
  placeId:    { type: String, default: null },
  claimedAt:  { type: Date, default: Date.now },
});
const AlertClaim = mongoose.model('AlertClaim', alertClaimSchema);

const mrSessionSchema = new mongoose.Schema({
  robloxId:   { type: String, required: true },
  robloxName: { type: String, required: true },
  joinedAt:   { type: Date, required: true },
  leftAt:     { type: Date, default: null },
  durationMs: { type: Number, default: null },
  jobId:      { type: String, required: true },
});
const MRSession = mongoose.model('MRSession', mrSessionSchema);

const modActionSchema = new mongoose.Schema({
  timestamp:      { type: Date, default: Date.now },
  staffDiscordId: String,
  staffTag:       String,
  robloxUsername: String,
  robloxUserId:   String,
  action:         String,
  game:           String,
  reason:         String,
});
const ModAction = mongoose.model('ModAction', modActionSchema);

// ─── DB Health Check ──────────────────────────────────────────────────────────
function isDbReady() {
  return mongoose.connection.readyState === 1;
}

// ─── Discord Client ─────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
  ]
});

// Log errors
client.on('error', err => {
  console.error('❌ Discord client error:', err);
});

client.on('warn', msg => {
  console.warn('⚠️ Discord warning:', msg);
});

client.on('debug', msg => {
  if (msg.includes('Heartbeat') || msg.includes('READY')) {
    console.log('🔍 Debug:', msg);
  }
});

client.once('ready', async () => {
  console.log('🤖 Bot ready as', client.user.tag);
  botReady = true;
  client.user.setActivity('Stradaz Cafe', { type: ActivityType.Watching });
  await registerCommands();
  processTempBanExpiry();
  console.log('Bot prêt.');
});

// ─── Permission Helpers ───────────────────────────────────────────────────────

// Global gate — user must have at least one of the two global roles
function hasGlobalPermission(member) {
  return GLOBAL_ROLE_IDS.some(id => member.roles.cache.has(id));
}

// Restart-only gate
function hasRestartPermission(member) {
  return member.roles.cache.has(RESTART_ROLE_ID);
}

// Status minimum role (MR+)
function hasStatusPermission(member) {
  const minRole = member.guild.roles.cache.get(STATUS_MIN_ROLE_ID);
  if (!minRole) return false;
  return member.roles.cache.some(r => r.position >= minRole.position);
}

// ─── Roblox Helpers ───────────────────────────────────────────────────────────
async function getRobloxUserByUsername(username) {
  const res = await axios.post('https://users.roblox.com/v1/usernames/users', {
    usernames: [username], excludeBannedUsers: false
  });
  const user = res.data.data[0];
  if (!user) throw new Error(`Utilisateur "${username}" introuvable sur Roblox.`);
  return user;
}

async function getRobloxUserById(userId) {
  const res = await axios.get(`https://users.roblox.com/v1/users/${userId}`);
  return res.data;
}

async function getGroupRoles() {
  const res = await axios.get(`https://groups.roblox.com/v1/groups/${GROUP_ID}/roles`);
  return res.data.roles;
}

async function getUserGroupRole(userId) {
  const res = await axios.get(`https://groups.roblox.com/v2/users/${userId}/groups/roles`);
  const groups = res.data.data;
  const m = groups.find(g => g.group.id === parseInt(GROUP_ID));
  return m ? m.role : null;
}

async function getGroupMembersByRole(roleId, limit = 50) {
  const res = await axios.get(
    `https://groups.roblox.com/v1/groups/${GROUP_ID}/roles/${roleId}/users?limit=${limit}&sortOrder=Asc`
  );
  return res.data.data;
}

async function getCsrfToken() {
  try {
    await axios.post('https://auth.roblox.com/v2/logout', {}, {
      headers: { Cookie: `.ROBLOSECURITY=${ROBLOX_COOKIE}` }
    });
  } catch (err) {
    if (err.response?.headers['x-csrf-token']) return err.response.headers['x-csrf-token'];
    throw new Error("Impossible d'obtenir le jeton CSRF.");
  }
}

async function setGroupRank(userId, roleId) {
  await axios.patch(
    `https://groups.roblox.com/v1/groups/${GROUP_ID}/users/${userId}`,
    { roleId },
    { headers: { Cookie: `.ROBLOSECURITY=${ROBLOX_COOKIE}`, 'X-CSRF-TOKEN': await getCsrfToken() } }
  );
}

async function exileFromGroup(userId) {
  await axios.delete(
    `https://groups.roblox.com/v1/groups/${GROUP_ID}/users/${userId}`,
    { headers: { Cookie: `.ROBLOSECURITY=${ROBLOX_COOKIE}`, 'X-CSRF-TOKEN': await getCsrfToken() } }
  );
}

async function getRobloxAvatar(userId) {
  try {
    const res = await axios.get(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png`
    );
    return res.data.data[0]?.imageUrl || null;
  } catch { return null; }
}

async function getGamePasses() {
  let passes = [], cursor = '';
  do {
    const url = `https://games.roblox.com/v1/games/${GAME_ID}/game-passes?limit=100&sortOrder=Asc${cursor ? '&cursor=' + cursor : ''}`;
    const res = await axios.get(url);
    passes = passes.concat(res.data.data);
    cursor = res.data.nextPageCursor || '';
  } while (cursor);
  return passes;
}

async function userOwnsGamePass(userId, gamePassId) {
  try {
    const res = await axios.get(
      `https://inventory.roblox.com/v1/users/${userId}/items/GamePass/${gamePassId}`
    );
    return res.data.data && res.data.data.length > 0;
  } catch { return false; }
}

async function getUserBadges(userId, universeId) {
  try {
    const res = await axios.get(
      `https://badges.roblox.com/v1/universes/${universeId}/badges?limit=10&sortOrder=Desc`
    );
    const allBadges = res.data.data;
    const owned = [];
    for (const badge of allBadges.slice(0, 10)) {
      try {
        const check = await axios.get(
          `https://inventory.roblox.com/v1/users/${userId}/items/Badge/${badge.id}`
        );
        if (check.data.data?.length > 0) owned.push(badge);
      } catch {}
    }
    return owned;
  } catch { return []; }
}

async function getRobloxServers(universeId, limit = 10) {
  try {
    const res = await axios.get(
      `https://games.roblox.com/v1/games/${universeId}/servers/Public?limit=${limit}`
    );
    return res.data.data || [];
  } catch { return []; }
}

async function getGameInfo(universeId) {
  try {
    const res = await axios.get(
      `https://games.roblox.com/v1/games?universeIds=${universeId}`
    );
    return res.data.data[0] || null;
  } catch { return null; }
}

// ─── Open Cloud ───────────────────────────────────────────────────────────────
async function banFromRoblox(userId, universeId, reason, duration = null) {
  const url = `https://apis.roblox.com/cloud/v2/universes/${universeId}/user-restrictions/${userId}`;
  const body = {
    gameJoinRestriction: {
      active: true,
      privateReason: reason,
      displayReason: reason,
      excludeAltAccounts: false,
    }
  };
  if (duration) body.gameJoinRestriction.duration = duration;
  else body.gameJoinRestriction.duration = null;

  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'x-api-key': OPEN_CLOUD_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Open Cloud error: ${res.status}`);
  return data;
}

async function unbanFromRoblox(userId, universeId) {
  const url = `https://apis.roblox.com/cloud/v2/universes/${universeId}/user-restrictions/${userId}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'x-api-key': OPEN_CLOUD_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameJoinRestriction: { active: false } }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Open Cloud error: ${res.status}`);
  return data;
}

async function getRobloxBanStatus(userId, universeId) {
  const url = `https://apis.roblox.com/cloud/v2/universes/${universeId}/user-restrictions/${userId}`;
  const res = await fetch(url, { method: 'GET', headers: { 'x-api-key': OPEN_CLOUD_API_KEY } });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Open Cloud error: ${res.status}`);
  return data?.gameJoinRestriction?.active === true;
}

async function sendMessagingServiceMessage(universeId, topic, message) {
  const url = `https://apis.roblox.com/cloud/v2/universes/${universeId}/topics/${topic}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'x-api-key': OPEN_CLOUD_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Messaging error: ${res.status}`);
  return data;
}

// ─── Embed Helpers ────────────────────────────────────────────────────────────
function baseEmbed() {
  return new EmbedBuilder()
    .setColor(0x111111)
    .setThumbnail(IMAGE)
    .setTimestamp()
    .setFooter({ text: 'Stradaz Cafe - Système de Gestion', iconURL: IMAGE });
}

function errorEmbed(description) {
  return new EmbedBuilder()
    .setColor(0x880000)
    .setThumbnail(IMAGE)
    .setDescription('❌ ' + description)
    .setTimestamp()
    .setFooter({ text: 'Stradaz Cafe - Système de Gestion', iconURL: IMAGE });
}

function successEmbed(description) {
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setThumbnail(IMAGE)
    .setDescription('✅ ' + description)
    .setTimestamp()
    .setFooter({ text: 'Stradaz Cafe - Système de Gestion', iconURL: IMAGE });
}

// ─── Log Helper ───────────────────────────────────────────────────────────────
async function sendLogToChannel(embed) {
  if (!LOG_CHANNEL_ID) return;
  try {
    const ch = await client.channels.fetch(LOG_CHANNEL_ID);
    if (ch) await ch.send({ embeds: [embed] });
  } catch (err) {
    console.error('Log channel error:', err.message);
  }
}

// ─── Duration Formatter ───────────────────────────────────────────────────────
function formatDuration(ms) {
  if (!ms || ms <= 0) return '0m';
  const totalSec = Math.floor(ms / 1000);
  const hours    = Math.floor(totalSec / 3600);
  const minutes  = Math.floor((totalSec % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// ─── Pending Changes Map ──────────────────────────────────────────────────────
const pendingChanges = new Map();

// ─── Safe Defer ───────────────────────────────────────────────────────────────
async function safeDefer(interaction, ephemeral = false) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral });
    }
    return true;
  } catch (err) {
    console.error('safeDefer error:', err.message);
    try {
      if (!interaction.replied) {
        await interaction.reply({ embeds: [errorEmbed('Erreur interne, réessayez.')], ephemeral: true });
      }
    } catch {}
    return false;
  }
}

// ─── Permission Guard Helper ──────────────────────────────────────────────────
// Returns true if blocked (already replied with error), false if allowed
async function guardGlobal(interaction) {
  if (!hasGlobalPermission(interaction.member)) {
    await interaction.reply({
      embeds: [errorEmbed('Permission refusée. Vous devez avoir un rôle staff autorisé.')],
      ephemeral: true,
    });
    return true;
  }
  return false;
}

// ─── HTTP Endpoints ───────────────────────────────────────────────────────────
app.post('/modcall', async (req, res) => {
  try {
    if (!botReady) return res.status(503).json({ error: 'Bot not ready yet' });
    if (!isDbReady()) return res.status(503).json({ error: 'Database unavailable' });

    const { secret, content, embeds, modcall_meta } = req.body;
    if (secret !== API_SECRET) return res.status(401).json({ error: 'Unauthorized' });

    const channel = await client.channels.fetch(process.env.MODCALL_CHANNEL_ID);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('claim_modcall::' + modcall_meta.job_id)
        .setLabel('✅ Prendre en charge')
        .setStyle(ButtonStyle.Success)
    );
    await channel.send({ content, embeds, components: [row] });
    return res.json({ ok: true });
  } catch (err) {
    console.error('Modcall error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/alertstaff', async (req, res) => {
  try {
    if (!botReady) return res.status(503).json({ error: 'Bot not ready yet' });
    if (!isDbReady()) return res.status(503).json({ error: 'Database unavailable' });

    const { secret, player_name, player_id, reason, job_id, place_id, server_size, max_players } = req.body;
    if (secret !== API_SECRET) return res.status(401).json({ error: 'Unauthorized' });

    const joinLink = `roblox://experiences/start?placeId=${place_id}&gameInstanceId=${job_id}`;

    const webhookRes = await axios.post(
      WEBHOOK_URL + '?wait=true',
      {
        username:   'Stradaz Cafe – Alertes',
        avatar_url: WEBHOOK_AVATAR,
        embeds: [{
          title:       '🔔 ALERTE STAFF',
          description: `Une alerte a été déclenchée par **${player_name}** dans le café.`,
          color:       0xf39c12,
          thumbnail:   { url: WEBHOOK_AVATAR },
          fields: [
            { name: 'Raison',    value: '```' + (reason || 'Aucune raison fournie') + '```', inline: false },
            { name: 'Joueur',    value: `**${player_name}** (ID: \`${player_id}\`)`,          inline: true  },
            { name: 'Serveur',   value: `**${server_size || '?'}/${max_players || '?'}** joueurs`, inline: true },
            { name: 'Rejoindre', value: joinLink, inline: false },
          ],
          timestamp: new Date().toISOString(),
          footer: { text: "Stradaz Cafe – Système d'Alerte Staff", icon_url: WEBHOOK_AVATAR },
        }],
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    const webhookMsgId = webhookRes.data.id;
    const channel = await client.channels.fetch(ALERT_CHANNEL_ID);
    const msg     = await channel.messages.fetch(webhookMsgId);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`claim_alertstaff::${job_id}::${place_id}`)
        .setLabel('✅ Je gère')
        .setStyle(ButtonStyle.Primary)
    );
    await msg.edit({ components: [row] });

    return res.json({ ok: true });
  } catch (err) {
    console.error('AlertStaff error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/session/start', async (req, res) => {
  try {
    if (!isDbReady()) return res.status(503).json({ error: 'Database unavailable' });
    const { secret, roblox_id, roblox_name, job_id } = req.body;
    if (secret !== API_SECRET) return res.status(401).json({ error: 'Unauthorized' });

    const ghost = await MRSession.findOne({ robloxId: String(roblox_id), leftAt: null });
    if (ghost) {
      const now = new Date();
      ghost.leftAt     = now;
      ghost.durationMs = now - ghost.joinedAt;
      await ghost.save();
    }

    await MRSession.create({
      robloxId:   String(roblox_id),
      robloxName: roblox_name,
      joinedAt:   new Date(),
      jobId:      job_id,
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('Session start error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/session/end', async (req, res) => {
  try {
    if (!isDbReady()) return res.status(503).json({ error: 'Database unavailable' });
    const { secret, roblox_id, job_id } = req.body;
    if (secret !== API_SECRET) return res.status(401).json({ error: 'Unauthorized' });

    const session = await MRSession.findOne({ robloxId: String(roblox_id), jobId: job_id, leftAt: null });
    if (!session) return res.json({ ok: true, note: 'No open session found' });

    const now          = new Date();
    session.leftAt     = now;
    session.durationMs = now - session.joinedAt;
    await session.save();
    return res.json({ ok: true, durationMs: session.durationMs });
  } catch (err) {
    console.error('Session end error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/promote', async (req, res) => {
  try {
    const { username, secret } = req.body;
    if (secret !== API_SECRET) return res.status(401).json({ error: 'Unauthorized' });

    const robloxUser = await getRobloxUserByUsername(username);
    const roles      = (await getGroupRoles()).sort((a, b) => a.rank - b.rank);
    const oldRole    = await getUserGroupRole(robloxUser.id);
    if (!oldRole) return res.status(404).json({ error: 'User not in group' });

    const idx = roles.findIndex(r => r.id === oldRole.id);
    if (idx === -1 || idx >= roles.length - 1)
      return res.status(400).json({ error: 'Already at highest rank' });

    const newRole = roles[idx + 1];
    await setGroupRank(robloxUser.id, newRole.id);
    await RankLog.create({
      staffDiscordId: 'ROBLOX', staffTag: 'In-Game Command',
      robloxUsername: robloxUser.name, robloxId: robloxUser.id,
      oldRank: oldRole.name, newRank: newRole.name,
      reason: 'Promotion in-game', action: 'PROMOTE',
    });
    return res.json({ success: true, oldRank: oldRole.name, newRank: newRole.name, username: robloxUser.name });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/demote', async (req, res) => {
  try {
    const { username, secret } = req.body;
    if (secret !== API_SECRET) return res.status(401).json({ error: 'Unauthorized' });

    const robloxUser = await getRobloxUserByUsername(username);
    const roles      = (await getGroupRoles()).sort((a, b) => a.rank - b.rank);
    const oldRole    = await getUserGroupRole(robloxUser.id);
    if (!oldRole) return res.status(404).json({ error: 'User not in group' });

    const idx = roles.findIndex(r => r.id === oldRole.id);
    if (idx <= 0) return res.status(400).json({ error: 'Already at lowest rank' });

    const newRole = roles[idx - 1];
    await setGroupRank(robloxUser.id, newRole.id);
    await RankLog.create({
      staffDiscordId: 'ROBLOX', staffTag: 'In-Game Command',
      robloxUsername: robloxUser.name, robloxId: robloxUser.id,
      oldRank: oldRole.name, newRank: newRole.name,
      reason: 'Retrogradation in-game', action: 'DEMOTE',
    });
    return res.json({ success: true, oldRank: oldRole.name, newRank: newRole.name, username: robloxUser.name });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 3020, () =>
  console.log('Web server running on port', process.env.PORT || 3020)
);

// ─── Slash Commands ───────────────────────────────────────────────────────────
const commands = [
  // ── Ranking ──
  new SlashCommandBuilder()
    .setName('checkrank')
    .setDescription("Vérifier le rang d'un utilisateur Roblox.")
    .addStringOption(o => o.setName('username').setDescription("Nom d'utilisateur Roblox").setRequired(true)),

  new SlashCommandBuilder()
    .setName('promote')
    .setDescription("Promouvoir un utilisateur d'un rang.")
    .addStringOption(o => o.setName('username').setDescription("Nom d'utilisateur Roblox").setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(false)),

  new SlashCommandBuilder()
    .setName('demote')
    .setDescription("Rétrograder un utilisateur d'un rang.")
    .addStringOption(o => o.setName('username').setDescription("Nom d'utilisateur Roblox").setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(false)),

  new SlashCommandBuilder()
    .setName('setrank')
    .setDescription("Définir le rang d'un utilisateur Roblox.")
    .addStringOption(o => o.setName('username').setDescription("Nom d'utilisateur Roblox").setRequired(true))
    .addStringOption(o => o.setName('rang').setDescription('Nom du nouveau rang').setRequired(true)),

  new SlashCommandBuilder()
    .setName('massrank')
    .setDescription('Changer le rang de plusieurs utilisateurs à la fois.')
    .addStringOption(o =>
      o.setName('usernames')
       .setDescription('Noms séparés par des virgules (ex: user1,user2,user3)')
       .setRequired(true))
    .addStringOption(o => o.setName('rang').setDescription('Nom du nouveau rang').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(false)),

  new SlashCommandBuilder()
    .setName('rankhistory')
    .setDescription("Voir l'historique des rangs d'un utilisateur Roblox.")
    .addStringOption(o => o.setName('username').setDescription("Nom d'utilisateur Roblox").setRequired(true)),

  new SlashCommandBuilder()
    .setName('rankinfo')
    .setDescription("Voir les détails d'un rang du groupe.")
    .addStringOption(o => o.setName('rang').setDescription('Nom du rang').setRequired(true)),

  new SlashCommandBuilder()
    .setName('groupmembers')
    .setDescription('Lister les membres d\'un rang spécifique.')
    .addStringOption(o => o.setName('rang').setDescription('Nom du rang').setRequired(true)),

  new SlashCommandBuilder()
    .setName('exileuser')
    .setDescription('Exclure un utilisateur du groupe Roblox.')
    .addStringOption(o => o.setName('username').setDescription("Nom d'utilisateur Roblox").setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(false)),

  new SlashCommandBuilder()
    .setName('setguestrank')
    .setDescription('Remettre un utilisateur au rang le plus bas.')
    .addStringOption(o => o.setName('username').setDescription("Nom d'utilisateur Roblox").setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(false)),

  new SlashCommandBuilder()
    .setName('bulkexile')
    .setDescription('Exclure plusieurs utilisateurs du groupe en même temps.')
    .addStringOption(o =>
      o.setName('usernames')
       .setDescription('Noms séparés par des virgules')
       .setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(false)),

  new SlashCommandBuilder()
    .setName('groupstats')
    .setDescription('Voir le nombre de membres par rang dans le groupe.'),

  new SlashCommandBuilder()
    .setName('rankcompare')
    .setDescription('Comparer les rangs de deux utilisateurs Roblox.')
    .addStringOption(o => o.setName('user1').setDescription('Premier utilisateur').setRequired(true))
    .addStringOption(o => o.setName('user2').setDescription('Deuxième utilisateur').setRequired(true)),

  new SlashCommandBuilder()
    .setName('ranklog')
    .setDescription("Voir l'historique des changements de rang.")
    .addIntegerOption(o => o.setName('page').setDescription('Numéro de page').setRequired(false)),

  new SlashCommandBuilder()
    .setName('logstats')
    .setDescription('Statistiques des changements de rang.'),

  new SlashCommandBuilder()
    .setName('clearlog')
    .setDescription("Effacer l'historique des rangs."),

  // ── Bans & Modération ──
  new SlashCommandBuilder()
    .setName('rban')
    .setDescription('Bannir ou débannir un joueur.')
    .addStringOption(o =>
      o.setName('type').setDescription('Ban ou Unban ?').setRequired(true)
       .addChoices({ name: 'Ban', value: 'ban' }, { name: 'Unban', value: 'unban' }))
    .addStringOption(o => o.setName('username').setDescription("Nom d'utilisateur Roblox").setRequired(true))
    .addStringOption(o =>
      o.setName('game').setDescription('Quel jeu ?').setRequired(true)
       .addChoices({ name: 'Main Game', value: 'main' }, { name: 'Training Center', value: 'training' }))
    .addStringOption(o => o.setName('reason').setDescription('Raison').setRequired(false)),

  new SlashCommandBuilder()
    .setName('tempban')
    .setDescription('Bannir temporairement un joueur.')
    .addStringOption(o => o.setName('username').setDescription("Nom d'utilisateur Roblox").setRequired(true))
    .addStringOption(o =>
      o.setName('game').setDescription('Quel jeu ?').setRequired(true)
       .addChoices({ name: 'Main Game', value: 'main' }, { name: 'Training Center', value: 'training' }))
    .addIntegerOption(o => o.setName('heures').setDescription('Durée en heures').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Raison').setRequired(false)),

  new SlashCommandBuilder()
    .setName('banlist')
    .setDescription('Voir la liste des bans actifs.')
    .addStringOption(o =>
      o.setName('game').setDescription('Filtrer par jeu').setRequired(false)
       .addChoices({ name: 'Main Game', value: 'main' }, { name: 'Training Center', value: 'training' }))
    .addIntegerOption(o => o.setName('page').setDescription('Numéro de page').setRequired(false)),

  new SlashCommandBuilder()
    .setName('baninfo')
    .setDescription("Voir les détails du ban d'un joueur.")
    .addStringOption(o => o.setName('username').setDescription("Nom d'utilisateur Roblox").setRequired(true))
    .addStringOption(o =>
      o.setName('game').setDescription('Quel jeu ?').setRequired(false)
       .addChoices({ name: 'Main Game', value: 'main' }, { name: 'Training Center', value: 'training' })),

  new SlashCommandBuilder()
    .setName('modhistory')
    .setDescription("Voir l'historique des actions de modération sur un joueur.")
    .addStringOption(o => o.setName('username').setDescription("Nom d'utilisateur Roblox").setRequired(true)),

  new SlashCommandBuilder()
    .setName('banstats')
    .setDescription('Statistiques des bannissements.'),

  // ── Serveurs In-Game ──
  new SlashCommandBuilder()
    .setName('serverstatus')
    .setDescription('Voir le statut et les joueurs actifs des serveurs.')
    .addStringOption(o =>
      o.setName('game').setDescription('Quel jeu ?').setRequired(true)
       .addChoices({ name: 'Main Game', value: 'main' }, { name: 'Training Center', value: 'training' })),

  new SlashCommandBuilder()
    .setName('serverlist')
    .setDescription('Lister les serveurs actifs.')
    .addStringOption(o =>
      o.setName('game').setDescription('Quel jeu ?').setRequired(true)
       .addChoices({ name: 'Main Game', value: 'main' }, { name: 'Training Center', value: 'training' })),

  new SlashCommandBuilder()
    .setName('getserverinfo')
    .setDescription('Voir les infos détaillées d\'un serveur via son Job ID.')
    .addStringOption(o => o.setName('jobid').setDescription('Job ID du serveur').setRequired(true))
    .addStringOption(o =>
      o.setName('game').setDescription('Quel jeu ?').setRequired(true)
       .addChoices({ name: 'Main Game', value: 'main' }, { name: 'Training Center', value: 'training' })),

  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Envoyer une annonce dans tous les serveurs actifs via MessagingService.')
    .addStringOption(o =>
      o.setName('game').setDescription('Quel jeu ?').setRequired(true)
       .addChoices({ name: 'Main Game', value: 'main' }, { name: 'Training Center', value: 'training' }))
    .addStringOption(o => o.setName('message').setDescription('Message à envoyer').setRequired(true)),

  // ── Player Lookup ──
  new SlashCommandBuilder()
    .setName('profile')
    .setDescription("Voir le profil Roblox complet d'un joueur.")
    .addStringOption(o => o.setName('username').setDescription("Nom d'utilisateur Roblox").setRequired(true)),

  new SlashCommandBuilder()
    .setName('badges')
    .setDescription("Voir les badges d'un joueur dans le jeu.")
    .addStringOption(o => o.setName('username').setDescription("Nom d'utilisateur Roblox").setRequired(true))
    .addStringOption(o =>
      o.setName('game').setDescription('Quel jeu ?').setRequired(false)
       .addChoices({ name: 'Main Game', value: 'main' }, { name: 'Training Center', value: 'training' })),

  new SlashCommandBuilder()
    .setName('playtime')
    .setDescription("Voir le temps de jeu d'un joueur.")
    .addStringOption(o => o.setName('username').setDescription("Nom d'utilisateur Roblox").setRequired(true)),

  new SlashCommandBuilder()
    .setName('joindate')
    .setDescription("Voir la date de création du compte Roblox d'un joueur.")
    .addStringOption(o => o.setName('username').setDescription("Nom d'utilisateur Roblox").setRequired(true)),

  new SlashCommandBuilder()
    .setName('inventory')
    .setDescription("Voir les gamepasses possédés par un joueur.")
    .addStringOption(o => o.setName('username').setDescription("Nom d'utilisateur Roblox").setRequired(true)),

  new SlashCommandBuilder()
    .setName('online')
    .setDescription("Vérifier si un joueur est actuellement dans votre jeu.")
    .addStringOption(o => o.setName('username').setDescription("Nom d'utilisateur Roblox").setRequired(true)),

  new SlashCommandBuilder()
    .setName('lastseen')
    .setDescription("Voir la dernière session enregistrée d'un joueur.")
    .addStringOption(o => o.setName('username').setDescription("Nom d'utilisateur Roblox").setRequired(true)),

  new SlashCommandBuilder()
    .setName('own')
    .setDescription("Vérifier si un joueur possède un gamepass spécifique.")
    .addStringOption(o => o.setName('username').setDescription("Nom d'utilisateur Roblox").setRequired(true))
    .addStringOption(o => o.setName('gamepass').setDescription('Nom (ou partie du nom) du gamepass').setRequired(true)),

  // ── Staff ──
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Voir vos statistiques MR/HR : claims alertes et temps de jeu.')
    .addUserOption(o => o.setName('membre').setDescription('Membre à consulter (vide = vous-même)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('inactivitycheck')
    .setDescription('Voir les membres staff sans activité depuis X jours.')
    .addIntegerOption(o =>
      o.setName('jours').setDescription('Nombre de jours sans activité (défaut: 7)').setRequired(false)),
];

async function registerCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands.map(c => c.toJSON())
    });
    console.log('Commandes enregistrées.');
  } catch (err) {
    console.error('Erreur enregistrement commandes:', err.message);
  }
}

// ─── Temp Ban Expiry Job ──────────────────────────────────────────────────────
// Runs every 5 minutes to auto-unban expired temp bans
async function processTempBanExpiry() {
  try {
    if (!isDbReady()) return;
    const now     = new Date();
    const expired = await Ban.find({ active: true, expiresAt: { $ne: null, $lte: now } });
    for (const ban of expired) {
      try {
        const universeId = ban.game === 'main' ? MAIN_UNIVERSE_ID : TRAINING_UNIVERSE_ID;
        if (universeId) await unbanFromRoblox(ban.robloxUserId, universeId);
        ban.active = false;
        await ban.save();
        console.log(`Auto-unbanned ${ban.robloxUsername} from ${ban.game} (tempban expired)`);
      } catch (err) {
        console.error(`Auto-unban failed for ${ban.robloxUsername}:`, err.message);
      }
    }
  } catch (err) {
    console.error('Temp ban expiry job error:', err.message);
  }
}
setInterval(processTempBanExpiry, 5 * 60 * 1000);

// ─── Interaction Handler ──────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  try {

    // ── Modal Submits ────────────────────────────────────────────────────────
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('playtime_modal::')) {
        await interaction.deferReply({ ephemeral: false });
        const robloxUsername = interaction.fields.getTextInputValue('roblox_username').trim();
        try {
          const robloxUser = await getRobloxUserByUsername(robloxUsername);
          const sessions   = await MRSession.find({ robloxId: String(robloxUser.id), durationMs: { $ne: null } });
          const totalMs      = sessions.reduce((acc, s) => acc + (s.durationMs || 0), 0);
          const sessionCount = sessions.length;
          const recent = [...sessions]
            .sort((a, b) => new Date(b.joinedAt) - new Date(a.joinedAt))
            .slice(0, 3);
          const recentLines = recent.length > 0
            ? recent.map(s => {
                const date = new Date(s.joinedAt).toLocaleDateString('fr-FR');
                return `\`${date}\` — **${formatDuration(s.durationMs)}**`;
              }).join('\n')
            : 'Aucune session enregistrée';
          const avatar = await getRobloxAvatar(robloxUser.id);
          const embed = new EmbedBuilder()
            .setTitle(`⏱Temps de jeu — ${robloxUser.name}`)
            .setColor(0x5865f2)
            .setThumbnail(avatar || IMAGE)
            .addFields(
              { name: 'Temps total',         value: formatDuration(totalMs) || '0m', inline: true },
              { name: 'Sessions',             value: String(sessionCount),             inline: true },
              { name: 'Moy. par session',     value: sessionCount > 0 ? formatDuration(totalMs / sessionCount) : 'N/A', inline: true },
              { name: '3 dernières sessions', value: recentLines, inline: false },
            )
            .setTimestamp()
            .setFooter({ text: 'Stradaz Cafe – Suivi Temps de Jeu', iconURL: IMAGE });
          return interaction.editReply({ embeds: [embed] });
        } catch (err) {
          return interaction.editReply({ embeds: [errorEmbed(err.message)] });
        }
      }
      return;
    }

    // ── Button Handler ───────────────────────────────────────────────────────
    if (interaction.isButton()) {
      const customId = interaction.customId;

      if (customId.startsWith('claim_modcall::')) {
        const jobId = customId.split('::')[1];
        const updatedRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('claimed_disabled')
            .setLabel(`✅ Pris en charge par ${interaction.user.username}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
        );
        await interaction.update({ components: [updatedRow] });
        await interaction.followUp({
          content: `<@${interaction.user.id}> a pris en charge le modcall du serveur [\`${jobId}\`](roblox://experiences/start?gameInstanceId=${jobId})`,
        });
        return;
      }

      if (customId.startsWith('claim_alertstaff::')) {
        const parts   = customId.split('::');
        const jobId   = parts[1] || 'unknown';
        const placeId = parts[2] || null;
        const joinLink = placeId
          ? `roblox://experiences/start?placeId=${placeId}&gameInstanceId=${jobId}`
          : `roblox://experiences/start?gameInstanceId=${jobId}`;
        const updatedRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('alert_claimed_disabled')
            .setLabel(`✅ Géré par ${interaction.user.username}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
        );
        await interaction.update({ components: [updatedRow] });
        try {
          await AlertClaim.create({
            discordId:  interaction.user.id,
            discordTag: interaction.user.tag,
            jobId, placeId,
          });
        } catch (dbErr) {
          console.error('AlertClaim DB error:', dbErr.message);
        }
        await interaction.followUp({
          content: `<@${interaction.user.id}> a pris en charge l'alerte du serveur [\`${jobId}\`](${joinLink})`,
        });
        return;
      }

      if (customId.startsWith('playtime_btn::')) {
        const modal = new ModalBuilder()
          .setCustomId(`playtime_modal::${customId.split('::')[1]}`)
          .setTitle('🎮 Temps de jeu Roblox');
        const input = new TextInputBuilder()
          .setCustomId('roblox_username')
          .setLabel("Nom d'utilisateur Roblox")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('ex: Zaid_Oblivion')
          .setRequired(true)
          .setMaxLength(50);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
        return;
      }

      // Pending-change buttons
      const parts    = customId.split('::');
      const action   = parts[0];
      const changeId = parts[1];

      const pending = pendingChanges.get(changeId);
      if (!pending) {
        return interaction.reply({
          embeds: [errorEmbed('Confirmation expirée. Relancez la commande.')],
          ephemeral: true,
        });
      }
      if (interaction.user.id !== pending.requesterId) {
        return interaction.reply({
          embeds: [errorEmbed('Seule la personne qui a lancé la commande peut confirmer.')],
          ephemeral: true,
        });
      }
      pendingChanges.delete(changeId);

      if (action === 'annuler') {
        return interaction.update({ embeds: [baseEmbed().setDescription('Action annulée.')], components: [] });
      }

      // Rank confirm
      if (action === 'confirmer') {
        await interaction.deferUpdate();
        try {
          await setGroupRank(pending.userId, pending.newRoleId);
          const oldName = pending.oldRole?.name ?? 'Invité';
          const newName = pending.newRole.name;
          await RankLog.create({
            staffDiscordId: pending.requesterId,
            staffTag:       interaction.user.tag,
            robloxUsername: pending.robloxUser.name,
            robloxId:       pending.userId,
            oldRank:  oldName,
            newRank:  newName,
            reason:   pending.reason || '',
            action:   pending.auditAction,
          });
          await sendLogToChannel(baseEmbed()
            .setDescription('Changement de rang enregistré')
            .addFields(
              { name: 'Utilisateur',  value: pending.robloxUser.name },
              { name: 'Ancien rang',  value: oldName,  inline: true },
              { name: 'Nouveau rang', value: newName,  inline: true },
              { name: 'Raison',       value: pending.reason || 'Aucune' },
              { name: 'Effectué par', value: '<@' + pending.requesterId + '>' }
            )
          );
          const label = pending.auditAction === 'PROMOTE' ? 'Promotion réussie !'
            : pending.auditAction === 'DEMOTE' ? '⬇️ Rétrogradation réussie.' : '✅ Rang modifié.';
          return interaction.editReply({
            embeds: [baseEmbed().setDescription(label).addFields(
              { name: 'Utilisateur',  value: pending.robloxUser.name },
              { name: 'Ancien rang',  value: oldName,  inline: true },
              { name: 'Nouveau rang', value: newName,  inline: true },
              { name: 'Raison',       value: pending.reason || 'Aucune' },
              { name: 'Modifié par',  value: '<@' + pending.requesterId + '>' }
            )],
            components: [],
          });
        } catch (err) {
          return interaction.editReply({ embeds: [errorEmbed('Échec : ' + err.message)], components: [] });
        }
      }

      // Clear log confirm
      if (action === 'confirmer_clearlog') {
        await interaction.deferUpdate();
        await RankLog.deleteMany({});
        return interaction.editReply({ embeds: [successEmbed('Journal effacé.')], components: [] });
      }

      // Exile confirm
      if (action === 'confirmer_exile') {
        await interaction.deferUpdate();
        try {
          await exileFromGroup(pending.userId);
          await RankLog.create({
            staffDiscordId: pending.requesterId,
            staffTag:       interaction.user.tag,
            robloxUsername: pending.robloxUser.name,
            robloxId:       pending.userId,
            oldRank:  pending.oldRole?.name ?? 'Inconnu',
            newRank:  'EXCLU',
            reason:   pending.reason || 'Aucune raison',
            action:   'EXILE',
          });
          await sendLogToChannel(baseEmbed()
            .setDescription('Utilisateur exclu du groupe')
            .addFields(
              { name: 'Utilisateur', value: pending.robloxUser.name },
              { name: 'Rang avant',  value: pending.oldRole?.name ?? 'Inconnu' },
              { name: 'Raison',      value: pending.reason || 'Aucune' },
              { name: 'Exclu par',   value: '<@' + pending.requesterId + '>' }
            )
          );
          return interaction.editReply({
            embeds: [successEmbed(`**${pending.robloxUser.name}** a été exclu du groupe.`)],
            components: [],
          });
        } catch (err) {
          return interaction.editReply({ embeds: [errorEmbed('Échec : ' + err.message)], components: [] });
        }
      }

      // Ban/Unban confirm
      if (action === 'confirmer_ban') {
        await interaction.deferUpdate();
        try {
          const { type, username, userId, game, reason, gameLabel, universeId, expiresAt } = pending;

          if (type === 'unban') {
            await unbanFromRoblox(userId, universeId);
            await Ban.findOneAndUpdate(
              { robloxUsername: username.toLowerCase(), game, active: true },
              { active: false }
            );
            await ModAction.create({
              staffDiscordId: interaction.user.id,
              staffTag:       interaction.user.tag,
              robloxUsername: username,
              robloxUserId:   String(userId),
              action:         'UNBAN',
              game,
              reason,
            });
            await sendLogToChannel(
              new EmbedBuilder().setTitle('🔓 Joueur Débanni').setColor(0x2ecc71).setThumbnail(IMAGE)
                .addFields(
                  { name: 'Utilisateur', value: username, inline: true },
                  { name: 'Jeu',         value: gameLabel, inline: true },
                  { name: 'Débanni par', value: '<@' + interaction.user.id + '>', inline: true },
                  { name: 'Raison',      value: reason },
                ).setTimestamp().setFooter({ text: 'Stradaz Cafe - Système de Bannissement', iconURL: IMAGE })
            );
            return interaction.editReply({
              embeds: [successEmbed(`**${username}** a été débanni du **${gameLabel}**.`)],
              components: [],
            });
          } else {
            const durationStr = expiresAt ? `${Math.round((expiresAt - Date.now()) / 3600000)}s` : null;
            await banFromRoblox(userId, universeId, reason, durationStr);
            await Ban.create({
              robloxUsername: username.toLowerCase(),
              robloxUserId:   String(userId),
              game, reason,
              bannedBy:   interaction.user.tag,
              bannedById: interaction.user.id,
              expiresAt:  expiresAt || null,
            });
            await ModAction.create({
              staffDiscordId: interaction.user.id,
              staffTag:       interaction.user.tag,
              robloxUsername: username,
              robloxUserId:   String(userId),
              action:         expiresAt ? 'TEMPBAN' : 'BAN',
              game,
              reason,
            });
            await sendLogToChannel(
              new EmbedBuilder().setTitle('🔨 Joueur Banni').setColor(0xff4444).setThumbnail(IMAGE)
                .addFields(
                  { name: 'Utilisateur', value: username, inline: true },
                  { name: 'Jeu',         value: gameLabel, inline: true },
                  { name: 'Banni par',   value: '<@' + interaction.user.id + '>', inline: true },
                  { name: 'Raison',      value: reason },
                  { name: 'Expire',      value: expiresAt ? new Date(expiresAt).toLocaleString('fr-FR') : 'Jamais' },
                ).setTimestamp().setFooter({ text: 'Stradaz Cafe - Système de Bannissement', iconURL: IMAGE })
            );
            return interaction.editReply({
              embeds: [
                new EmbedBuilder().setTitle('🔨 Bannissement Confirmé').setColor(0xff4444).setThumbnail(IMAGE)
                  .addFields(
                    { name: 'Utilisateur', value: username, inline: true },
                    { name: 'Jeu',         value: gameLabel, inline: true },
                    { name: 'Raison',      value: reason },
                    { name: 'Expire',      value: expiresAt ? new Date(expiresAt).toLocaleString('fr-FR') : 'Jamais' },
                    { name: 'Banni par',   value: '<@' + interaction.user.id + '>' },
                  ).setTimestamp().setFooter({ text: 'Stradaz Cafe - Système de Bannissement', iconURL: IMAGE })
              ],
              components: [],
            });
          }
        } catch (err) {
          return interaction.editReply({ embeds: [errorEmbed('Échec : ' + err.message)], components: [] });
        }
      }

      // Announce confirm
      if (action === 'confirmer_announce') {
        await interaction.deferUpdate();
        try {
          const { universeId, message, gameLabel } = pending;
          await sendMessagingServiceMessage(universeId, 'StaffAnnounce', message);
          await sendLogToChannel(baseEmbed()
            .setDescription('📢 Annonce envoyée')
            .addFields(
              { name: 'Jeu',        value: gameLabel },
              { name: 'Message',    value: message },
              { name: 'Envoyé par', value: '<@' + pending.requesterId + '>' }
            )
          );
          return interaction.editReply({
            embeds: [successEmbed(`Annonce envoyée dans **${gameLabel}** !\n> ${message}`)],
            components: [],
          });
        } catch (err) {
          return interaction.editReply({ embeds: [errorEmbed('Échec envoi : ' + err.message)], components: [] });
        }
      }

      return;
    }

    // ── Slash Commands ───────────────────────────────────────────────────────
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    // ── GLOBAL PERMISSION GATE ── Every slash command requires global perm
    if (await guardGlobal(interaction)) return;

    // ─────────────────────────────────────────────────────────────────────────
    // /checkrank
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'checkrank') {
      await interaction.deferReply();
      try {
        const username   = interaction.options.getString('username');
        const robloxUser = await getRobloxUserByUsername(username);
        const [role, avatar] = await Promise.all([
          getUserGroupRole(robloxUser.id),
          getRobloxAvatar(robloxUser.id),
        ]);
        const embed = baseEmbed()
          .setTitle(`Rang de ${robloxUser.name}`)
          .addFields(
            { name: 'Utilisateur',    value: robloxUser.name },
            { name: 'Nom affiché',    value: robloxUser.displayName || robloxUser.name },
            { name: 'Rang actuel',    value: role?.name ?? 'Pas dans le groupe', inline: true },
            { name: 'Numéro de rang', value: role ? String(role.rank) : 'N/A', inline: true }
          );
        if (avatar) embed.setThumbnail(avatar);
        return interaction.editReply({ embeds: [embed] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /promote
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'promote') {
      await interaction.deferReply();
      try {
        const username   = interaction.options.getString('username');
        const reason     = interaction.options.getString('raison') || 'Promotion';
        const robloxUser = await getRobloxUserByUsername(username);
        const roles      = (await getGroupRoles()).sort((a, b) => a.rank - b.rank);
        const oldRole    = await getUserGroupRole(robloxUser.id);
        if (!oldRole) return interaction.editReply({ embeds: [errorEmbed(robloxUser.name + " n'est pas dans le groupe.")] });
        const idx = roles.findIndex(r => r.id === oldRole.id);
        if (idx === -1 || idx >= roles.length - 1)
          return interaction.editReply({ embeds: [errorEmbed(robloxUser.name + ' est déjà au rang le plus élevé.')] });
        const newRole  = roles[idx + 1];
        const changeId = interaction.id + '-' + Date.now();
        pendingChanges.set(changeId, { userId: robloxUser.id, newRoleId: newRole.id, robloxUser, oldRole, newRole, reason, requesterId: interaction.user.id, auditAction: 'PROMOTE' });
        setTimeout(() => pendingChanges.delete(changeId), 60000);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('confirmer::' + changeId).setLabel('✅ Confirmer').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('annuler::' + changeId).setLabel('❌ Annuler').setStyle(ButtonStyle.Danger)
        );
        return interaction.editReply({ embeds: [baseEmbed().setTitle('Confirmer la Promotion').addFields(
          { name: 'Utilisateur', value: robloxUser.name },
          { name: 'Ancien rang', value: oldRole.name, inline: true },
          { name: 'Nouveau rang', value: newRole.name, inline: true },
          { name: 'Raison',      value: reason }
        )], components: [row] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /demote
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'demote') {
      await interaction.deferReply();
      try {
        const username   = interaction.options.getString('username');
        const reason     = interaction.options.getString('raison') || 'Rétrogradation';
        const robloxUser = await getRobloxUserByUsername(username);
        const roles      = (await getGroupRoles()).sort((a, b) => a.rank - b.rank);
        const oldRole    = await getUserGroupRole(robloxUser.id);
        if (!oldRole) return interaction.editReply({ embeds: [errorEmbed(robloxUser.name + " n'est pas dans le groupe.")] });
        const idx = roles.findIndex(r => r.id === oldRole.id);
        if (idx <= 0)
          return interaction.editReply({ embeds: [errorEmbed(robloxUser.name + ' est déjà au rang le plus bas.')] });
        const newRole  = roles[idx - 1];
        const changeId = interaction.id + '-' + Date.now();
        pendingChanges.set(changeId, { userId: robloxUser.id, newRoleId: newRole.id, robloxUser, oldRole, newRole, reason, requesterId: interaction.user.id, auditAction: 'DEMOTE' });
        setTimeout(() => pendingChanges.delete(changeId), 60000);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('confirmer::' + changeId).setLabel('✅ Confirmer').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('annuler::' + changeId).setLabel('❌ Annuler').setStyle(ButtonStyle.Secondary)
        );
        return interaction.editReply({ embeds: [baseEmbed().setTitle('⬇️ Confirmer la Rétrogradation').addFields(
          { name: 'Utilisateur', value: robloxUser.name },
          { name: 'Ancien rang', value: oldRole.name, inline: true },
          { name: 'Nouveau rang', value: newRole.name, inline: true },
          { name: 'Raison',      value: reason }
        )], components: [row] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /setrank
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'setrank') {
      await interaction.deferReply();
      try {
        const username   = interaction.options.getString('username');
        const rankName   = interaction.options.getString('rang');
        const robloxUser = await getRobloxUserByUsername(username);
        const roles      = await getGroupRoles();
        const newRole    = roles.find(r => r.name.toLowerCase() === rankName.toLowerCase());
        if (!newRole)
          return interaction.editReply({ embeds: [errorEmbed('Rang introuvable. Disponibles : ' + roles.map(r => r.name).join(', '))] });
        const oldRole  = await getUserGroupRole(robloxUser.id);
        const changeId = interaction.id + '-' + Date.now();
        pendingChanges.set(changeId, { userId: robloxUser.id, newRoleId: newRole.id, robloxUser, oldRole, newRole, reason: 'Définition manuelle', requesterId: interaction.user.id, auditAction: 'SETRANK' });
        setTimeout(() => pendingChanges.delete(changeId), 60000);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('confirmer::' + changeId).setLabel('✅ Confirmer').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('annuler::' + changeId).setLabel('❌ Annuler').setStyle(ButtonStyle.Danger)
        );
        return interaction.editReply({ embeds: [baseEmbed().setTitle('Confirmer le Changement de Rang').addFields(
          { name: 'Utilisateur', value: robloxUser.name },
          { name: 'Rang actuel', value: oldRole?.name ?? 'Invité', inline: true },
          { name: 'Nouveau rang', value: newRole.name, inline: true }
        )], components: [row] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /massrank
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'massrank') {
      await interaction.deferReply();
      try {
        const usernamesRaw = interaction.options.getString('usernames');
        const rankName     = interaction.options.getString('rang');
        const reason       = interaction.options.getString('raison') || 'Mass rank';
        const usernames    = usernamesRaw.split(',').map(u => u.trim()).filter(Boolean);
        if (usernames.length === 0) return interaction.editReply({ embeds: [errorEmbed('Aucun nom fourni.')] });
        if (usernames.length > 20)  return interaction.editReply({ embeds: [errorEmbed('Maximum 20 utilisateurs à la fois.')] });

        const roles   = await getGroupRoles();
        const newRole = roles.find(r => r.name.toLowerCase() === rankName.toLowerCase());
        if (!newRole)
          return interaction.editReply({ embeds: [errorEmbed('Rang introuvable. Disponibles : ' + roles.map(r => r.name).join(', '))] });

        const results = { success: [], failed: [] };
        for (const username of usernames) {
          try {
            const robloxUser = await getRobloxUserByUsername(username);
            const oldRole    = await getUserGroupRole(robloxUser.id);
            await setGroupRank(robloxUser.id, newRole.id);
            await RankLog.create({
              staffDiscordId: interaction.user.id, staffTag: interaction.user.tag,
              robloxUsername: robloxUser.name, robloxId: robloxUser.id,
              oldRank: oldRole?.name ?? 'Invité', newRank: newRole.name,
              reason, action: 'SETRANK',
            });
            results.success.push(robloxUser.name);
          } catch (err) {
            results.failed.push(`${username} (${err.message})`);
          }
        }

        const embed = baseEmbed()
          .setTitle(`Mass Rank — ${newRole.name}`)
          .addFields(
            { name: `✅ Réussis (${results.success.length})`, value: results.success.length > 0 ? results.success.join(', ') : 'Aucun', inline: false },
            { name: `❌ Échoués (${results.failed.length})`,  value: results.failed.length  > 0 ? results.failed.join('\n') : 'Aucun', inline: false },
          );
        return interaction.editReply({ embeds: [embed] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /rankhistory
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'rankhistory') {
      await interaction.deferReply();
      try {
        const username = interaction.options.getString('username');
        const logs     = await RankLog.find({ robloxUsername: { $regex: new RegExp('^' + username + '$', 'i') } })
          .sort({ timestamp: -1 }).limit(10);
        if (!logs.length)
          return interaction.editReply({ embeds: [baseEmbed().setDescription(`Aucun historique trouvé pour **${username}**.`)] });
        const lines = logs.map((log, i) => {
          const date = new Date(log.timestamp).toLocaleDateString('fr-FR');
          return `**${i + 1}.** ${log.oldRank} → **${log.newRank}** | \`${log.action}\` | par <@${log.staffDiscordId}> | ${date}`;
        }).join('\n');
        return interaction.editReply({ embeds: [baseEmbed().setTitle(`📋 Historique de ${username}`).setDescription(lines)] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /rankinfo
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'rankinfo') {
      await interaction.deferReply();
      try {
        const rankName = interaction.options.getString('rang');
        const roles    = await getGroupRoles();
        const role     = roles.find(r => r.name.toLowerCase() === rankName.toLowerCase());
        if (!role)
          return interaction.editReply({ embeds: [errorEmbed('Rang introuvable. Disponibles : ' + roles.map(r => r.name).join(', '))] });
        const members = await getGroupMembersByRole(role.id, 5);
        const memberPreview = members.length > 0 ? members.map(m => m.username).join(', ') : 'Aucun';
        return interaction.editReply({ embeds: [baseEmbed()
          .setTitle(`ℹ️ Rang : ${role.name}`)
          .addFields(
            { name: 'Numéro de rang', value: String(role.rank), inline: true },
            { name: 'ID du rang',     value: String(role.id),   inline: true },
            { name: 'Membres (aperçu 5)', value: memberPreview, inline: false },
          )
        ] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /groupmembers
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'groupmembers') {
      await interaction.deferReply();
      try {
        const rankName = interaction.options.getString('rang');
        const roles    = await getGroupRoles();
        const role     = roles.find(r => r.name.toLowerCase() === rankName.toLowerCase());
        if (!role)
          return interaction.editReply({ embeds: [errorEmbed('Rang introuvable. Disponibles : ' + roles.map(r => r.name).join(', '))] });
        const members = await getGroupMembersByRole(role.id, 50);
        if (!members.length)
          return interaction.editReply({ embeds: [baseEmbed().setDescription(`Aucun membre trouvé pour le rang **${role.name}**.`)] });
        const chunks = [];
        for (let i = 0; i < members.length; i += 30) {
          chunks.push(members.slice(i, i + 30).map(m => `\`${m.username}\``).join(', '));
        }
        const embed = baseEmbed()
          .setTitle(`👥 Membres — ${role.name}`)
          .setDescription(chunks[0])
          .addFields({ name: 'Total affiché', value: String(members.length), inline: true });
        return interaction.editReply({ embeds: [embed] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /exileuser
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'exileuser') {
      await interaction.deferReply();
      try {
        const username   = interaction.options.getString('username');
        const reason     = interaction.options.getString('raison') || 'Aucune raison fournie';
        const robloxUser = await getRobloxUserByUsername(username);
        const oldRole    = await getUserGroupRole(robloxUser.id);
        if (!oldRole)
          return interaction.editReply({ embeds: [errorEmbed(robloxUser.name + " n'est pas dans le groupe.")] });
        const changeId = interaction.id + '-' + Date.now();
        pendingChanges.set(changeId, { userId: robloxUser.id, robloxUser, oldRole, reason, requesterId: interaction.user.id });
        setTimeout(() => pendingChanges.delete(changeId), 60000);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('confirmer_exile::' + changeId).setLabel('✅ Confirmer l\'exclusion').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('annuler::' + changeId).setLabel('❌ Annuler').setStyle(ButtonStyle.Secondary)
        );
        return interaction.editReply({ embeds: [baseEmbed().setTitle('🚫 Confirmer l\'Exclusion').addFields(
          { name: 'Utilisateur', value: robloxUser.name },
          { name: 'Rang actuel', value: oldRole.name, inline: true },
          { name: 'Raison',      value: reason }
        )], components: [row] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /setguestrank
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'setguestrank') {
      await interaction.deferReply();
      try {
        const username   = interaction.options.getString('username');
        const reason     = interaction.options.getString('raison') || 'Remise au rang invité';
        const robloxUser = await getRobloxUserByUsername(username);
        const roles      = (await getGroupRoles()).sort((a, b) => a.rank - b.rank);
        const oldRole    = await getUserGroupRole(robloxUser.id);
        const lowestRole = roles[0];
        if (!lowestRole) return interaction.editReply({ embeds: [errorEmbed('Impossible de trouver le rang le plus bas.')] });
        const changeId = interaction.id + '-' + Date.now();
        pendingChanges.set(changeId, { userId: robloxUser.id, newRoleId: lowestRole.id, robloxUser, oldRole, newRole: lowestRole, reason, requesterId: interaction.user.id, auditAction: 'SETRANK' });
        setTimeout(() => pendingChanges.delete(changeId), 60000);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('confirmer::' + changeId).setLabel('✅ Confirmer').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('annuler::' + changeId).setLabel('❌ Annuler').setStyle(ButtonStyle.Secondary)
        );
        return interaction.editReply({ embeds: [baseEmbed().setTitle('⬇️ Remise au rang invité').addFields(
          { name: 'Utilisateur', value: robloxUser.name },
          { name: 'Rang actuel', value: oldRole?.name ?? 'Invité', inline: true },
          { name: 'Nouveau rang', value: lowestRole.name, inline: true },
          { name: 'Raison',      value: reason }
        )], components: [row] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /bulkexile
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'bulkexile') {
      await interaction.deferReply();
      try {
        const usernamesRaw = interaction.options.getString('usernames');
        const reason       = interaction.options.getString('raison') || 'Exclusion en masse';
        const usernames    = usernamesRaw.split(',').map(u => u.trim()).filter(Boolean);
        if (usernames.length === 0) return interaction.editReply({ embeds: [errorEmbed('Aucun nom fourni.')] });
        if (usernames.length > 15)  return interaction.editReply({ embeds: [errorEmbed('Maximum 15 utilisateurs à la fois.')] });

        const results = { success: [], failed: [] };
        for (const username of usernames) {
          try {
            const robloxUser = await getRobloxUserByUsername(username);
            const oldRole    = await getUserGroupRole(robloxUser.id);
            if (!oldRole) { results.failed.push(`${username} (pas dans le groupe)`); continue; }
            await exileFromGroup(robloxUser.id);
            await RankLog.create({
              staffDiscordId: interaction.user.id, staffTag: interaction.user.tag,
              robloxUsername: robloxUser.name, robloxId: robloxUser.id,
              oldRank: oldRole.name, newRank: 'EXCLU', reason, action: 'EXILE',
            });
            results.success.push(robloxUser.name);
          } catch (err) {
            results.failed.push(`${username} (${err.message})`);
          }
        }
        return interaction.editReply({ embeds: [baseEmbed()
          .setTitle('🚫 Exclusion en Masse')
          .addFields(
            { name: `✅ Exclus (${results.success.length})`,  value: results.success.length > 0 ? results.success.join(', ') : 'Aucun' },
            { name: `❌ Échoués (${results.failed.length})`,  value: results.failed.length  > 0 ? results.failed.join('\n') : 'Aucun' },
          )
        ] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /groupstats
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'groupstats') {
      await interaction.deferReply();
      try {
        const roles = (await getGroupRoles()).sort((a, b) => b.rank - a.rank);
        const lines = roles.map(r => `**${r.name}** (Rang ${r.rank}) — \`${r.memberCount ?? '?'}\` membre(s)`).join('\n');
        return interaction.editReply({ embeds: [baseEmbed()
          .setTitle('📊 Statistiques du Groupe')
          .setDescription(lines || 'Aucun rang trouvé.')
        ] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /rankcompare
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'rankcompare') {
      await interaction.deferReply();
      try {
        const user1name = interaction.options.getString('user1');
        const user2name = interaction.options.getString('user2');
        const [u1, u2] = await Promise.all([
          getRobloxUserByUsername(user1name),
          getRobloxUserByUsername(user2name),
        ]);
        const [role1, role2] = await Promise.all([
          getUserGroupRole(u1.id),
          getUserGroupRole(u2.id),
        ]);
        const r1 = role1?.rank ?? 0;
        const r2 = role2?.rank ?? 0;
        const comparison = r1 > r2 ? `**${u1.name}** a un rang plus élevé.`
          : r1 < r2 ? `**${u2.name}** a un rang plus élevé.`
          : 'Les deux ont le même rang.';
        return interaction.editReply({ embeds: [baseEmbed()
          .setTitle('⚖️ Comparaison de Rangs')
          .addFields(
            { name: u1.name, value: role1?.name ?? 'Pas dans le groupe', inline: true },
            { name: u2.name, value: role2?.name ?? 'Pas dans le groupe', inline: true },
            { name: 'Résultat', value: comparison }
          )
        ] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /ranklog
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'ranklog') {
      await interaction.deferReply();
      try {
        const page     = Math.max(1, interaction.options.getInteger('page') || 1);
        const PER_PAGE = 10;
        const total    = await RankLog.countDocuments();
        if (!total) return interaction.editReply({ embeds: [baseEmbed().setDescription('Aucun changement de rang enregistré.')] });
        const totalPages = Math.ceil(total / PER_PAGE);
        const pageNum    = Math.min(page, totalPages);
        const logs = await RankLog.find().sort({ timestamp: -1 }).skip((pageNum - 1) * PER_PAGE).limit(PER_PAGE);
        const lines = logs.map((log, i) => {
          const date = new Date(log.timestamp).toLocaleDateString('fr-FR');
          return `**${(pageNum - 1) * PER_PAGE + i + 1}.** \`${log.robloxUsername}\` — ${log.oldRank} → **${log.newRank}**\n> par <@${log.staffDiscordId}> · ${date}`;
        }).join('\n\n');
        return interaction.editReply({ embeds: [baseEmbed()
          .setTitle(`Journal des Rangs — Page ${pageNum}/${totalPages}`)
          .setDescription(lines)
          .setFooter({ text: `Stradaz Cafe — ${total} entrées au total`, iconURL: IMAGE })
        ] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /logstats
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'logstats') {
      await interaction.deferReply();
      try {
        const total = await RankLog.countDocuments();
        if (!total) return interaction.editReply({ embeds: [baseEmbed().setDescription('Aucun journal.')] });
        const staffAgg = await RankLog.aggregate([
          { $group: { _id: '$staffDiscordId', count: { $sum: 1 } } },
          { $sort: { count: -1 } }, { $limit: 5 },
        ]);
        const rankAgg = await RankLog.aggregate([
          { $group: { _id: '$newRank', count: { $sum: 1 } } },
          { $sort: { count: -1 } }, { $limit: 5 },
        ]);
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const todayCount = await RankLog.countDocuments({ timestamp: { $gte: todayStart } });
        return interaction.editReply({ embeds: [baseEmbed()
          .setTitle('📊 Statistiques du Journal')
          .addFields(
            { name: 'Total',               value: String(total),      inline: true },
            { name: "Aujourd'hui",          value: String(todayCount), inline: true },
            { name: 'Top Staff',            value: staffAgg.map((s, i) => `**${i+1}.** <@${s._id}> — ${s.count}`).join('\n') || 'Aucun' },
            { name: 'Rangs les plus donnés', value: rankAgg.map((r, i) => `**${i+1}.** ${r._id} — ${r.count} fois`).join('\n') || 'Aucun' }
          )
        ] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /clearlog
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'clearlog') {
      const changeId = interaction.id + '-' + Date.now();
      pendingChanges.set(changeId, { requesterId: interaction.user.id });
      setTimeout(() => pendingChanges.delete(changeId), 30000);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirmer_clearlog::' + changeId).setLabel('🗑️ Tout effacer').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('annuler::' + changeId).setLabel('❌ Annuler').setStyle(ButtonStyle.Secondary)
      );
      return interaction.reply({
        embeds: [baseEmbed().setDescription('⚠️ Êtes-vous sûr de vouloir effacer **tout** le journal ? Cette action est **irréversible**.')],
        components: [row], ephemeral: true,
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /rban
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'rban') {
      if (!OPEN_CLOUD_API_KEY)
        return interaction.reply({ embeds: [errorEmbed("OPEN_CLOUD_API_KEY manquant.")], ephemeral: true });
      await interaction.deferReply();
      try {
        const type       = interaction.options.getString('type');
        const username   = interaction.options.getString('username');
        const game       = interaction.options.getString('game');
        const reason     = interaction.options.getString('reason') || 'Aucune raison fournie';
        const gameLabel  = game === 'main' ? 'Main Game' : 'Training Center';
        const universeId = game === 'main' ? MAIN_UNIVERSE_ID : TRAINING_UNIVERSE_ID;
        if (!universeId)
          return interaction.editReply({ embeds: [errorEmbed(`Universe ID pour **${gameLabel}** manquant dans les variables d'environnement.`)] });

        const robloxUser = await getRobloxUserByUsername(username);
        const [dbBan, isBannedInGame] = await Promise.all([
          Ban.findOne({ robloxUsername: username.toLowerCase(), game, active: true }),
          getRobloxBanStatus(robloxUser.id, universeId),
        ]);

        if (isBannedInGame && !dbBan) {
          await Ban.create({ robloxUsername: username.toLowerCase(), robloxUserId: String(robloxUser.id), game, reason: 'Ban détecté (sync)', bannedBy: 'Roblox', bannedById: '0' });
        }
        if (!isBannedInGame && dbBan) {
          await Ban.findOneAndUpdate({ robloxUsername: username.toLowerCase(), game, active: true }, { active: false });
        }

        if (type === 'ban') {
          if (isBannedInGame)
            return interaction.editReply({ embeds: [errorEmbed(`**${username}** est déjà banni du **${gameLabel}**.\n> Raison : ${dbBan?.reason || 'Inconnue'}`)] });
          const changeId = interaction.id + '-' + Date.now();
          pendingChanges.set(changeId, { type: 'ban', username, userId: robloxUser.id, game, reason, gameLabel, universeId, requesterId: interaction.user.id });
          setTimeout(() => pendingChanges.delete(changeId), 60000);
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('confirmer_ban::' + changeId).setLabel('✅ Confirmer le Ban').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('annuler::' + changeId).setLabel('❌ Annuler').setStyle(ButtonStyle.Secondary)
          );
          return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🔨 Confirmer le Bannissement').setColor(0xff8800).setThumbnail(IMAGE)
            .setDescription('Êtes-vous sûr de vouloir bannir **définitivement** ce joueur ?')
            .addFields(
              { name: 'Utilisateur', value: username, inline: true },
              { name: 'Jeu',         value: gameLabel, inline: true },
              { name: 'Raison',      value: reason },
            ).setTimestamp().setFooter({ text: 'Stradaz Cafe - Système de Bannissement', iconURL: IMAGE })],
            components: [row] });
        }

        if (type === 'unban') {
          if (!isBannedInGame)
            return interaction.editReply({ embeds: [errorEmbed(`**${username}** n'est pas banni du **${gameLabel}**.`)] });
          const existing = await Ban.findOne({ robloxUsername: username.toLowerCase(), game, active: true });
          const changeId = interaction.id + '-' + Date.now();
          pendingChanges.set(changeId, { type: 'unban', username, userId: robloxUser.id, game, reason, gameLabel, universeId, requesterId: interaction.user.id });
          setTimeout(() => pendingChanges.delete(changeId), 60000);
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('confirmer_ban::' + changeId).setLabel('✅ Confirmer le Unban').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('annuler::' + changeId).setLabel('❌ Annuler').setStyle(ButtonStyle.Secondary)
          );
          return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🔓 Confirmer le Débannissement').setColor(0x2ecc71).setThumbnail(IMAGE)
            .setDescription('Êtes-vous sûr de vouloir débannir ce joueur ?')
            .addFields(
              { name: 'Utilisateur', value: username, inline: true },
              { name: 'Jeu',         value: gameLabel, inline: true },
              { name: 'Banni pour',  value: existing?.reason ?? 'Inconnue' },
              { name: 'Raison unban', value: reason },
            ).setTimestamp().setFooter({ text: 'Stradaz Cafe - Système de Bannissement', iconURL: IMAGE })],
            components: [row] });
        }
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /tempban
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'tempban') {
      if (!OPEN_CLOUD_API_KEY)
        return interaction.reply({ embeds: [errorEmbed("OPEN_CLOUD_API_KEY manquant.")], ephemeral: true });
      await interaction.deferReply();
      try {
        const username   = interaction.options.getString('username');
        const game       = interaction.options.getString('game');
        const heures     = interaction.options.getInteger('heures');
        const reason     = interaction.options.getString('reason') || 'Bannissement temporaire';
        const gameLabel  = game === 'main' ? 'Main Game' : 'Training Center';
        const universeId = game === 'main' ? MAIN_UNIVERSE_ID : TRAINING_UNIVERSE_ID;
        if (!universeId)
          return interaction.editReply({ embeds: [errorEmbed(`Universe ID pour **${gameLabel}** manquant.`)] });
        if (heures < 1 || heures > 8760)
          return interaction.editReply({ embeds: [errorEmbed('La durée doit être entre 1 et 8760 heures (1 an).')] });

        const robloxUser = await getRobloxUserByUsername(username);
        const isBanned   = await getRobloxBanStatus(robloxUser.id, universeId);
        if (isBanned)
          return interaction.editReply({ embeds: [errorEmbed(`**${username}** est déjà banni du **${gameLabel}**.`)] });

        const expiresAt = new Date(Date.now() + heures * 3600 * 1000);
        const changeId  = interaction.id + '-' + Date.now();
        pendingChanges.set(changeId, { type: 'ban', username, userId: robloxUser.id, game, reason, gameLabel, universeId, expiresAt, requesterId: interaction.user.id });
        setTimeout(() => pendingChanges.delete(changeId), 60000);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('confirmer_ban::' + changeId).setLabel('✅ Confirmer').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('annuler::' + changeId).setLabel('❌ Annuler').setStyle(ButtonStyle.Secondary)
        );
        return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('⏱️ Confirmer le Ban Temporaire').setColor(0xff8800).setThumbnail(IMAGE)
          .addFields(
            { name: 'Utilisateur', value: username, inline: true },
            { name: 'Jeu',         value: gameLabel, inline: true },
            { name: 'Durée',       value: `${heures} heure(s)`, inline: true },
            { name: 'Expire le',   value: expiresAt.toLocaleString('fr-FR') },
            { name: 'Raison',      value: reason },
          ).setTimestamp().setFooter({ text: 'Stradaz Cafe - Système de Bannissement', iconURL: IMAGE })],
          components: [row] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /banlist
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'banlist') {
      await interaction.deferReply();
      try {
        const game     = interaction.options.getString('game');
        const page     = Math.max(1, interaction.options.getInteger('page') || 1);
        const PER_PAGE = 10;
        const query    = { active: true };
        if (game) query.game = game;
        const total = await Ban.countDocuments(query);
        if (!total) return interaction.editReply({ embeds: [baseEmbed().setDescription('Aucun ban actif' + (game ? ` pour **${game === 'main' ? 'Main Game' : 'Training Center'}**` : '') + '.')] });
        const totalPages = Math.ceil(total / PER_PAGE);
        const pageNum    = Math.min(page, totalPages);
        const bans = await Ban.find(query).sort({ bannedAt: -1 }).skip((pageNum - 1) * PER_PAGE).limit(PER_PAGE);
        const lines = bans.map((b, i) => {
          const date   = new Date(b.bannedAt).toLocaleDateString('fr-FR');
          const expiry = b.expiresAt ? ` | expire ${new Date(b.expiresAt).toLocaleDateString('fr-FR')}` : ' | permanent';
          const game   = b.game === 'main' ? '🎮' : '🏋️';
          return `**${(pageNum - 1) * PER_PAGE + i + 1}.** ${game} \`${b.robloxUsername}\` — ${date}${expiry}\n> ${b.reason}`;
        }).join('\n\n');
        return interaction.editReply({ embeds: [baseEmbed()
          .setTitle(`🔨 Bans Actifs — Page ${pageNum}/${totalPages}`)
          .setDescription(lines)
          .setFooter({ text: `Stradaz Cafe — ${total} bans actifs`, iconURL: IMAGE })
        ] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /baninfo
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'baninfo') {
      await interaction.deferReply();
      try {
        const username = interaction.options.getString('username');
        const game     = interaction.options.getString('game');
        const query    = { robloxUsername: username.toLowerCase() };
        if (game) query.game = game;
        const bans = await Ban.find(query).sort({ bannedAt: -1 }).limit(5);
        if (!bans.length)
          return interaction.editReply({ embeds: [baseEmbed().setDescription(`Aucun ban trouvé pour **${username}**.`)] });
        const embed = baseEmbed().setTitle(`🔍 Infos Ban — ${username}`);
        for (const b of bans) {
          const status = b.active ? '🔴 Actif' : '🟢 Inactif';
          const expiry = b.expiresAt ? new Date(b.expiresAt).toLocaleString('fr-FR') : 'Permanent';
          embed.addFields({
            name:  `${b.game === 'main' ? 'Main Game' : 'Training Center'} — ${status}`,
            value: `**Raison :** ${b.reason}\n**Banni par :** ${b.bannedBy}\n**Date :** ${new Date(b.bannedAt).toLocaleString('fr-FR')}\n**Expire :** ${expiry}`,
          });
        }
        return interaction.editReply({ embeds: [embed] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /modhistory
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'modhistory') {
      await interaction.deferReply();
      try {
        const username = interaction.options.getString('username');
        const actions  = await ModAction.find({ robloxUsername: { $regex: new RegExp('^' + username + '$', 'i') } })
          .sort({ timestamp: -1 }).limit(10);
        if (!actions.length)
          return interaction.editReply({ embeds: [baseEmbed().setDescription(`Aucune action de modération trouvée pour **${username}**.`)] });
        const lines = actions.map((a, i) => {
          const date = new Date(a.timestamp).toLocaleDateString('fr-FR');
          const game = a.game ? ` (${a.game === 'main' ? 'Main' : 'Training'})` : '';
          return `**${i + 1}.** \`${a.action}\`${game} — par <@${a.staffDiscordId}> | ${date}\n> ${a.reason}`;
        }).join('\n\n');
        return interaction.editReply({ embeds: [baseEmbed()
          .setTitle(`Historique Modération — ${username}`)
          .setDescription(lines)
        ] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /banstats
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'banstats') {
      await interaction.deferReply();
      try {
        const totalActive   = await Ban.countDocuments({ active: true });
        const totalInactive = await Ban.countDocuments({ active: false });
        const mainActive    = await Ban.countDocuments({ active: true, game: 'main' });
        const trainActive   = await Ban.countDocuments({ active: true, game: 'training' });
        const tempActive    = await Ban.countDocuments({ active: true, expiresAt: { $ne: null } });
        const permActive    = await Ban.countDocuments({ active: true, expiresAt: null });
        const topBanners    = await Ban.aggregate([
          { $match: { bannedById: { $ne: '0' } } },
          { $group: { _id: '$bannedById', count: { $sum: 1 } } },
          { $sort: { count: -1 } }, { $limit: 5 },
        ]);
        return interaction.editReply({ embeds: [baseEmbed()
          .setTitle('📊 Statistiques des Bans')
          .addFields(
            { name: 'Bans actifs',      value: String(totalActive),   inline: true },
            { name: 'Bans expirés',     value: String(totalInactive), inline: true },
            { name: 'Main (actif)',      value: String(mainActive),    inline: true },
            { name: 'Training (actif)', value: String(trainActive),   inline: true },
            { name: '⏱Temporaires',      value: String(tempActive),    inline: true },
            { name: 'Permanents',       value: String(permActive),    inline: true },
            { name: 'Top Banisseurs',   value: topBanners.map((b, i) => `**${i+1}.** <@${b._id}> — ${b.count}`).join('\n') || 'Aucun' },
          )
        ] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /serverstatus
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'serverstatus') {
      await interaction.deferReply();
      try {
        const game       = interaction.options.getString('game');
        const gameLabel  = game === 'main' ? 'Main Game' : 'Training Center';
        const universeId = game === 'main' ? MAIN_UNIVERSE_ID : TRAINING_UNIVERSE_ID;
        if (!universeId) return interaction.editReply({ embeds: [errorEmbed(`Universe ID pour **${gameLabel}** manquant.`)] });

        const [servers, gameInfo] = await Promise.all([
          getRobloxServers(universeId, 10),
          getGameInfo(universeId),
        ]);

        const totalPlayers = servers.reduce((acc, s) => acc + (s.playing || 0), 0);
        const totalServers = servers.length;

        const serverLines = servers.slice(0, 8).map((s, i) =>
          `**${i + 1}.** \`${s.id?.slice(0, 16) || 'N/A'}...\` — **${s.playing || 0}/${s.maxPlayers || '?'}** joueurs`
        ).join('\n') || 'Aucun serveur actif';

        const embed = baseEmbed()
          .setTitle(`🌐 Statut des Serveurs — ${gameLabel}`)
          .addFields(
            { name: 'Joueurs en ligne', value: String(totalPlayers), inline: true },
            { name: 'Serveurs actifs',  value: String(totalServers), inline: true },
            { name: 'Jeu',              value: gameInfo?.name || gameLabel, inline: true },
            { name: 'Serveurs',         value: serverLines }
          );
        return interaction.editReply({ embeds: [embed] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /serverlist
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'serverlist') {
      await interaction.deferReply();
      try {
        const game       = interaction.options.getString('game');
        const gameLabel  = game === 'main' ? 'Main Game' : 'Training Center';
        const universeId = game === 'main' ? MAIN_UNIVERSE_ID : TRAINING_UNIVERSE_ID;
        const placeId    = game === 'main' ? MAIN_PLACE_ID    : TRAINING_PLACE_ID;
        if (!universeId) return interaction.editReply({ embeds: [errorEmbed(`Universe ID pour **${gameLabel}** manquant.`)] });

        const servers = await getRobloxServers(universeId, 20);
        if (!servers.length)
          return interaction.editReply({ embeds: [baseEmbed().setDescription(`Aucun serveur actif pour **${gameLabel}**.`)] });

        const lines = servers.map((s, i) => {
          const link = placeId
            ? `[Rejoindre](roblox://experiences/start?placeId=${placeId}&gameInstanceId=${s.id})`
            : `\`${s.id}\``;
          return `**${i + 1}.** ${link} — **${s.playing || 0}/${s.maxPlayers || '?'}** joueurs`;
        }).join('\n');

        return interaction.editReply({ embeds: [baseEmbed()
          .setTitle(`Liste des Serveurs — ${gameLabel}`)
          .setDescription(lines)
          .setFooter({ text: `${servers.length} serveur(s) trouvé(s)`, iconURL: IMAGE })
        ] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /getserverinfo
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'getserverinfo') {
      await interaction.deferReply();
      try {
        const jobId      = interaction.options.getString('jobid');
        const game       = interaction.options.getString('game');
        const gameLabel  = game === 'main' ? 'Main Game' : 'Training Center';
        const universeId = game === 'main' ? MAIN_UNIVERSE_ID : TRAINING_UNIVERSE_ID;
        const placeId    = game === 'main' ? MAIN_PLACE_ID    : TRAINING_PLACE_ID;
        if (!universeId) return interaction.editReply({ embeds: [errorEmbed(`Universe ID pour **${gameLabel}** manquant.`)] });

        const servers = await getRobloxServers(universeId, 100);
        const server  = servers.find(s => s.id === jobId);
        if (!server)
          return interaction.editReply({ embeds: [errorEmbed(`Serveur \`${jobId}\` introuvable ou hors ligne.`)] });

        const joinLink = placeId
          ? `roblox://experiences/start?placeId=${placeId}&gameInstanceId=${server.id}`
          : `roblox://experiences/start?gameInstanceId=${server.id}`;

        return interaction.editReply({ embeds: [baseEmbed()
          .setTitle(`🔍 Info Serveur — ${gameLabel}`)
          .addFields(
            { name: 'Job ID',          value: `\`${server.id}\``, inline: false },
            { name: 'Joueurs',      value: `${server.playing || 0}/${server.maxPlayers || '?'}`, inline: true },
            { name: 'Ping',         value: server.ping != null ? `${server.ping}ms` : 'N/A', inline: true },
            { name: 'Rejoindre',    value: `[Cliquez ici](${joinLink})`, inline: false },
          )
        ] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /announce
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'announce') {
      await interaction.deferReply();
      try {
        const game       = interaction.options.getString('game');
        const message    = interaction.options.getString('message');
        const gameLabel  = game === 'main' ? 'Main Game' : 'Training Center';
        const universeId = game === 'main' ? MAIN_UNIVERSE_ID : TRAINING_UNIVERSE_ID;
        if (!universeId)
          return interaction.editReply({ embeds: [errorEmbed(`Universe ID pour **${gameLabel}** manquant.`)] });
        if (message.length > 300)
          return interaction.editReply({ embeds: [errorEmbed('Le message ne peut pas dépasser 300 caractères.')] });

        const changeId = interaction.id + '-' + Date.now();
        pendingChanges.set(changeId, { universeId, message, gameLabel, requesterId: interaction.user.id });
        setTimeout(() => pendingChanges.delete(changeId), 60000);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('confirmer_announce::' + changeId).setLabel('📢 Envoyer').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('annuler::' + changeId).setLabel('❌ Annuler').setStyle(ButtonStyle.Secondary)
        );
        return interaction.editReply({ embeds: [baseEmbed()
          .setTitle('📢 Confirmer l\'Annonce')
          .addFields(
            { name: 'Jeu',     value: gameLabel },
            { name: 'Message', value: message },
            { name: 'Note', value: 'Votre jeu Roblox doit avoir un script écoutant le topic `StaffAnnounce` pour afficher le message en jeu.' }
          )
        ], components: [row] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /profile
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'profile') {
      await interaction.deferReply();
      try {
        const username   = interaction.options.getString('username');
        const robloxUser = await getRobloxUserByUsername(username);
        const [role, avatar] = await Promise.all([
          getUserGroupRole(robloxUser.id),
          getRobloxAvatar(robloxUser.id),
        ]);
        const createdAt = robloxUser.created
          ? new Date(robloxUser.created).toLocaleDateString('fr-FR')
          : 'Inconnue';
        const activeBan = await Ban.findOne({ robloxUserId: String(robloxUser.id), active: true });

        const embed = new EmbedBuilder()
          .setTitle(`👤 Profil — ${robloxUser.name}`)
          .setColor(0x5865f2)
          .setThumbnail(avatar || IMAGE)
          .addFields(
            { name: 'Nom affiché',   value: robloxUser.displayName || robloxUser.name, inline: true },
            { name: 'ID Roblox',     value: String(robloxUser.id), inline: true },
            { name: 'Rang Groupe',   value: role?.name ?? 'Pas dans le groupe', inline: true },
            { name: 'Compte créé le', value: createdAt, inline: true },
            { name: 'Statut Ban',    value: activeBan ? `🔴 Banni (${activeBan.game === 'main' ? 'Main' : 'Training'})` : '🟢 Non banni', inline: true },
          )
          .setTimestamp()
          .setFooter({ text: 'Stradaz Cafe — Profil Joueur', iconURL: IMAGE });
        return interaction.editReply({ embeds: [embed] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /badges
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'badges') {
      await interaction.deferReply();
      try {
        const username   = interaction.options.getString('username');
        const game       = interaction.options.getString('game') || 'main';
        const gameLabel  = game === 'main' ? 'Main Game' : 'Training Center';
        const universeId = game === 'main' ? MAIN_UNIVERSE_ID : TRAINING_UNIVERSE_ID;
        if (!universeId) return interaction.editReply({ embeds: [errorEmbed(`Universe ID pour **${gameLabel}** manquant.`)] });

        const robloxUser = await getRobloxUserByUsername(username);
        const owned      = await getUserBadges(robloxUser.id, universeId);

        const embed = baseEmbed()
          .setTitle(`Badges — ${robloxUser.name} (${gameLabel})`)
          .setDescription(owned.length > 0
            ? owned.map(b => `**${b.name}**`).join('\n')
            : 'Aucun badge trouvé pour ce joueur dans ce jeu.'
          );
        return interaction.editReply({ embeds: [embed] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /playtime
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'playtime') {
      await interaction.deferReply();
      try {
        const username   = interaction.options.getString('username');
        const robloxUser = await getRobloxUserByUsername(username);
        const sessions   = await MRSession.find({ robloxId: String(robloxUser.id), durationMs: { $ne: null } });
        const totalMs      = sessions.reduce((acc, s) => acc + (s.durationMs || 0), 0);
        const sessionCount = sessions.length;
        const recent = [...sessions]
          .sort((a, b) => new Date(b.joinedAt) - new Date(a.joinedAt))
          .slice(0, 3);
        const recentLines = recent.length > 0
          ? recent.map(s => {
              const date = new Date(s.joinedAt).toLocaleDateString('fr-FR');
              return `\`${date}\` — **${formatDuration(s.durationMs)}**`;
            }).join('\n')
          : 'Aucune session enregistrée';
        const avatar = await getRobloxAvatar(robloxUser.id);
        return interaction.editReply({ embeds: [new EmbedBuilder()
          .setTitle(`⏱️ Temps de Jeu — ${robloxUser.name}`)
          .setColor(0x5865f2)
          .setThumbnail(avatar || IMAGE)
          .addFields(
            { name: 'Temps total',         value: formatDuration(totalMs) || '0m', inline: true },
            { name: 'Sessions',             value: String(sessionCount),             inline: true },
            { name: 'Moy. par session',     value: sessionCount > 0 ? formatDuration(totalMs / sessionCount) : 'N/A', inline: true },
            { name: '3 dernières sessions', value: recentLines }
          )
          .setTimestamp()
          .setFooter({ text: 'Stradaz Cafe – Suivi Temps de Jeu', iconURL: IMAGE })
        ] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /joindate
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'joindate') {
      await interaction.deferReply();
      try {
        const username   = interaction.options.getString('username');
        const robloxUser = await getRobloxUserByUsername(username);
        const fullUser   = await getRobloxUserById(robloxUser.id);
        const avatar     = await getRobloxAvatar(robloxUser.id);
        const createdAt  = fullUser.created
          ? new Date(fullUser.created)
          : null;
        const ageMs  = createdAt ? Date.now() - createdAt.getTime() : null;
        const ageDays = ageMs ? Math.floor(ageMs / 86400000) : null;
        return interaction.editReply({ embeds: [baseEmbed()
          .setTitle(`📅 Date de Création — ${robloxUser.name}`)
          .setThumbnail(avatar || IMAGE)
          .addFields(
            { name: 'Compte créé le', value: createdAt ? createdAt.toLocaleDateString('fr-FR') : 'Inconnue', inline: true },
            { name: 'Âge du compte',  value: ageDays != null ? `${ageDays} jour(s)` : 'Inconnu', inline: true },
          )
        ] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /inventory
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'inventory') {
      await interaction.deferReply();
      try {
        const username   = interaction.options.getString('username');
        const robloxUser = await getRobloxUserByUsername(username);
        const passes     = await getGamePasses();
        if (!passes.length)
          return interaction.editReply({ embeds: [errorEmbed('Aucun gamepass trouvé pour ce jeu.')] });

        const results = [];
        for (const pass of passes) {
          const owns = await userOwnsGamePass(robloxUser.id, pass.id);
          results.push({ name: pass.name, owns });
        }
        const owned    = results.filter(r => r.owns).map(r => `✅ ${r.name}`);
        const notOwned = results.filter(r => !r.owns).map(r => `❌ ${r.name}`);
        const avatar   = await getRobloxAvatar(robloxUser.id);
        return interaction.editReply({ embeds: [baseEmbed()
          .setTitle(`Inventaire — ${robloxUser.name}`)
          .setThumbnail(avatar || IMAGE)
          .addFields(
            { name: `✅ Possédés (${owned.length})`,      value: owned.length    > 0 ? owned.join('\n')    : 'Aucun', inline: true },
            { name: `❌ Non possédés (${notOwned.length})`, value: notOwned.length > 0 ? notOwned.join('\n') : 'Aucun', inline: true },
          )
        ] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /online
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'online') {
      await interaction.deferReply();
      try {
        const username   = interaction.options.getString('username');
        const robloxUser = await getRobloxUserByUsername(username);

        // Check for an open session in DB (most reliable for tracked staff)
        const openSession = await MRSession.findOne({ robloxId: String(robloxUser.id), leftAt: null });
        const avatar      = await getRobloxAvatar(robloxUser.id);
        const status      = openSession
          ? `✅ **${robloxUser.name}** est actuellement en ligne dans le jeu.\n> Session démarrée à \`${new Date(openSession.joinedAt).toLocaleTimeString('fr-FR')}\``
          : `❌ **${robloxUser.name}** n'est pas détecté en ligne dans le jeu.`;
        return interaction.editReply({ embeds: [baseEmbed()
          .setTitle(`🟢 Statut en Ligne — ${robloxUser.name}`)
          .setThumbnail(avatar || IMAGE)
          .setDescription(status)
        ] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /lastseen
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'lastseen') {
      await interaction.deferReply();
      try {
        const username   = interaction.options.getString('username');
        const robloxUser = await getRobloxUserByUsername(username);
        const lastSession = await MRSession.findOne({ robloxId: String(robloxUser.id), leftAt: { $ne: null } })
          .sort({ leftAt: -1 });
        const avatar = await getRobloxAvatar(robloxUser.id);
        if (!lastSession)
          return interaction.editReply({ embeds: [baseEmbed()
            .setTitle(`Dernière Vue — ${robloxUser.name}`)
            .setThumbnail(avatar || IMAGE)
            .setDescription('Aucune session enregistrée pour ce joueur.')
          ] });
        const leftAt   = new Date(lastSession.leftAt);
        const joinedAt = new Date(lastSession.joinedAt);
        return interaction.editReply({ embeds: [baseEmbed()
          .setTitle(`Dernière Vue — ${robloxUser.name}`)
          .setThumbnail(avatar || IMAGE)
          .addFields(
            { name: 'Dernière session',  value: joinedAt.toLocaleString('fr-FR'), inline: true },
            { name: 'Déconnexion',       value: leftAt.toLocaleString('fr-FR'),   inline: true },
            { name: '⏱Durée',             value: formatDuration(lastSession.durationMs), inline: true },
          )
        ] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /own
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'own') {
      await interaction.deferReply();
      try {
        const username   = interaction.options.getString('username');
        const passQuery  = interaction.options.getString('gamepass').toLowerCase();
        const robloxUser = await getRobloxUserByUsername(username);
        const passes     = await getGamePasses();
        if (!passes.length)
          return interaction.editReply({ embeds: [errorEmbed('Aucun gamepass trouvé pour ce jeu.')] });
        const matched = passes.filter(p => p.name.toLowerCase().includes(passQuery));
        if (!matched.length) {
          const names = passes.map(p => `\`${p.name}\``).join(', ');
          return interaction.editReply({ embeds: [errorEmbed('Gamepass introuvable. Disponibles : ' + names)] });
        }
        const gamePass = matched[0];
        const [owns, avatar] = await Promise.all([
          userOwnsGamePass(robloxUser.id, gamePass.id),
          getRobloxAvatar(robloxUser.id),
        ]);
        const embed = baseEmbed()
          .setDescription((owns ? '✅' : '❌') + ' **Vérification de Gamepass**')
          .setColor(owns ? 0x2ecc71 : 0xe74c3c)
          .addFields(
            { name: 'Utilisateur', value: robloxUser.name, inline: true },
            { name: 'Gamepass',    value: gamePass.name,   inline: true },
            { name: 'Jeu',         value: `Stradaz Cafe (\`${GAME_ID}\`)` },
            { name: 'Statut',      value: owns ? `${robloxUser.name} possède ce gamepass.` : `${robloxUser.name} ne possède pas ce gamepass.` }
          );
        if (avatar) embed.setThumbnail(avatar);
        if (matched.length > 1)
          embed.addFields({ name: 'Autres correspondances ignorées', value: matched.slice(1).map(p => `\`${p.name}\``).join(', ') });
        return interaction.editReply({ embeds: [embed] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /status
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'status') {
      await interaction.deferReply();
      try {
        const targetUser   = interaction.options.getUser('membre')   || interaction.user;
        const targetMember = interaction.options.getMember('membre') || interaction.member;
        const discordId    = targetUser.id;

        const totalClaims = await AlertClaim.countDocuments({ discordId });
        const todayStart  = new Date(); todayStart.setHours(0, 0, 0, 0);
        const claimsToday = await AlertClaim.countDocuments({ discordId, claimedAt: { $gte: todayStart } });
        const weekStart   = new Date(); weekStart.setDate(weekStart.getDate() - 7);
        const claimsWeek  = await AlertClaim.countDocuments({ discordId, claimedAt: { $gte: weekStart } });

        const recentClaims = await AlertClaim.find({ discordId }).sort({ claimedAt: -1 }).limit(3);
        const recentLines  = recentClaims.length > 0
          ? recentClaims.map(c => {
              const date = new Date(c.claimedAt).toLocaleDateString('fr-FR');
              const time = new Date(c.claimedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
              const link = c.placeId
                ? `roblox://experiences/start?placeId=${c.placeId}&gameInstanceId=${c.jobId}`
                : `roblox://experiences/start?gameInstanceId=${c.jobId}`;
              return `\`${date} ${time}\` — [\`${c.jobId.slice(0, 12)}...\`](${link})`;
            }).join('\n')
          : 'Aucun claim récent';

        const memberName   = targetMember?.displayName || targetUser.username;
        const memberAvatar = targetUser.displayAvatarURL({ dynamic: true });

        const embed = new EmbedBuilder()
          .setTitle(`📊 Statut — ${memberName}`)
          .setColor(0x5865f2)
          .setThumbnail(memberAvatar)
          .addFields(
            { name: "Claims d'alertes", value: `**Total :** ${totalClaims}\n**Aujourd'hui :** ${claimsToday}\n**Cette semaine :** ${claimsWeek}`, inline: true },
            { name: '⏱Temps de jeu',     value: 'Cliquez le bouton ci-dessous\net entrez votre pseudo Roblox.', inline: true },
            { name: 'Derniers claims',  value: recentLines },
          )
          .setTimestamp()
          .setFooter({ text: 'Stradaz Cafe – Système MR/HR', iconURL: IMAGE });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`playtime_btn::${discordId}`)
            .setLabel('🎮 Voir le temps de jeu')
            .setStyle(ButtonStyle.Secondary)
        );
        return interaction.editReply({ embeds: [embed], components: [row] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /inactivitycheck
    // ─────────────────────────────────────────────────────────────────────────
    if (commandName === 'inactivitycheck') {
      await interaction.deferReply();
      try {
        const days      = interaction.options.getInteger('jours') || 7;
        const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        // Fetch guild members with global role IDs
        await interaction.guild.members.fetch();
        const staffMembers = interaction.guild.members.cache.filter(m =>
          GLOBAL_ROLE_IDS.some(id => m.roles.cache.has(id)) && !m.user.bot
        );

        const inactive = [];
        for (const [, member] of staffMembers) {
          const lastClaim = await AlertClaim.findOne({ discordId: member.id }).sort({ claimedAt: -1 });
          const lastSession = await MRSession.findOne({ robloxId: { $exists: false } }); // placeholder
          const lastActivity = lastClaim?.claimedAt || null;

          if (!lastActivity || lastActivity < threshold) {
            inactive.push({
              tag:          member.user.tag,
              id:           member.id,
              lastActivity: lastActivity ? new Date(lastActivity).toLocaleDateString('fr-FR') : 'Jamais',
            });
          }
        }

        if (!inactive.length) {
          return interaction.editReply({ embeds: [successEmbed(`Tous les membres staff ont été actifs ces **${days}** derniers jours. ✅`)] });
        }

        const lines = inactive.slice(0, 20).map((m, i) =>
          `**${i + 1}.** <@${m.id}> — Dernière activité : \`${m.lastActivity}\``
        ).join('\n');

        return interaction.editReply({ embeds: [baseEmbed()
          .setTitle(`Membres Inactifs — ${days} derniers jours`)
          .setDescription(lines)
          .setFooter({ text: `${inactive.length} membre(s) inactif(s) trouvé(s)`, iconURL: IMAGE })
        ] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

  } catch (err) {
    console.error('Interaction error:', err);
    try {
      const errEmbed = errorEmbed('Une erreur interne est survenue. Veuillez réessayer.');
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [errEmbed], components: [] });
      } else {
        await interaction.reply({ embeds: [errEmbed], ephemeral: true });
      }
    } catch { /* ignore */ }
  }
});

// ─── Startup ───────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log('Connecté en tant que ' + client.user.tag);
  botReady = true;
  client.user.setActivity('Stradaz Cafe', { type: ActivityType.Watching });
  await registerCommands();
  processTempBanExpiry(); // run immediately on startup
  console.log('Bot prêt.');
});

mongoose.connect(MONGODB_URI, {
  serverSelectionTimeoutMS: 15000,
  socketTimeoutMS: 45000,
  maxPoolSize: 10,
})
.then(async () => {
  console.log('✅ MongoDB connecté.');

  console.log('🔑 Attempting Discord login...');
  console.log('Token exists:', !!DISCORD_TOKEN);
  console.log('Token length:', DISCORD_TOKEN?.length);

  try {
    const result = await client.login(DISCORD_TOKEN.trim());
    console.log('✅ Discord login OK:', result);
  } catch (err) {
    console.error('❌ DISCORD LOGIN ERROR:', err);
  }
})
.catch(err => {
  console.error('❌ MONGODB ERROR:', err);
});
