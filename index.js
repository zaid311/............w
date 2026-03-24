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

const API_SECRET           = process.env.API_SECRET || 'stradaz-secret-key';
const DISCORD_TOKEN        = process.env.DISCORD_TOKEN;
const CLIENT_ID            = process.env.CLIENT_ID;
const GUILD_ID             = process.env.GUILD_ID;
const ROBLOX_COOKIE        = process.env.ROBLOX_COOKIE;
const GROUP_ID             = '11350952';
const GAME_ID              = '7968913182';
const LOG_CHANNEL_ID       = process.env.LOG_CHANNEL_ID;
const MONGODB_URI          = process.env.MONGODB_URI;
const OPEN_CLOUD_API_KEY   = process.env.OPEN_CLOUD_API_KEY;
const MAIN_UNIVERSE_ID     = process.env.MAIN_UNIVERSE_ID;
const TRAINING_UNIVERSE_ID = process.env.TRAINING_UNIVERSE_ID;

const IMAGE            = 'https://gpi.hyra.io/11350952/icon';
const WEBHOOK_URL      = 'https://discord.com/api/webhooks/1483999167297880154/dgxbDpf--b8h5Lj5onRdLAKNFDNzF7NOjez5IBQrRNszzOPPYrOQEITt9_ZPhlQc6E1A';
const WEBHOOK_AVATAR   = 'https://images-ext-1.discordapp.net/external/hkHQkFKZCF-yKOiqNTMle0sKFMKCTXdZmBG8BP36QhQ/https/gpi.hyra.io/11350952/icon?format=webp&width=315&height=315';
const ALERT_CHANNEL_ID = '1483999123924324505';
const STATUS_MIN_ROLE_ID = '1469860250730369025';

console.log('TOKEN:',        DISCORD_TOKEN      ? 'OK' : 'MISSING');
console.log('CLIENT_ID:',    CLIENT_ID          ? 'OK' : 'MISSING');
console.log('GUILD_ID:',     GUILD_ID           ? 'OK' : 'MISSING');
console.log('MONGODB:',      MONGODB_URI        ? 'OK' : 'MISSING');
console.log('OPEN CLOUD KEY:', OPEN_CLOUD_API_KEY ? 'OK' : 'MISSING');
console.log('MODCALL CHANNEL:', process.env.MODCALL_CHANNEL_ID ? 'OK' : 'MISSING');
console.log('MAIN UNIVERSE:', MAIN_UNIVERSE_ID   ? 'OK' : 'MISSING');
console.log('TRAINING UNIVERSE:', TRAINING_UNIVERSE_ID ? 'OK' : 'MISSING');

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

// ─── DB Health Check ──────────────────────────────────────────────────────────

function isDbReady() {
  return mongoose.connection.readyState === 1;
}

// ─── Discord Client ───────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
  ]
});

client.on('error', err => console.error('Discord client error:', err));
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));

// ─── Permission Helpers ───────────────────────────────────────────────────────

const STAFF_ROLE_IDS = ['1471184058577850623', '1469859492249473219'];
const HR_ROLE_IDS    = process.env.HR_ROLE_IDS
  ? process.env.HR_ROLE_IDS.split(',')
  : STAFF_ROLE_IDS;

function hasPermission(member) {
  return STAFF_ROLE_IDS.some(id => member.roles.cache.has(id));
}
function hasHRPermission(member) {
  return HR_ROLE_IDS.some(id => member.roles.cache.has(id));
}
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

async function getRobloxAvatar(userId) {
  try {
    const res = await axios.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png`);
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
    const res = await axios.get(`https://inventory.roblox.com/v1/users/${userId}/items/GamePass/${gamePassId}`);
    return res.data.data && res.data.data.length > 0;
  } catch { return false; }
}

// ─── Open Cloud Ban/Unban ─────────────────────────────────────────────────────

async function banFromRoblox(userId, universeId, reason) {
  const url = `https://apis.roblox.com/cloud/v2/universes/${universeId}/user-restrictions/${userId}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'x-api-key': OPEN_CLOUD_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameJoinRestriction: { active: true, duration: null, privateReason: reason, displayReason: reason, excludeAltAccounts: false } }),
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

// ─── Embed Helpers ────────────────────────────────────────────────────────────

function baseEmbed() {
  return new EmbedBuilder()
    .setColor(0x111111)
    .setThumbnail(IMAGE)
    .setTimestamp()
    .setFooter({ text: 'Stradaz Cafe - Systeme de Ranking', iconURL: IMAGE });
}

function errorEmbed(description) {
  return new EmbedBuilder()
    .setColor(0x880000)
    .setThumbnail(IMAGE)
    .setDescription('❌ ' + description)
    .setTimestamp()
    .setFooter({ text: 'Stradaz Cafe - Systeme de Ranking', iconURL: IMAGE });
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

async function safeDefer(interaction, options = {}) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply(options);
    }
    return true;
  } catch (err) {
    console.error('safeDefer error:', err.message);
    return false;
  }
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
            { name: '⚠️ Raison',    value: '```' + (reason || 'Aucune raison fournie') + '```', inline: false },
            { name: '👤 Joueur',    value: `**${player_name}** (ID: \`${player_id}\`)`,          inline: true  },
            { name: '🌐 Serveur',   value: `**${server_size || '?'}/${max_players || '?'}** joueurs`, inline: true },
            { name: '🔗 Rejoindre', value: joinLink, inline: false },
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

    // Close any ghost open session for this player
    const ghost = await MRSession.findOne({ robloxId: String(roblox_id), leftAt: null });
    if (ghost) {
      const now        = new Date();
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
    if (idx === -1 || idx >= roles.length - 1) return res.status(400).json({ error: 'Already at highest rank' });

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

app.listen(process.env.PORT || 3020, () => console.log('Web server running on port', process.env.PORT || 3020));

// ─── Slash Commands ───────────────────────────────────────────────────────────

const commands = [
  new SlashCommandBuilder()
    .setName('checkrank')
    .setDescription("Verifier le rang d'un utilisateur Roblox.")
    .addStringOption(o => o.setName('username').setDescription("Nom d'utilisateur Roblox").setRequired(true)),
  new SlashCommandBuilder()
    .setName('promote')
    .setDescription("Promouvoir un utilisateur d'un rang.")
    .addStringOption(o => o.setName('username').setDescription("Nom d'utilisateur Roblox").setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(false)),
  new SlashCommandBuilder()
    .setName('demote')
    .setDescription("Retrograder un utilisateur d'un rang.")
    .addStringOption(o => o.setName('username').setDescription("Nom d'utilisateur Roblox").setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(false)),
  new SlashCommandBuilder()
    .setName('setrank')
    .setDescription("Definir le rang d'un utilisateur Roblox.")
    .addStringOption(o => o.setName('username').setDescription("Nom d'utilisateur Roblox").setRequired(true))
    .addStringOption(o => o.setName('rang').setDescription('Nom du nouveau rang').setRequired(true)),
  new SlashCommandBuilder()
    .setName('ranklog')
    .setDescription("Voir l'historique des rangs.")
    .addIntegerOption(o => o.setName('page').setDescription('Numero de page').setRequired(false)),
  new SlashCommandBuilder()
    .setName('logstats')
    .setDescription('Statistiques des rangs.'),
  new SlashCommandBuilder()
    .setName('clearlog')
    .setDescription("Effacer l'historique des rangs."),
  new SlashCommandBuilder()
    .setName('own')
    .setDescription("Verifier si un utilisateur possede un gamepass du jeu Stradaz Cafe.")
    .addStringOption(o => o.setName('username').setDescription("Nom d'utilisateur Roblox").setRequired(true))
    .addStringOption(o => o.setName('gamepass').setDescription('Nom (ou partie du nom) du gamepass').setRequired(true)),
  new SlashCommandBuilder()
    .setName('rban')
    .setDescription('Bannir ou debannir un joueur du jeu principal ou du centre de formation.')
    .addStringOption(o =>
      o.setName('type').setDescription('Ban ou Unban ?').setRequired(true)
       .addChoices({ name: 'Ban', value: 'ban' }, { name: 'Unban', value: 'unban' }))
    .addStringOption(o => o.setName('username').setDescription("Nom d'utilisateur Roblox").setRequired(true))
    .addStringOption(o =>
      o.setName('game').setDescription('Quel jeu ?').setRequired(true)
       .addChoices({ name: 'Main Game', value: 'main' }, { name: 'Training Center', value: 'training' }))
    .addStringOption(o => o.setName('reason').setDescription('Raison').setRequired(false)),
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Voir vos statistiques MR/HR : claims alertes et temps de jeu.')
    .addUserOption(o => o.setName('membre').setDescription('Membre à consulter (vide = vous-même)').setRequired(false)),
];

async function registerCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands.map(c => c.toJSON())
    });
    console.log('Commandes enregistrees.');
  } catch (err) {
    console.error('Erreur enregistrement commandes:', err.message);
  }
}

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
            .setTitle(`⏱️ Temps de jeu — ${robloxUser.name}`)
            .setColor(0x5865f2)
            .setThumbnail(avatar || IMAGE)
            .addFields(
              { name: '🕐 Temps total',         value: formatDuration(totalMs) || '0m', inline: true },
              { name: '🔢 Sessions',             value: String(sessionCount),             inline: true },
              { name: '📊 Moy. par session',     value: sessionCount > 0 ? formatDuration(totalMs / sessionCount) : 'N/A', inline: true },
              { name: '📋 3 dernières sessions', value: recentLines, inline: false },
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

      // Claim modcall
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

      // Claim alertstaff
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
            jobId,
            placeId,
          });
        } catch (dbErr) {
          console.error('AlertClaim DB error:', dbErr.message);
        }

        await interaction.followUp({
          content: `<@${interaction.user.id}> a pris en charge l'alerte du serveur [\`${jobId}\`](${joinLink})`,
        });
        return;
      }

      // Playtime button — show modal
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

      // All other buttons (rank confirm/cancel/ban)
      const parts    = customId.split('::');
      const action   = parts[0];
      const changeId = parts[1];

      const pending = pendingChanges.get(changeId);
      if (!pending) {
        return interaction.reply({ embeds: [errorEmbed('Confirmation expirée. Relancez la commande.')], ephemeral: true });
      }
      if (interaction.user.id !== pending.requesterId) {
        return interaction.reply({ embeds: [errorEmbed('Seule la personne qui a lancé la commande peut confirmer.')], ephemeral: true });
      }
      pendingChanges.delete(changeId);

      if (action === 'annuler') {
        return interaction.update({ embeds: [baseEmbed().setDescription('Action annulée.')], components: [] });
      }

      // Confirm rank change
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
              { name: 'Ancien rang',  value: oldName, inline: true },
              { name: 'Nouveau rang', value: newName, inline: true },
              { name: 'Raison',       value: pending.reason || 'Aucune' },
              { name: 'Effectué par', value: '<@' + pending.requesterId + '>' }
            )
          );
          const label = pending.auditAction === 'PROMOTE' ? 'Promotion réussie'
            : pending.auditAction === 'DEMOTE' ? 'Rétrogradation réussie' : 'Rang modifié';
          return interaction.editReply({
            embeds: [baseEmbed().setDescription(label).addFields(
              { name: 'Utilisateur',  value: pending.robloxUser.name },
              { name: 'Ancien rang',  value: oldName, inline: true },
              { name: 'Nouveau rang', value: newName, inline: true },
              { name: 'Raison',       value: pending.reason || 'Aucune' },
              { name: 'Modifié par',  value: '<@' + pending.requesterId + '>' }
            )],
            components: []
          });
        } catch (err) {
          return interaction.editReply({ embeds: [errorEmbed('Échec : ' + err.message)], components: [] });
        }
      }

      // Confirm clear log
      if (action === 'confirmer_clearlog') {
        await interaction.deferUpdate();
        await RankLog.deleteMany({});
        return interaction.editReply({ embeds: [baseEmbed().setDescription('Journal effacé.')], components: [] });
      }

      // Confirm ban/unban
      if (action === 'confirmer_ban') {
        await interaction.deferUpdate();
        try {
          const { type, username, userId, game, reason, gameLabel, universeId } = pending;

          if (type === 'unban') {
            await unbanFromRoblox(userId, universeId);
            await Ban.findOneAndUpdate({ robloxUsername: username.toLowerCase(), game, active: true }, { active: false });
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
              embeds: [new EmbedBuilder().setTitle('🔓 Débannissement Confirmé').setColor(0x2ecc71).setThumbnail(IMAGE)
                .addFields(
                  { name: 'Utilisateur', value: username, inline: true },
                  { name: 'Jeu',         value: gameLabel, inline: true },
                  { name: 'Raison',      value: reason },
                  { name: 'Débanni par', value: '<@' + interaction.user.id + '>' },
                ).setTimestamp().setFooter({ text: 'Stradaz Cafe - Système de Bannissement', iconURL: IMAGE })],
              components: [],
            });
          } else {
            await banFromRoblox(userId, universeId, reason);
            await Ban.create({
              robloxUsername: username.toLowerCase(),
              robloxUserId:   String(userId),
              game, reason,
              bannedBy:   interaction.user.tag,
              bannedById: interaction.user.id,
            });
            await sendLogToChannel(
              new EmbedBuilder().setTitle('🔨 Joueur Banni').setColor(0xff4444).setThumbnail(IMAGE)
                .addFields(
                  { name: 'Utilisateur', value: username, inline: true },
                  { name: 'Jeu',         value: gameLabel, inline: true },
                  { name: 'Banni par',   value: '<@' + interaction.user.id + '>', inline: true },
                  { name: 'Raison',      value: reason },
                ).setTimestamp().setFooter({ text: 'Stradaz Cafe - Système de Bannissement', iconURL: IMAGE })
            );
            return interaction.editReply({
              embeds: [new EmbedBuilder().setTitle('🔨 Bannissement Confirmé').setColor(0xff4444).setThumbnail(IMAGE)
                .addFields(
                  { name: 'Utilisateur', value: username, inline: true },
                  { name: 'Jeu',         value: gameLabel, inline: true },
                  { name: 'Raison',      value: reason },
                  { name: 'Banni par',   value: '<@' + interaction.user.id + '>' },
                ).setTimestamp().setFooter({ text: 'Stradaz Cafe - Système de Bannissement', iconURL: IMAGE })],
              components: [],
            });
          }
        } catch (err) {
          return interaction.editReply({ embeds: [errorEmbed('Échec : ' + err.message)], components: [] });
        }
      }

      return;
    }

    // ── Slash Commands ───────────────────────────────────────────────────────
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    // /checkrank
    if (commandName === 'checkrank') {
      const ok = await safeDefer(interaction);
      if (!ok) return;
      try {
        const username   = interaction.options.getString('username');
        const robloxUser = await getRobloxUserByUsername(username);
        const [role, avatar] = await Promise.all([
          getUserGroupRole(robloxUser.id),
          getRobloxAvatar(robloxUser.id),
        ]);
        const embed = baseEmbed().setDescription('Vérification du rang').addFields(
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

    // /promote
    if (commandName === 'promote') {
      if (!hasPermission(interaction.member)) {
        return interaction.reply({ embeds: [errorEmbed('Permission refusée.')], ephemeral: true });
      }
      const ok = await safeDefer(interaction);
      if (!ok) return;
      try {
        const username   = interaction.options.getString('username');
        const reason     = interaction.options.getString('raison') || 'Promotion';
        const robloxUser = await getRobloxUserByUsername(username);
        const roles      = (await getGroupRoles()).sort((a, b) => a.rank - b.rank);
        const oldRole    = await getUserGroupRole(robloxUser.id);
        if (!oldRole) return interaction.editReply({ embeds: [errorEmbed(robloxUser.name + " n'est pas dans le groupe.")] });
        const idx = roles.findIndex(r => r.id === oldRole.id);
        if (idx === -1 || idx >= roles.length - 1) {
          return interaction.editReply({ embeds: [errorEmbed(robloxUser.name + ' est déjà au rang le plus élevé.')] });
        }
        const newRole  = roles[idx + 1];
        const changeId = interaction.id + '-' + Date.now();
        pendingChanges.set(changeId, { userId: robloxUser.id, newRoleId: newRole.id, robloxUser, oldRole, newRole, reason, requesterId: interaction.user.id, auditAction: 'PROMOTE' });
        setTimeout(() => pendingChanges.delete(changeId), 60000);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('confirmer::' + changeId).setLabel('Confirmer la promotion').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('annuler::' + changeId).setLabel('Annuler').setStyle(ButtonStyle.Danger)
        );
        return interaction.editReply({ embeds: [baseEmbed().setDescription('Confirmer la promotion ?').addFields(
          { name: 'Utilisateur', value: robloxUser.name },
          { name: 'Ancien rang', value: oldRole.name, inline: true },
          { name: 'Nouveau rang', value: newRole.name, inline: true },
          { name: 'Raison',      value: reason }
        )], components: [row] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // /demote
    if (commandName === 'demote') {
      if (!hasPermission(interaction.member)) {
        return interaction.reply({ embeds: [errorEmbed('Permission refusée.')], ephemeral: true });
      }
      const ok = await safeDefer(interaction);
      if (!ok) return;
      try {
        const username   = interaction.options.getString('username');
        const reason     = interaction.options.getString('raison') || 'Rétrogradation';
        const robloxUser = await getRobloxUserByUsername(username);
        const roles      = (await getGroupRoles()).sort((a, b) => a.rank - b.rank);
        const oldRole    = await getUserGroupRole(robloxUser.id);
        if (!oldRole) return interaction.editReply({ embeds: [errorEmbed(robloxUser.name + " n'est pas dans le groupe.")] });
        const idx = roles.findIndex(r => r.id === oldRole.id);
        if (idx <= 0) {
          return interaction.editReply({ embeds: [errorEmbed(robloxUser.name + ' est déjà au rang le plus bas.')] });
        }
        const newRole  = roles[idx - 1];
        const changeId = interaction.id + '-' + Date.now();
        pendingChanges.set(changeId, { userId: robloxUser.id, newRoleId: newRole.id, robloxUser, oldRole, newRole, reason, requesterId: interaction.user.id, auditAction: 'DEMOTE' });
        setTimeout(() => pendingChanges.delete(changeId), 60000);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('confirmer::' + changeId).setLabel('Confirmer la rétrogradation').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('annuler::' + changeId).setLabel('Annuler').setStyle(ButtonStyle.Secondary)
        );
        return interaction.editReply({ embeds: [baseEmbed().setDescription('Confirmer la rétrogradation ?').addFields(
          { name: 'Utilisateur', value: robloxUser.name },
          { name: 'Ancien rang', value: oldRole.name, inline: true },
          { name: 'Nouveau rang', value: newRole.name, inline: true },
          { name: 'Raison',      value: reason }
        )], components: [row] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // /setrank
    if (commandName === 'setrank') {
      if (!hasPermission(interaction.member)) {
        return interaction.reply({ embeds: [errorEmbed('Permission refusée.')], ephemeral: true });
      }
      const ok = await safeDefer(interaction);
      if (!ok) return;
      try {
        const username   = interaction.options.getString('username');
        const rankName   = interaction.options.getString('rang');
        const robloxUser = await getRobloxUserByUsername(username);
        const roles      = await getGroupRoles();
        const newRole    = roles.find(r => r.name.toLowerCase() === rankName.toLowerCase());
        if (!newRole) {
          return interaction.editReply({ embeds: [errorEmbed('Rang introuvable. Disponibles : ' + roles.map(r => r.name).join(', '))] });
        }
        const oldRole  = await getUserGroupRole(robloxUser.id);
        const changeId = interaction.id + '-' + Date.now();
        pendingChanges.set(changeId, { userId: robloxUser.id, newRoleId: newRole.id, robloxUser, oldRole, newRole, reason: 'Définition manuelle', requesterId: interaction.user.id, auditAction: 'SETRANK' });
        setTimeout(() => pendingChanges.delete(changeId), 60000);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('confirmer::' + changeId).setLabel('Confirmer').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('annuler::' + changeId).setLabel('Annuler').setStyle(ButtonStyle.Danger)
        );
        return interaction.editReply({ embeds: [baseEmbed().setDescription('Confirmer le changement de rang ?').addFields(
          { name: 'Utilisateur', value: robloxUser.name },
          { name: 'Rang actuel', value: oldRole?.name ?? 'Invité', inline: true },
          { name: 'Nouveau rang', value: newRole.name, inline: true }
        )], components: [row] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // /ranklog
    if (commandName === 'ranklog') {
      const ok = await safeDefer(interaction);
      if (!ok) return;
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
          return `**${(pageNum - 1) * PER_PAGE + i + 1}.** \`${log.robloxUsername}\` - ${log.oldRank} → ${log.newRank}\n> par <@${log.staffDiscordId}> - ${date}`;
        }).join('\n\n');
        return interaction.editReply({ embeds: [baseEmbed()
          .setDescription(`**Journal des rangs - Page ${pageNum}/${totalPages}**\n\n${lines}`)
          .setFooter({ text: `Stradaz Cafe - ${total} entrées au total`, iconURL: IMAGE })
        ] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // /logstats
    if (commandName === 'logstats') {
      const ok = await safeDefer(interaction);
      if (!ok) return;
      try {
        const total = await RankLog.countDocuments();
        if (!total) return interaction.editReply({ embeds: [baseEmbed().setDescription('Aucun journal.')] });
        const staffAgg = await RankLog.aggregate([
          { $group: { _id: '$staffDiscordId', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 5 },
        ]);
        const rankAgg = await RankLog.aggregate([
          { $group: { _id: '$newRank', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 5 },
        ]);
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayCount = await RankLog.countDocuments({ timestamp: { $gte: todayStart } });
        return interaction.editReply({ embeds: [baseEmbed().setDescription('Statistiques du journal').addFields(
          { name: 'Total',              value: String(total),      inline: true },
          { name: "Aujourd'hui",        value: String(todayCount), inline: true },
          { name: 'Top staff',          value: staffAgg.map((s, i) => `**${i+1}.** <@${s._id}> - ${s.count}`).join('\n') || 'Aucun' },
          { name: 'Rangs les plus donnés', value: rankAgg.map((r, i) => `**${i+1}.** ${r._id} - ${r.count} fois`).join('\n') || 'Aucun' }
        )] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // /clearlog
    if (commandName === 'clearlog') {
      if (!hasPermission(interaction.member)) {
        return interaction.reply({ embeds: [errorEmbed('Permission refusée.')], ephemeral: true });
      }
      const changeId = interaction.id + '-' + Date.now();
      pendingChanges.set(changeId, { requesterId: interaction.user.id });
      setTimeout(() => pendingChanges.delete(changeId), 30000);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirmer_clearlog::' + changeId).setLabel('Oui, tout effacer').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('annuler::' + changeId).setLabel('Annuler').setStyle(ButtonStyle.Secondary)
      );
      return interaction.reply({
        embeds: [baseEmbed().setDescription('Êtes-vous sûr de vouloir effacer tout le journal ? Action irréversible.')],
        components: [row],
        ephemeral: true,
      });
    }

    // /own
    if (commandName === 'own') {
      const ok = await safeDefer(interaction);
      if (!ok) return;
      try {
        const username   = interaction.options.getString('username');
        const passQuery  = interaction.options.getString('gamepass').toLowerCase();
        const robloxUser = await getRobloxUserByUsername(username);
        const passes     = await getGamePasses();
        if (!passes.length) return interaction.editReply({ embeds: [errorEmbed('Aucun gamepass trouvé pour ce jeu.')] });
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
            { name: 'Jeu',         value: `Stradaz Cafe (\`${GAME_ID}\`)`, inline: false },
            { name: 'Statut',      value: owns ? `${robloxUser.name} possède ce gamepass.` : `${robloxUser.name} ne possède pas ce gamepass.`, inline: false }
          );
        if (avatar) embed.setThumbnail(avatar);
        if (matched.length > 1) embed.addFields({ name: 'Autres correspondances ignorées', value: matched.slice(1).map(p => `\`${p.name}\``).join(', ') });
        return interaction.editReply({ embeds: [embed] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // /rban
    if (commandName === 'rban') {
      if (!hasHRPermission(interaction.member)) {
        return interaction.reply({ embeds: [errorEmbed('Permission refusée. Commande réservée aux RH.')], ephemeral: true });
      }
      if (!OPEN_CLOUD_API_KEY) {
        return interaction.reply({ embeds: [errorEmbed('OPEN_CLOUD_API_KEY manquant dans les variables d\'environnement.')], ephemeral: true });
      }
      const type       = interaction.options.getString('type');
      const username   = interaction.options.getString('username');
      const game       = interaction.options.getString('game');
      const reason     = interaction.options.getString('reason') || 'Aucune raison fournie';
      const gameLabel  = game === 'main' ? 'Main Game' : 'Training Center';
      const universeId = game === 'main' ? MAIN_UNIVERSE_ID : TRAINING_UNIVERSE_ID;
      if (!universeId) {
        return interaction.reply({ embeds: [errorEmbed(`Universe ID pour **${gameLabel}** manquant dans les variables d'environnement.`)], ephemeral: true });
      }
      const ok = await safeDefer(interaction);
      if (!ok) return;
      try {
        const robloxUser = await getRobloxUserByUsername(username);
        const [dbBan, isBannedInGame] = await Promise.all([
          Ban.findOne({ robloxUsername: username.toLowerCase(), game, active: true }),
          getRobloxBanStatus(robloxUser.id, universeId),
        ]);

        // Sync DB with Roblox ban state
        if (isBannedInGame && !dbBan) {
          await Ban.create({ robloxUsername: username.toLowerCase(), robloxUserId: String(robloxUser.id), game, reason: 'Ban détecté en jeu (sync automatique)', bannedBy: 'Roblox', bannedById: '0' });
        }
        if (!isBannedInGame && dbBan) {
          await Ban.findOneAndUpdate({ robloxUsername: username.toLowerCase(), game, active: true }, { active: false });
        }

        if (type === 'ban') {
          if (isBannedInGame) {
            return interaction.editReply({ embeds: [errorEmbed(`**${username}** est **déjà banni** du **${gameLabel}**.\n> Raison : ${dbBan?.reason || 'Inconnue'}`)] });
          }
          const changeId = interaction.id + '-' + Date.now();
          pendingChanges.set(changeId, { type: 'ban', username, userId: robloxUser.id, game, reason, gameLabel, universeId, requesterId: interaction.user.id });
          setTimeout(() => pendingChanges.delete(changeId), 60000);
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('confirmer_ban::' + changeId).setLabel('✅ Confirmer le Ban').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('annuler::' + changeId).setLabel('Annuler').setStyle(ButtonStyle.Secondary)
          );
          return interaction.editReply({
            embeds: [new EmbedBuilder().setTitle('🔨 Confirmer le Bannissement').setColor(0xff8800).setThumbnail(IMAGE)
              .setDescription('Êtes-vous sûr de vouloir bannir **définitivement** ce joueur ?')
              .addFields(
                { name: 'Utilisateur', value: username, inline: true },
                { name: 'Jeu',         value: gameLabel, inline: true },
                { name: 'Raison',      value: reason },
              ).setTimestamp().setFooter({ text: 'Stradaz Cafe - Système de Bannissement', iconURL: IMAGE })],
            components: [row],
          });
        }

        if (type === 'unban') {
          if (!isBannedInGame) {
            return interaction.editReply({ embeds: [errorEmbed(`**${username}** n'est **pas banni** du **${gameLabel}**.`)] });
          }
          const existing = await Ban.findOne({ robloxUsername: username.toLowerCase(), game, active: true });
          const changeId = interaction.id + '-' + Date.now();
          pendingChanges.set(changeId, { type: 'unban', username, userId: robloxUser.id, game, reason, gameLabel, universeId, requesterId: interaction.user.id });
          setTimeout(() => pendingChanges.delete(changeId), 60000);
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('confirmer_ban::' + changeId).setLabel('✅ Confirmer le Unban').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('annuler::' + changeId).setLabel('Annuler').setStyle(ButtonStyle.Secondary)
          );
          return interaction.editReply({
            embeds: [new EmbedBuilder().setTitle('🔓 Confirmer le Débannissement').setColor(0x2ecc71).setThumbnail(IMAGE)
              .setDescription('Êtes-vous sûr de vouloir débannir ce joueur ?')
              .addFields(
                { name: 'Utilisateur', value: username, inline: true },
                { name: 'Jeu',         value: gameLabel, inline: true },
                { name: 'Banni pour',  value: existing?.reason ?? 'Inconnue', inline: false },
                { name: 'Raison unban', value: reason, inline: false },
              ).setTimestamp().setFooter({ text: 'Stradaz Cafe - Système de Bannissement', iconURL: IMAGE })],
            components: [row],
          });
        }
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(err.message)] });
      }
    }

    // /status
    if (commandName === 'status') {
      if (!hasStatusPermission(interaction.member)) {
        return interaction.reply({ embeds: [errorEmbed('Permission refusée. Cette commande est réservée aux MR et HR.')], ephemeral: true });
      }
      const ok = await safeDefer(interaction);
      if (!ok) return;
      try {
        const targetUser   = interaction.options.getUser('membre') || interaction.user;
        const targetMember = interaction.options.getMember('membre') || interaction.member;
        const discordId    = targetUser.id;

        const totalClaims = await AlertClaim.countDocuments({ discordId });

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const claimsToday = await AlertClaim.countDocuments({ discordId, claimedAt: { $gte: todayStart } });

        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - 7);
        const claimsWeek = await AlertClaim.countDocuments({ discordId, claimedAt: { $gte: weekStart } });

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
            {
              name:  "🔔 Claims d'alertes",
              value: `**Total :** ${totalClaims}\n**Aujourd'hui :** ${claimsToday}\n**Cette semaine :** ${claimsWeek}`,
              inline: true,
            },
            {
              name:  '⏱️ Temps de jeu',
              value: 'Cliquez le bouton ci-dessous\net entrez votre pseudo Roblox\npour voir votre temps de jeu.',
              inline: true,
            },
            {
              name:  '📋 Derniers claims',
              value: recentLines,
              inline: false,
            },
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

  } catch (err) {
    // Top-level catch — prevents the bot from crashing on any unhandled interaction error
    console.error('Interaction error:', err);
    try {
      const errEmbed = errorEmbed('Une erreur interne est survenue. Veuillez réessayer.');
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [errEmbed], components: [] });
      } else {
        await interaction.reply({ embeds: [errEmbed], ephemeral: true });
      }
    } catch { /* ignore reply errors */ }
  }
});

// ─── Startup ──────────────────────────────────────────────────────────────────

client.once('ready', async () => {
  console.log('Connecté en tant que ' + client.user.tag);
  botReady = true;
  client.user.setActivity('Stradaz Cafe', { type: ActivityType.Watching });
  await registerCommands();
  console.log('Bot prêt.');
});

// ─── MongoDB + Discord Login ──────────────────────────────────────────────────

mongoose.connection.on('disconnected', () => console.error('MongoDB déconnecté! Tentative de reconnexion...'));
mongoose.connection.on('reconnected',  () => console.log('MongoDB reconnecté.'));
mongoose.connection.on('error',        err => console.error('MongoDB erreur:', err.message));

mongoose.connect(MONGODB_URI, {
  serverSelectionTimeoutMS: 15000,
  socketTimeoutMS:          45000,
  heartbeatFrequencyMS:     10000,
  maxPoolSize:              10,
})
  .then(() => {
    console.log('MongoDB connecté.');
    return client.login(DISCORD_TOKEN);
  })
  .then(() => console.log('Discord login OK.'))
  .catch(err => console.error('Erreur démarrage:', err.message));
