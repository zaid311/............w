require('dotenv').config();
const {
  Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes,
  ActivityType
} = require('discord.js');
const mongoose = require('mongoose');
const axios    = require('axios');

const express = require('express');
const app = express();
app.use(express.json());
app.get('/', (req, res) => res.send('Bot is running!'));

// Secret key to verify requests come from your Roblox game
const API_SECRET = process.env.API_SECRET || 'stradaz-secret-key';

app.post('/promote', async (req, res) => {
  try {
    const { username, secret } = req.body;
    if (secret !== API_SECRET) return res.status(401).json({ error: 'Unauthorized' });
    const robloxUser = await getRobloxUserByUsername(username);
    const roles = (await getGroupRoles()).sort((a, b) => a.rank - b.rank);
    const oldRole = await getUserGroupRole(robloxUser.id);
    if (!oldRole) return res.status(404).json({ error: 'User not in group' });
    const idx = roles.findIndex(r => r.id === oldRole.id);
    if (idx === -1 || idx >= roles.length - 1) return res.status(400).json({ error: 'Already at highest rank' });
    const newRole = roles[idx + 1];
    await setGroupRank(robloxUser.id, newRole.id);
    await RankLog.create({
      staffDiscordId: 'ROBLOX',
      staffTag: 'In-Game Command',
      robloxUsername: robloxUser.name,
      robloxId: robloxUser.id,
      oldRank: oldRole.name,
      newRank: newRole.name,
      reason: 'Promotion in-game',
      action: 'PROMOTE',
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
    const roles = (await getGroupRoles()).sort((a, b) => a.rank - b.rank);
    const oldRole = await getUserGroupRole(robloxUser.id);
    if (!oldRole) return res.status(404).json({ error: 'User not in group' });
    const idx = roles.findIndex(r => r.id === oldRole.id);
    if (idx === -1 || idx >= roles.length - 1) return res.status(400).json({ error: 'Already at highest rank' });
    const newRole = roles[idx - 1];
    await setGroupRank(robloxUser.id, newRole.id);
    await RankLog.create({
      staffDiscordId: 'ROBLOX',
      staffTag: 'In-Game Command',
      robloxUsername: robloxUser.name,
      robloxId: robloxUser.id,
      oldRank: oldRole.name,
      newRank: newRole.name,
      reason: 'Retrogradation in-game',
      action: 'DEMOTE',
    });
    return res.json({ success: true, oldRank: oldRole.name, newRank: newRole.name, username: robloxUser.name });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 3020, () => console.log('Web server running'));

const DISCORD_TOKEN         = process.env.DISCORD_TOKEN;
const CLIENT_ID             = process.env.CLIENT_ID;
const GUILD_ID              = process.env.GUILD_ID;
const ROBLOX_COOKIE         = process.env.ROBLOX_COOKIE;
const GROUP_ID              = '11350952';
const GAME_ID               = '7968913182';
const LOG_CHANNEL_ID        = process.env.LOG_CHANNEL_ID;
const MONGODB_URI           = process.env.MONGODB_URI;
const STAFF_ROLE_ID         = process.env.STAFF_ROLE_ID;
const OPEN_CLOUD_API_KEY    = process.env.OPEN_CLOUD_API_KEY;
const MAIN_UNIVERSE_ID      = process.env.MAIN_UNIVERSE_ID;
const TRAINING_UNIVERSE_ID  = process.env.TRAINING_UNIVERSE_ID;

console.log('TOKEN:', DISCORD_TOKEN ? 'OK' : 'MISSING');
console.log('MONGODB:', MONGODB_URI ? 'OK' : 'MISSING');
console.log('OPEN CLOUD KEY:', OPEN_CLOUD_API_KEY ? 'OK' : 'MISSING');
console.log('[DEBUG] GROUP_ID:', GROUP_ID);

const IMAGE = 'https://gpi.hyra.io/11350952/icon';

// ─── Schemas ──────────────────────────────────────────────────────────────────

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

client.on('error', err => console.error('Discord error:', err));
process.on('unhandledRejection', err => console.error('Unhandled:', err));

// ─── Roblox Helpers ───────────────────────────────────────────────────────────

async function getRobloxUserByUsername(username) {
  console.log(`[getRobloxUserByUsername] Looking up: "${username}"`);
  const res = await axios.post('https://users.roblox.com/v1/usernames/users', {
    usernames: [username], excludeBannedUsers: false
  });
  const user = res.data.data[0];
  if (!user) throw new Error(`Utilisateur "${username}" introuvable sur Roblox.`);
  console.log(`[getRobloxUserByUsername] Found: id=${user.id}, name=${user.name}`);
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
  let passes = [];
  let cursor = '';
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
  } catch {
    return false;
  }
}

// ─── Ban via Roblox Open Cloud API ────────────────────────────────────────────

async function banFromRoblox(userId, universeId, reason) {
  const url = `https://apis.roblox.com/cloud/v2/universes/${universeId}/user-restrictions/${userId}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'x-api-key':    OPEN_CLOUD_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      gameJoinRestriction: {
        active:             true,
        duration:           null,   // null = permanent
        privateReason:      reason,
        displayReason:      reason,
        excludeAltAccounts: false,
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Open Cloud error: ${res.status}`);
  return data;
}

// ─── Embeds ───────────────────────────────────────────────────────────────────

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
    .setDescription('X ' + description)
    .setTimestamp()
    .setFooter({ text: 'Stradaz Cafe - Systeme de Ranking', iconURL: IMAGE });
}

// ─── Permissions ──────────────────────────────────────────────────────────────

const STAFF_ROLE_IDS = ['1471184058577850623', '1469859492249473219'];
const HR_ROLE_IDS    = process.env.HR_ROLE_IDS
  ? process.env.HR_ROLE_IDS.split(',')
  : STAFF_ROLE_IDS; // falls back to staff roles if not set

function hasPermission(member) {
  return STAFF_ROLE_IDS.some(id => member.roles.cache.has(id));
}

function hasHRPermission(member) {
  return HR_ROLE_IDS.some(id => member.roles.cache.has(id));
}

// ─── Log Helper ───────────────────────────────────────────────────────────────

async function sendLogToChannel(embed) {
  if (!LOG_CHANNEL_ID) return;
  try {
    const ch = await client.channels.fetch(LOG_CHANNEL_ID);
    if (ch) await ch.send({ embeds: [embed] });
  } catch { }
}

// ─── Commands ─────────────────────────────────────────────────────────────────

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

  // ── /ban command ─────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bannir definitivement un joueur du jeu principal ou du centre de formation.')
    .addStringOption(o => o.setName('username').setDescription('Nom d\'utilisateur Roblox').setRequired(true))
    .addStringOption(o =>
      o.setName('game')
       .setDescription('Quel jeu ?')
       .setRequired(true)
       .addChoices(
         { name: 'Main Game',       value: 'main'     },
         { name: 'Training Center', value: 'training' },
       ))
    .addStringOption(o => o.setName('reason').setDescription('Raison du bannissement').setRequired(true)),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: commands.map(c => c.toJSON())
  });
  console.log('Commandes enregistrees.');
}

// ─── Interaction Handler ──────────────────────────────────────────────────────

const pendingChanges = new Map();

async function safeDefer(interaction, options = {}) {
  try {
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply(options);
    return true;
  } catch { return false; }
}

client.on('interactionCreate', async interaction => {
  if (interaction.isButton()) {
    const [action, changeId] = interaction.customId.split('::');
    const pending = pendingChanges.get(changeId);
    if (!pending) return interaction.reply({ embeds: [errorEmbed('Confirmation expiree.')], ephemeral: true });
    if (interaction.user.id !== pending.requesterId) return interaction.reply({ embeds: [errorEmbed('Seulement la personne qui a lance la commande peut confirmer.')], ephemeral: true });
    pendingChanges.delete(changeId);

    if (action === 'annuler') return interaction.update({ embeds: [baseEmbed().setDescription('Action annulee.')], components: [] });

    if (action === 'confirmer') {
      await interaction.deferUpdate();
      try {
        await setGroupRank(pending.userId, pending.newRoleId);
        const oldName = pending.oldRole?.name ?? 'Invite';
        const newName = pending.newRole.name;
        await RankLog.create({
          staffDiscordId: pending.requesterId,
          staffTag: interaction.user.tag,
          robloxUsername: pending.robloxUser.name,
          robloxId: pending.userId,
          oldRank: oldName,
          newRank: newName,
          reason: pending.reason || '',
          action: pending.auditAction,
        });
        await sendLogToChannel(baseEmbed().setDescription('Changement de rang enregistre').addFields(
          { name: 'Utilisateur', value: pending.robloxUser.name },
          { name: 'Ancien rang', value: oldName, inline: true },
          { name: 'Nouveau rang', value: newName, inline: true },
          { name: 'Raison', value: pending.reason || 'Aucune' },
          { name: 'Effectue par', value: '<@' + pending.requesterId + '>' }
        ));
        const label = pending.auditAction === 'PROMOTE' ? 'Promotion reussie' : pending.auditAction === 'DEMOTE' ? 'Retrogradation reussie' : 'Rang modifie';
        return interaction.editReply({ embeds: [baseEmbed().setDescription(label).addFields(
          { name: 'Utilisateur', value: pending.robloxUser.name },
          { name: 'Ancien rang', value: oldName, inline: true },
          { name: 'Nouveau rang', value: newName, inline: true },
          { name: 'Raison', value: pending.reason || 'Aucune' },
          { name: 'Modifie par', value: '<@' + pending.requesterId + '>' }
        )], components: [] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed('Echec : ' + err.message)], components: [] });
      }
    }

    if (action === 'confirmer_clearlog') {
      await interaction.deferUpdate();
      await RankLog.deleteMany({});
      return interaction.editReply({ embeds: [baseEmbed().setDescription('Journal efface.')], components: [] });
    }

    // ── Confirm ban button ───────────────────────────────────────────────────
    if (action === 'confirmer_ban') {
      await interaction.deferUpdate();
      try {
        const { username, userId, game, reason, gameLabel, universeId } = pending;

        await banFromRoblox(userId, universeId, reason);

        await Ban.create({
          robloxUsername: username.toLowerCase(),
          robloxUserId:   String(userId),
          game,
          reason,
          bannedBy:   interaction.user.tag,
          bannedById: interaction.user.id,
        });

        await sendLogToChannel(
          new EmbedBuilder()
            .setTitle('🔨 Joueur Banni')
            .setColor(0xff4444)
            .setThumbnail(IMAGE)
            .addFields(
              { name: 'Utilisateur', value: username,    inline: true },
              { name: 'Jeu',         value: gameLabel,   inline: true },
              { name: 'Banni par',   value: '<@' + interaction.user.id + '>', inline: true },
              { name: 'Raison',      value: reason },
            )
            .setTimestamp()
            .setFooter({ text: 'Stradaz Cafe - Systeme de Bannissement', iconURL: IMAGE })
        );

        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle('🔨 Bannissement Confirme')
              .setColor(0xff4444)
              .setThumbnail(IMAGE)
              .addFields(
                { name: 'Utilisateur', value: username,  inline: true },
                { name: 'Jeu',         value: gameLabel, inline: true },
                { name: 'Raison',      value: reason },
                { name: 'Banni par',   value: '<@' + interaction.user.id + '>' },
              )
              .setTimestamp()
              .setFooter({ text: 'Stradaz Cafe - Systeme de Bannissement', iconURL: IMAGE })
          ],
          components: [],
        });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed('Echec du bannissement : ' + err.message)], components: [] });
      }
    }

    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  // ── /checkrank ──────────────────────────────────────────────────────────────
  if (commandName === 'checkrank') {
    const ok = await safeDefer(interaction);
    if (!ok) return;
    try {
      const username = interaction.options.getString('username');
      const robloxUser = await getRobloxUserByUsername(username);
      const [role, avatar] = await Promise.all([getUserGroupRole(robloxUser.id), getRobloxAvatar(robloxUser.id)]);
      const embed = baseEmbed().setDescription('Verification du rang').addFields(
        { name: 'Utilisateur', value: robloxUser.name },
        { name: 'Nom affiche', value: robloxUser.displayName || robloxUser.name },
        { name: 'Rang actuel', value: role?.name ?? 'Pas dans le groupe', inline: true },
        { name: 'Numero de rang', value: role ? String(role.rank) : 'N/A', inline: true }
      );
      if (avatar) embed.setThumbnail(avatar);
      return interaction.editReply({ embeds: [embed] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /promote ────────────────────────────────────────────────────────────────
  if (commandName === 'promote') {
    if (!hasPermission(interaction.member)) return interaction.reply({ embeds: [errorEmbed('Permission refusee.')], ephemeral: true });
    const ok = await safeDefer(interaction);
    if (!ok) return;
    try {
      const username = interaction.options.getString('username');
      const reason = interaction.options.getString('raison') || 'Promotion';
      const robloxUser = await getRobloxUserByUsername(username);
      const roles = (await getGroupRoles()).sort((a, b) => a.rank - b.rank);
      const oldRole = await getUserGroupRole(robloxUser.id);
      if (!oldRole) return interaction.editReply({ embeds: [errorEmbed(robloxUser.name + " n'est pas dans le groupe.")] });
      const idx = roles.findIndex(r => r.id === oldRole.id);
      if (idx === -1 || idx >= roles.length - 1) return interaction.editReply({ embeds: [errorEmbed(robloxUser.name + ' est deja au rang le plus eleve.')] });
      const newRole = roles[idx + 1];
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
        { name: 'Raison', value: reason }
      )], components: [row] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /demote ─────────────────────────────────────────────────────────────────
  if (commandName === 'demote') {
    if (!hasPermission(interaction.member)) return interaction.reply({ embeds: [errorEmbed('Permission refusee.')], ephemeral: true });
    const ok = await safeDefer(interaction);
    if (!ok) return;
    try {
      const username = interaction.options.getString('username');
      const reason = interaction.options.getString('raison') || 'Retrogradation';
      const robloxUser = await getRobloxUserByUsername(username);
      const roles = (await getGroupRoles()).sort((a, b) => a.rank - b.rank);
      const oldRole = await getUserGroupRole(robloxUser.id);
      if (!oldRole) return interaction.editReply({ embeds: [errorEmbed(robloxUser.name + " n'est pas dans le groupe.")] });
      const idx = roles.findIndex(r => r.id === oldRole.id);
      if (idx <= 0) return interaction.editReply({ embeds: [errorEmbed(robloxUser.name + ' est deja au rang le plus bas.')] });
      const newRole = roles[idx - 1];
      const changeId = interaction.id + '-' + Date.now();
      pendingChanges.set(changeId, { userId: robloxUser.id, newRoleId: newRole.id, robloxUser, oldRole, newRole, reason, requesterId: interaction.user.id, auditAction: 'DEMOTE' });
      setTimeout(() => pendingChanges.delete(changeId), 60000);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirmer::' + changeId).setLabel('Confirmer la retrogradation').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('annuler::' + changeId).setLabel('Annuler').setStyle(ButtonStyle.Secondary)
      );
      return interaction.editReply({ embeds: [baseEmbed().setDescription('Confirmer la retrogradation ?').addFields(
        { name: 'Utilisateur', value: robloxUser.name },
        { name: 'Ancien rang', value: oldRole.name, inline: true },
        { name: 'Nouveau rang', value: newRole.name, inline: true },
        { name: 'Raison', value: reason }
      )], components: [row] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /setrank ────────────────────────────────────────────────────────────────
  if (commandName === 'setrank') {
    if (!hasPermission(interaction.member)) return interaction.reply({ embeds: [errorEmbed('Permission refusee.')], ephemeral: true });
    const ok = await safeDefer(interaction);
    if (!ok) return;
    try {
      const username = interaction.options.getString('username');
      const rankName = interaction.options.getString('rang');
      const robloxUser = await getRobloxUserByUsername(username);
      const roles = await getGroupRoles();
      const newRole = roles.find(r => r.name.toLowerCase() === rankName.toLowerCase());
      if (!newRole) return interaction.editReply({ embeds: [errorEmbed('Rang introuvable. Disponibles : ' + roles.map(r => r.name).join(', '))] });
      const oldRole = await getUserGroupRole(robloxUser.id);
      const changeId = interaction.id + '-' + Date.now();
      pendingChanges.set(changeId, { userId: robloxUser.id, newRoleId: newRole.id, robloxUser, oldRole, newRole, reason: 'Definition manuelle', requesterId: interaction.user.id, auditAction: 'SETRANK' });
      setTimeout(() => pendingChanges.delete(changeId), 60000);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirmer::' + changeId).setLabel('Confirmer').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('annuler::' + changeId).setLabel('Annuler').setStyle(ButtonStyle.Danger)
      );
      return interaction.editReply({ embeds: [baseEmbed().setDescription('Confirmer le changement de rang ?').addFields(
        { name: 'Utilisateur', value: robloxUser.name },
        { name: 'Rang actuel', value: oldRole?.name ?? 'Invite', inline: true },
        { name: 'Nouveau rang', value: newRole.name, inline: true }
      )], components: [row] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /ranklog ────────────────────────────────────────────────────────────────
  if (commandName === 'ranklog') {
    const page = Math.max(1, interaction.options.getInteger('page') || 1);
    const PER_PAGE = 10;
    const total = await RankLog.countDocuments();
    if (!total) return interaction.reply({ embeds: [baseEmbed().setDescription('Aucun changement de rang enregistre.')] });
    const totalPages = Math.ceil(total / PER_PAGE);
    const pageNum = Math.min(page, totalPages);
    const logs = await RankLog.find().sort({ timestamp: -1 }).skip((pageNum - 1) * PER_PAGE).limit(PER_PAGE);
    const lines = logs.map((log, i) => {
      const date = new Date(log.timestamp).toLocaleDateString('fr-FR');
      return '**' + ((pageNum - 1) * PER_PAGE + i + 1) + '.** `' + log.robloxUsername + '` - ' + log.oldRank + ' -> ' + log.newRank + '\n> par <@' + log.staffDiscordId + '> - ' + date;
    }).join('\n\n');
    return interaction.reply({ embeds: [baseEmbed().setDescription('**Journal des rangs - Page ' + pageNum + '/' + totalPages + '**\n\n' + lines).setFooter({ text: 'Stradaz Cafe - ' + total + ' entrees au total', iconURL: IMAGE })] });
  }

  // ── /logstats ───────────────────────────────────────────────────────────────
  if (commandName === 'logstats') {
    const total = await RankLog.countDocuments();
    if (!total) return interaction.reply({ embeds: [baseEmbed().setDescription('Aucun journal.')] });
    const staffAgg = await RankLog.aggregate([{ $group: { _id: '$staffDiscordId', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 5 }]);
    const rankAgg = await RankLog.aggregate([{ $group: { _id: '$newRank', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 5 }]);
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayCount = await RankLog.countDocuments({ timestamp: { $gte: todayStart } });
    return interaction.reply({ embeds: [baseEmbed().setDescription('Statistiques du journal').addFields(
      { name: 'Total', value: String(total), inline: true },
      { name: "Aujourd'hui", value: String(todayCount), inline: true },
      { name: 'Top staff', value: staffAgg.map((s, i) => '**' + (i+1) + '.** <@' + s._id + '> - ' + s.count).join('\n') || 'Aucun' },
      { name: 'Rangs les plus donnes', value: rankAgg.map((r, i) => '**' + (i+1) + '.** ' + r._id + ' - ' + r.count + ' fois').join('\n') || 'Aucun' }
    )] });
  }

  // ── /clearlog ───────────────────────────────────────────────────────────────
  if (commandName === 'clearlog') {
    if (!hasPermission(interaction.member)) return interaction.reply({ embeds: [errorEmbed('Permission refusee.')], ephemeral: true });
    const changeId = interaction.id + '-' + Date.now();
    pendingChanges.set(changeId, { requesterId: interaction.user.id });
    setTimeout(() => pendingChanges.delete(changeId), 30000);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('confirmer_clearlog::' + changeId).setLabel('Oui, tout effacer').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('annuler::' + changeId).setLabel('Annuler').setStyle(ButtonStyle.Secondary)
    );
    return interaction.reply({ embeds: [baseEmbed().setDescription('Etes-vous sur de vouloir effacer tout le journal ? Action irreversible.')], components: [row], ephemeral: true });
  }

  // ── /own ────────────────────────────────────────────────────────────────────
  if (commandName === 'own') {
    const ok = await safeDefer(interaction);
    if (!ok) return;
    try {
      const username  = interaction.options.getString('username');
      const passQuery = interaction.options.getString('gamepass').toLowerCase();
      const robloxUser = await getRobloxUserByUsername(username);
      const passes = await getGamePasses();
      if (!passes.length) return interaction.editReply({ embeds: [errorEmbed('Aucun gamepass trouve pour ce jeu.')] });
      const matched = passes.filter(p => p.name.toLowerCase().includes(passQuery));
      if (!matched.length) {
        const names = passes.map(p => '`' + p.name + '`').join(', ');
        return interaction.editReply({ embeds: [errorEmbed('Gamepass introuvable. Disponibles : ' + names)] });
      }
      const gamePass = matched[0];
      const owns = await userOwnsGamePass(robloxUser.id, gamePass.id);
      const avatar = await getRobloxAvatar(robloxUser.id);
      const statusEmoji = owns ? '✅' : '❌';
      const statusText  = owns
        ? robloxUser.name + ' possede ce gamepass.'
        : robloxUser.name + ' ne possede pas ce gamepass.';
      const embed = baseEmbed()
        .setDescription(statusEmoji + ' **Verification de Gamepass**')
        .setColor(owns ? 0x2ecc71 : 0xe74c3c)
        .addFields(
          { name: 'Utilisateur', value: robloxUser.name, inline: true },
          { name: 'Gamepass', value: gamePass.name, inline: true },
          { name: 'Jeu', value: 'Stradaz Cafe (`' + GAME_ID + '`)', inline: false },
          { name: 'Statut', value: statusText, inline: false }
        );
      if (avatar) embed.setThumbnail(avatar);
      if (matched.length > 1) {
        const others = matched.slice(1).map(p => '`' + p.name + '`').join(', ');
        embed.addFields({ name: 'Autres correspondances ignorees', value: others });
      }
      return interaction.editReply({ embeds: [embed] });
    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }

  // ── /ban ────────────────────────────────────────────────────────────────────
  if (commandName === 'ban') {
    // Permission check — HR only
    if (!hasHRPermission(interaction.member)) {
      return interaction.reply({ embeds: [errorEmbed('Permission refusee. Commande reservee aux RH.')], ephemeral: true });
    }

    // Config check
    if (!OPEN_CLOUD_API_KEY) {
      return interaction.reply({ embeds: [errorEmbed('OPEN_CLOUD_API_KEY manquant dans le fichier .env')], ephemeral: true });
    }

    const username   = interaction.options.getString('username');
    const game       = interaction.options.getString('game');
    const reason     = interaction.options.getString('reason');
    const gameLabel  = game === 'main' ? 'Main Game' : 'Training Center';
    const universeId = game === 'main' ? MAIN_UNIVERSE_ID : TRAINING_UNIVERSE_ID;

    if (!universeId) {
      return interaction.reply({ embeds: [errorEmbed(`Universe ID pour **${gameLabel}** manquant dans le fichier .env`)], ephemeral: true });
    }

    const ok = await safeDefer(interaction, { ephemeral: true });
    if (!ok) return;

    try {
      // 1. Resolve Roblox user
      const robloxUser = await getRobloxUserByUsername(username);

      // 2. Check for existing ban
      const existing = await Ban.findOne({ robloxUsername: username.toLowerCase(), game, active: true });
      if (existing) {
        return interaction.editReply({ embeds: [errorEmbed(`**${username}** est deja banni du **${gameLabel}**.\n> Raison : ${existing.reason}`)] });
      }

      // 3. Show confirmation with Confirm / Cancel buttons
      const changeId = interaction.id + '-' + Date.now();
      pendingChanges.set(changeId, {
        username,
        userId: robloxUser.id,
        game,
        reason,
        gameLabel,
        universeId,
        requesterId: interaction.user.id,
      });
      setTimeout(() => pendingChanges.delete(changeId), 60000);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirmer_ban::' + changeId).setLabel('✅ Confirmer le ban').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('annuler::' + changeId).setLabel('Annuler').setStyle(ButtonStyle.Secondary)
      );

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('⚠️ Confirmer le Bannissement')
            .setColor(0xff8800)
            .setThumbnail(IMAGE)
            .addFields(
              { name: 'Utilisateur', value: username,   inline: true },
              { name: 'Jeu',         value: gameLabel,  inline: true },
              { name: 'Raison',      value: reason },
            )
            .setDescription('Etes-vous sur de vouloir bannir definitivement ce joueur ?')
            .setTimestamp()
            .setFooter({ text: 'Stradaz Cafe - Systeme de Bannissement', iconURL: IMAGE })
        ],
        components: [row],
      });

    } catch (err) { return interaction.editReply({ embeds: [errorEmbed(err.message)] }); }
  }
});

// ─── Startup ──────────────────────────────────────────────────────────────────

client.once('ready', async () => {
  console.log('Connecte en tant que ' + client.user.tag);
  client.user.setActivity('Stradaz Cafe', { type: ActivityType.Watching });
  await registerCommands();
  console.log('Bot pret.');
});

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('MongoDB connecte.');
    client.login(DISCORD_TOKEN);
  })
  .catch(err => console.error('Erreur MongoDB:', err.message));
