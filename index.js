/**
 * Askzinho — Bot Discord Oficial (QG do Gusta · TikTok & VLR)
 * Recursos integrados:
 * - Música estilo Rythm/Groovy com playlists personalizadas para calls
 * - Pedidos em tempo real em #🕷️•𝔐𝔲́𝔰𝔦𝔠𝔞 + !modskip rápido para moderadores
 * - Criação automática dos 9 cargos de elos do VALORANT (Ferro a Radiante)
 * - Vínculo de conta Riot + Fallback de seleção manual via menu interativo
   * - Servidor HTTP Keep-Alive embutido (0.0.0.0:PORT / rota /health) pronto para Render + UptimeRobot
 */

import 'dotenv/config';
import http from 'node:http';
import {
  ActionRowBuilder,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { DisTube } from 'distube';
import { YouTubePlugin } from '@distube/youtube';

const BOT_NAME = "Askzinho";
const PORT = Number(process.env.PORT) || 10000;
const PREFIX = "!";
const REQUEST_CHANNEL_NAME = "🕷️•𝔐𝔲́𝔰𝔦𝔠𝔞";
const RANKUP_CHANNEL_NAME = "upou-de-elo";
const MODLOG_CHANNEL_NAME = "auditoria-mod";
const BLOCKED_TERMS = ["estourado","gemidao","999db","proibidão","dmca strike"];

const VALORANT_ROLES = [
  {
    "id": "ferro",
    "name": "Ferro",
    "color": "#6B7280"
  },
  {
    "id": "bronze",
    "name": "Bronze",
    "color": "#A16207"
  },
  {
    "id": "prata",
    "name": "Prata",
    "color": "#CBD5E1"
  },
  {
    "id": "ouro",
    "name": "Ouro",
    "color": "#EAB308"
  },
  {
    "id": "platina",
    "name": "Platina",
    "color": "#06B6D4"
  },
  {
    "id": "diamante",
    "name": "Diamante",
    "color": "#C084FC"
  },
  {
    "id": "ascendente",
    "name": "Ascendente",
    "color": "#10B981"
  },
  {
    "id": "imortal",
    "name": "Imortal",
    "color": "#E11D48"
  },
  {
    "id": "radiante",
    "name": "Radiante",
    "color": "#FDE047"
  }
];

const CUSTOM_PLAYLISTS = {
  "Aquecimento Live TikTok": [
    "Abertura Neon Sem DMCA - Synth Club BR",
    "Phonk Limpo para Highlights - Koda Studio"
  ],
  "Ranked VALORANT Tryhard": [
    "Clutch 1v5 em Bind - Drill Arena",
    "Retake Rápido - Koda Studio"
  ],
  "Lo-Fi Resenha pós-Live": [
    "Chuva em Tóquio Lo-Fi - Café Bit"
  ]
};

const linkedAccounts = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
});

// Servidor HTTP Keep-Alive obrigatório para Render (Web Service Free) + ping do UptimeRobot
const keepAliveServer = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        status: 'ok',
        bot: BOT_NAME,
        discordReady: client.isReady(),
        pingMs: client.ws.ping,
        uptimeSec: Math.floor(process.uptime()),
      })
    );
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});

keepAliveServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[${BOT_NAME}] Keep-Alive HTTP ativo em 0.0.0.0:${PORT} (/health pronto para Render e UptimeRobot)`);
});

const distube = new DisTube(client, {
  emitNewSongOnly: true,
  plugins: [new YouTubePlugin()],
});

async function sendAuditLog(guild, { category, action, actorTag, target, reason, before, after }) {
  const logChannel = guild.channels.cache.find((c) => c.name === MODLOG_CHANNEL_NAME && c.isTextBased());
  if (!logChannel) return;

  const embed = new EmbedBuilder()
    .setColor(category === 'MOD_SKIP' ? 0xe11d48 : 0x3b82f6)
    .setTitle(`Auditoria · ${action}`)
    .addFields(
      { name: 'Responsável', value: actorTag, inline: true },
      { name: 'Alvo', value: target, inline: true },
      { name: 'Motivo / Origem', value: reason || 'Não informado' },
      ...(before ? [{ name: 'Antes', value: before, inline: true }] : []),
      ...(after ? [{ name: 'Depois', value: after, inline: true }] : [])
    )
    .setTimestamp();

  await logChannel.send({ embeds: [embed] });
}

async function ensureValorantRoles(guild, actorTag) {
  const created = [];
  for (const tier of [...VALORANT_ROLES].reverse()) {
    let role = guild.roles.cache.find((r) => r.name.toLowerCase() === tier.name.toLowerCase());
    if (!role) {
      role = await guild.roles.create({
        name: tier.name,
        color: tier.color,
        reason: 'Provisionamento automático de cargos VALORANT',
      });
      created.push(tier.name);
    }
  }
  await sendAuditLog(guild, {
    category: 'ROLES',
    action: 'Sincronização de Cargos VALORANT',
    actorTag,
    target: 'Hierarquia Ferro → Radiante',
    reason: created.length ? `Criados: ${created.join(', ')}` : 'Todos os 9 cargos já estavam ativos',
  });
  return created;
}

async function fetchValorantRank(region, name, tag) {
  const headers = { Accept: 'application/json' };
  if (process.env.HENRIK_API_KEY) headers.Authorization = process.env.HENRIK_API_KEY;
  const res = await fetch(
    `https://api.henrikdev.xyz/valorant/v1/mmr/${encodeURIComponent(region)}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`,
    { headers }
  );
  if (!res.ok) return null;
  const json = await res.json();
  const patched = json?.data?.currenttierpatched;
  if (!patched) return null;

  const mapEnToPt = {
    Iron: 'Ferro',
    Bronze: 'Bronze',
    Silver: 'Prata',
    Gold: 'Ouro',
    Platinum: 'Platina',
    Diamond: 'Diamante',
    Ascendant: 'Ascendente',
    Immortal: 'Imortal',
    Radiant: 'Radiante',
  };
  const enBase = patched.split(' ')[0];
  const ptRoleName = mapEnToPt[enBase] || 'Ferro';
  const tierOrder = VALORANT_ROLES.findIndex((r) => r.name === ptRoleName) + 1;
  return {
    ptRoleName,
    fullRankLabel: patched.replace(enBase, ptRoleName),
    rr: json?.data?.ranking_in_tier ?? 0,
    tierOrder,
  };
}

async function applyValorantRole(member, ptRoleName, origin, actorTag, fullRankLabel = ptRoleName) {
  const allRoleNames = VALORANT_ROLES.map((r) => r.name.toLowerCase());
  const previousRoles = member.roles.cache.filter((r) => allRoleNames.includes(r.name.toLowerCase()));
  const prevLabel = previousRoles.first()?.name || 'Sem Cargo de Elo';

  let targetRole = member.guild.roles.cache.find((r) => r.name.toLowerCase() === ptRoleName.toLowerCase());
  if (!targetRole) {
    await ensureValorantRoles(member.guild, client.user.tag);
    targetRole = member.guild.roles.cache.find((r) => r.name.toLowerCase() === ptRoleName.toLowerCase());
  }

  if (previousRoles.size > 0) await member.roles.remove(previousRoles);
  if (targetRole) await member.roles.add(targetRole);

  await sendAuditLog(member.guild, {
    category: 'ROLES',
    action: 'Registro de Alteração de Cargo',
    actorTag,
    target: member.user.tag,
    reason: origin,
    before: prevLabel,
    after: fullRankLabel,
  });

  return prevLabel;
}

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  if (!message.content.startsWith(PREFIX)) return;

  const [cmdRaw, ...args] = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = cmdRaw.toLowerCase();
  const query = args.join(' ');

  if (cmd === 'play' || cmd === 'p') {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) return message.reply('Entre em uma call de voz no Discord para pedir música!');
    if (BLOCKED_TERMS.some((term) => query.toLowerCase().includes(term.toLowerCase()))) {
      await sendAuditLog(message.guild, {
        category: 'MOD_SKIP',
        action: 'Pedido Bloqueado Automaticamente',
        actorTag: client.user.tag,
        target: `${query} (${message.author.tag})`,
        reason: 'Palavra bloqueada nas regras da call no Discord',
      });
      return message.reply('Essa música contém palavras bloqueadas nas regras da call.');
    }
    await distube.play(voiceChannel, query, {
      member: message.member,
      textChannel: message.channel,
      message,
    });
  }

  if (cmd === 'playlist') {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) return message.reply('Entre em um canal de voz primeiro.');
    const foundKey = Object.keys(CUSTOM_PLAYLISTS).find((k) =>
      k.toLowerCase().includes(query.toLowerCase())
    );
    if (!foundKey) {
      return message.reply(`Playlists disponíveis: ${Object.keys(CUSTOM_PLAYLISTS).join(' · ')}`);
    }
    for (const trackQuery of CUSTOM_PLAYLISTS[foundKey]) {
      await distube.play(voiceChannel, trackQuery, {
        member: message.member,
        textChannel: message.channel,
      });
    }
    return message.reply(`Playlist **${foundKey}** adicionada à call!`);
  }

  if (cmd === 'skip' || cmd === 's') {
    const queue = distube.getQueue(message);
    if (!queue) return message.reply('Nenhuma música na fila.');
    await queue.skip();
    return message.reply('Faixa pulada!');
  }

  if (cmd === 'modskip' || cmd === 'forceskip') {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return message.reply('Apenas moderadores podem usar o Mod Skip.');
    }
    const queue = distube.getQueue(message);
    if (!queue || !queue.songs[0]) return message.reply('Nenhuma faixa ativa.');
    const removed = queue.songs[0];
    const reason = query || 'Faixa inadequada para a call';
    if (queue.songs.length > 1) await queue.skip();
    else await queue.stop();

    await sendAuditLog(message.guild, {
      category: 'MOD_SKIP',
      action: 'Mod Skip — Remoção Rápida',
      actorTag: message.author.tag,
      target: `${removed.name} (pedido por ${removed.user?.tag || 'desconhecido'})`,
      reason,
      before: removed.name,
      after: queue.songs[1]?.name || 'Fila encerrada',
    });
    return message.channel.send(`Faixa **${removed.name}** removida pela moderação (${reason}).`);
  }

  if (cmd === 'vincular') {
    const [riotName, riotTag] = query.split('#');
    if (!riotName || !riotTag) {
      return message.reply(`Use: ${PREFIX}vincular Nome#TAG (ex: ${PREFIX}vincular Jogador#BR1)`);
    }
    const rankData = await fetchValorantRank('br', riotName, riotTag);
    if (!rankData) {
      const select = new StringSelectMenuBuilder()
        .setCustomId('manual_valorant_role')
        .setPlaceholder('Não foi possível ler a API Riot — escolha seu elo manualmente')
        .addOptions(VALORANT_ROLES.map((r) => ({ label: r.name, value: r.name })));

      return message.reply({
        content: 'Conta privada ou API indisponível no momento. Selecione seu cargo manualmente abaixo:',
        components: [new ActionRowBuilder().addComponents(select)],
      });
    }

    await applyValorantRole(
      message.member,
      rankData.ptRoleName,
      'Vínculo Automático Riot',
      client.user.tag,
      rankData.fullRankLabel
    );
    linkedAccounts.set(message.author.id, {
      guildId: message.guild.id,
      riotName,
      riotTag,
      region: 'br',
      lastTierOrder: rankData.tierOrder,
      lastRankName: rankData.fullRankLabel,
    });
    return message.reply(
      `Conta **${riotName}#${riotTag}** vinculada! Cargo atualizado para **${rankData.fullRankLabel}** (${rankData.rr} RR).`
    );
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId === 'manual_valorant_role') {
    const chosenRole = interaction.values[0];
    await applyValorantRole(
      interaction.member,
      chosenRole,
      'Seleção Manual pelo Membro',
      interaction.user.tag
    );
    await interaction.reply({
      content: `Cargo **${chosenRole}** atribuído manualmente e registrado na auditoria!`,
      ephemeral: true,
    });
  }
});

setInterval(async () => {
  for (const [userId, account] of linkedAccounts.entries()) {
    const rankData = await fetchValorantRank(account.region, account.riotName, account.riotTag);
    if (!rankData || rankData.tierOrder <= account.lastTierOrder) continue;

    const guild = client.guilds.cache.get(account.guildId);
    if (!guild) continue;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) continue;

    const oldRank = account.lastRankName;
    account.lastTierOrder = rankData.tierOrder;
    account.lastRankName = rankData.fullRankLabel;

    await applyValorantRole(
      member,
      rankData.ptRoleName,
      'Subida de Patente Automática',
      client.user.tag,
      rankData.fullRankLabel
    );

    const rankUpChannel = guild.channels.cache.find(
      (c) => c.name === RANKUP_CHANNEL_NAME && c.isTextBased()
    );
    if (rankUpChannel) {
      await rankUpChannel.send(
        `Parabéns <@${userId}> (**${account.riotName}#${account.riotTag}**)! Subiu de **${oldRank}** para **${rankData.fullRankLabel}** (${rankData.rr} RR)!`
      );
    }
  }
}, 15 * 60 * 1000);

// Registro automático dos Slash Commands ao iniciar no Render (dispensa acesso pago ao Shell)
client.once('ready', async () => {
  console.log(`[${BOT_NAME}] Conectado no Discord como ${client.user.tag}`);
  if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_GUILD_ID) {
    try {
      const slashCommands = [
        new SlashCommandBuilder()
          .setName('play')
          .setDescription('Toca uma música ou adiciona à fila da call')
          .addStringOption((opt) => opt.setName('busca').setDescription('Nome ou link').setRequired(true)),
        new SlashCommandBuilder()
          .setName('modskip')
          .setDescription('Pula imediatamente uma faixa inadequada e grava na auditoria')
          .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
          .addStringOption((opt) => opt.setName('motivo').setDescription('Motivo da remoção').setRequired(true)),
        new SlashCommandBuilder()
          .setName('criar-cargos-valorant')
          .setDescription('Cria e ordena os 9 cargos de elos do VALORANT no servidor')
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
        new SlashCommandBuilder()
          .setName('vincular')
          .setDescription('Vincula sua conta Riot para atualizar seu cargo de elo automaticamente')
          .addStringOption((opt) => opt.setName('riotid').setDescription('Formato Nome#TAG').setRequired(true)),
        new SlashCommandBuilder()
          .setName('cargo-manual')
          .setDescription('Abre o seletor manual de cargo de elo do VALORANT'),
      ].map((c) => c.toJSON());

      const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
      await rest.put(
        Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
        { body: slashCommands }
      );
      console.log(`[${BOT_NAME}] Slash commands sincronizados automaticamente!`);
    } catch (err) {
      console.error('Aviso ao sincronizar slash commands:', err);
    }
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
