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
app.get('/', (req, res) => res.send('Bot is running!'));
app.listen(process.env.PORT || 3020, () => console.log('Web server running'));

const DISCORD_TOKEN  = process.env.DISCORD_TOKEN;
const CLIENT_ID      = process.env.CLIENT_ID;
const GUILD_ID       = process.env.GUILD_ID;
const ROBLOX_COOKIE  = process.env.ROBLOX_COOKIE;
const GROUP_ID       = '11350952'; // hardcoded - dotenv fails to load this for unknown reason
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const MONGODB_URI    = process.env.MONGODB_URI;
const STAFF_ROLE_ID  = process.env.STAFF_ROLE_ID;

console.log('TOKEN:', DISCORD_TOKEN ? 'OK' : 'MISSING');
console.log('MONGODB:', MONGODB_URI ? 'OK' : 'MISSING');
console.log('[DEBUG] GROUP_ID:', GROUP_ID);

const IMAGE = 'https://gpi.hyra.io/11350952/icon';

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
  console.log(`[getGroupRoles] Fetching roles for GROUP_ID=${GROUP_ID}`);
  const res = await axios.get(`https://groups.roblox.com/v1/groups/${GROUP_ID}/roles`);
  const roles = res.data.roles;
  console.log(`[getGroupRoles] Found ${roles.length} role(s):`, roles.map(r => `${r.name}(rank:${r.rank})`).join(', '));
  return roles;
}

async function getUserGroupRole(userId) {
  console.log(`[getUserGroupRole] Fetching groups for userId=${userId} | Expecting GROUP_ID=${GROUP_ID} (parsed: ${parseInt(GROUP_ID)})`);
  const res = await axios.get(`https://groups.roblox.com/v2/users/${userId}/groups/roles`);
  const groups = res.data.data;
  console.log(`[getUserGroupRole] User is in ${groups.length} group(s):`);
  groups.forEach(g =>
    console.log(`  -> groupId=${g.group.id} (type: ${typeof g.group.id}) | name="${g.group.name}" | role="${g.role?.name}" | rank=${g.role?.rank}`)
  );
  const m = groups.find(g => g.group.id === parseInt(GROUP_ID));
  if (!m) {
    console.warn(`[getUserGroupRole] No match for GROUP_ID=${GROUP_ID}. User may not be in the group, or GROUP_ID is wrong.`);
  } else {
    console.log(`[getUserGroupRole] Match found: role="${m.role?.name}", rank=${m.role?.rank}`);
  }
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
  console.log(`[setGroupRank] Setting rank for userId=${userId} to roleId=${roleId}`);
  await axios.patch(
    `https://groups.roblox.com/v1/groups/${GROUP_ID}/users/${userId}`,
    { roleId },
    { headers: { Cookie: `.ROBLOSECURITY=${ROBLOX_COOKIE}`, 'X-CSRF-TOKEN': await getCsrfToken() } }
  );
  console.log(`[setGroupRank] Rank set successfully.`);
}

async function getRobloxAvatar(userId) {
  try {
    const res = await axios.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png`);
    return res.data.data[0]?.imageUrl || null;
  } catch { return null; }
}

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

function hasPermission(member) {
  if (!STAFF_ROLE_ID) return true;
  return member.roles.cache.has(STAFF_ROLE_ID);
}

async function sendLogToChannel(embed) {
  if (!LOG_CHANNEL_ID) return;
  try {
    const ch = await client.channels.fetch(LOG_CHANNEL_ID);
    if (ch) await ch.send({ embeds: [embed] });
  } catch { }
}

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
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: commands.map(c => c.toJSON())
  });
  console.log('Commandes enregistrees.');
}

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
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

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
});

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