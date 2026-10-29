/**
 * Askzinho — Bot Discord Oficial (QG do Gusta · TikTok & VLR)
 * Recursos integrados:
 * - Motor de Áudio Nativo (@discordjs/voice + DAVE E2EE + Node Stream -> FFmpeg stdin pipe:0)
 *   100% imune ao crash SIGSEGV do ffmpeg-static em containers Linux (Render) e bloqueios de IP
 * - Aceita nome da música, links do YouTube, Spotify e SoundCloud + playlists personalizadas
 * - Pedidos em tempo real em #🕷️•𝔐𝔲́𝔰𝔦𝔠𝔞 + !modskip / /modskip rápido para moderadores
 * - Criação automática dos 9 cargos de elos do VALORANT (Ferro a Radiante)
 * - Vínculo de conta Riot + Fallback de seleção manual via menu interativo em qualquer servidor
 * - Servidor HTTP Keep-Alive embutido (0.0.0.0:PORT / rota /health) pronto para Render + UptimeRobot
 */

import 'dotenv/config';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  ModalBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  generateDependencyReport,
  joinVoiceChannel,
} from '@discordjs/voice';
import ffmpegPath from 'ffmpeg-static';

const require = createRequire(import.meta.url);
const { Soundcloud } = require('soundcloud.ts');
const soundcloud = new Soundcloud();

const BOT_NAME = "Askzinho";
const PORT = Number(process.env.PORT) || 10000;
const PREFIX = "!";
const REQUEST_CHANNEL_NAME = "🕷️•𝔐𝔲́𝔰𝔦𝔠𝔞";
const ELO_PANEL_CHANNEL_NAME = "🕷️•𝕰𝖑𝖔";
const TICKET_PANEL_CHANNEL_NAME = "🕷️•𝕿𝖎𝖈𝖐𝖊𝖙𝖘";
const RANKUP_CHANNEL_NAME = "upou-de-elo";
const MODLOG_CHANNEL_NAME = "auditoria-mod";
const DEFAULT_VOLUME = 40;
const BLOCKED_TERMS = ["estourado","gemidao","999db","proibidão","áudio troll"];

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
const guildQueues = new Map();

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
        activeCalls: guildQueues.size,
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

// ============================================================================
// MOTOR DE ÁUDIO CLOUD-SAFE (Node fetch -> FFmpeg pipe:0 -> Opus 48kHz Stereo)
// ============================================================================

function formatDurationMs(ms) {
  const totalSec = Math.max(0, Math.round((ms || 0) / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function resolveSongQuery(rawQuery, requestedByTag) {
  let searchQuery = rawQuery.trim();

  // Converte links do YouTube em busca por título+canal via oEmbed oficial (não sofre bloqueio de IP)
  if (/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch|youtu\.be\/)/i.test(searchQuery)) {
    try {
      const oembedRes = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(searchQuery)}&format=json`
      );
      if (oembedRes.ok) {
        const meta = await oembedRes.json();
        searchQuery = `${meta.title} ${meta.author_name || ''}`.trim();
      }
    } catch {}
  }

  // Converte links do Spotify em busca por título via oEmbed oficial
  if (/^https?:\/\/open\.spotify\.com\/track\//i.test(searchQuery)) {
    try {
      const spRes = await fetch(
        `https://open.spotify.com/oembed?url=${encodeURIComponent(searchQuery)}`
      );
      if (spRes.ok) {
        const meta = await spRes.json();
        if (meta.title) searchQuery = meta.title;
      }
    } catch {}
  }

  // Link direto do SoundCloud
  if (/^https?:\/\/(?:www\.|m\.)?soundcloud\.com\//i.test(searchQuery)) {
    const cleanUrl = searchQuery.replace(/:\/\/(m|www)\./i, '://');
    const track = await soundcloud.tracks.get(cleanUrl);
    if (!track) throw new Error('Faixa do SoundCloud não encontrada.');
    return {
      title: track.title,
      url: track.permalink_url,
      durationFormatted: formatDurationMs(track.duration),
      requestedByTag,
      trackObj: track,
    };
  }

  // Busca por nome da música / artista
  const results = await soundcloud.tracks.search({ q: searchQuery, limit: 8 });
  const list = results?.collection || [];
  if (!list.length) {
    throw new Error(`Nenhum resultado encontrado para "${searchQuery}".`);
  }

  const chosen =
    list.find(
      (t) =>
        t.media?.transcodings?.length > 0 &&
        !t.media.transcodings.some((tr) => tr.snipped) &&
        t.duration > 35000
    ) ||
    list.find((t) => t.media?.transcodings?.length > 0) ||
    list[0];

  return {
    title: chosen.title,
    url: chosen.permalink_url,
    durationFormatted: formatDurationMs(chosen.duration),
    requestedByTag,
    trackObj: chosen,
  };
}

async function* downloadAudioStream(streamUrl, signal) {
  const res = await fetch(streamUrl, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar stream de áudio`);
  const contentType = res.headers.get('content-type') || '';

  if (!streamUrl.includes('.m3u8') && !contentType.includes('mpegurl')) {
    for await (const chunk of res.body) {
      if (signal.aborted) return;
      yield Buffer.from(chunk);
    }
    return;
  }

  const m3u8Text = await res.text();
  const lines = m3u8Text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (signal.aborted) return;
    if (line.startsWith('#EXT-X-MAP:URI=')) {
      const mapUrl = line.match(/URI="([^"]+)"/)?.[1];
      if (mapUrl) {
        const mapRes = await fetch(mapUrl, { signal });
        if (mapRes.ok) yield Buffer.from(await mapRes.arrayBuffer());
      }
    } else if (!line.startsWith('#')) {
      const segRes = await fetch(line, { signal });
      if (segRes.ok) yield Buffer.from(await segRes.arrayBuffer());
    }
  }
}

async function createCloudSafeAudioResource(song, volumePercent = DEFAULT_VOLUME) {
  const streamUrl =
    (await soundcloud.util.streamLink(song.trackObj || song.url, 'mpeg').catch(() => null)) ||
    (await soundcloud.util.streamLink(song.trackObj || song.url));

  if (!streamUrl) {
    throw new Error('Não foi possível obter o stream de áudio da faixa.');
  }

  const abortController = new AbortController();
  const nodeReadable = Readable.from(downloadAudioStream(streamUrl, abortController.signal));

  // CRÍTICO: -i pipe:0 lê os bytes do Node via stdin (evita o crash SIGSEGV do ffmpeg-static em HTTPS no Render)
  const ffmpegProc = spawn(
    ffmpegPath,
    ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  );

  nodeReadable.on('error', () => {});
  ffmpegProc.stdin.on('error', () => {});
  nodeReadable.pipe(ffmpegProc.stdin);

  const resource = createAudioResource(ffmpegProc.stdout, {
    inputType: StreamType.Raw,
    inlineVolume: true,
  });
  resource.volume?.setVolumeLogarithmic(Math.max(0, Math.min(1.5, volumePercent / 100)));

  const cleanup = () => {
    abortController.abort();
    nodeReadable.destroy();
    if (!ffmpegProc.killed) {
      try {
        ffmpegProc.kill('SIGKILL');
      } catch {}
    }
  };

  return { resource, cleanup };
}

function destroyGuildQueue(guildId) {
  const q = guildQueues.get(guildId);
  if (!q) return;
  q.currentCleanup?.();
  q.currentCleanup = null;
  q.songs = [];
  try {
    q.player.stop(true);
  } catch {}
  try {
    q.connection.destroy();
  } catch {}
  guildQueues.delete(guildId);
}

async function playNextInQueue(guildId) {
  const q = guildQueues.get(guildId);
  if (!q) return;

  q.currentCleanup?.();
  q.currentCleanup = null;
  q.currentResource = null;

  const nextSong = q.songs[0];
  if (!nextSong) return;

  try {
    const { resource, cleanup } = await createCloudSafeAudioResource(nextSong, q.volume);
    q.currentCleanup = cleanup;
    q.currentResource = resource;
    q.player.play(resource);

    q.textChannel
      ?.send(
        `Tocando agora na call **${q.voiceChannelName}**: **${nextSong.title}** (\`${nextSong.durationFormatted}\`) — pedido por ${nextSong.requestedByTag}`
      )
      .catch(() => {});
  } catch (err) {
    console.error(`[${BOT_NAME}] Erro ao iniciar faixa "${nextSong.title}":`, err);
    q.textChannel
      ?.send(`Erro ao reproduzir **${nextSong.title}** (\`${err.message}\`). Pulando para a próxima...`)
      .catch(() => {});
    q.songs.shift();
    if (q.songs.length > 0) {
      await playNextInQueue(guildId);
    }
  }
}

async function enqueueAndPlay({ voiceChannel, textChannel, query, requestedByTag, silentQueueNotice = false }) {
  const song = await resolveSongQuery(query, requestedByTag);
  const guildId = voiceChannel.guild.id;
  let q = guildQueues.get(guildId);

  if (!q) {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

    if (voiceChannel.type === 13) {
      await voiceChannel.guild.members.me?.voice?.setSuppressed(false).catch(() => {});
    }

    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
      },
    });

    connection.subscribe(player);

    q = {
      guildId,
      voiceChannelName: voiceChannel.name,
      textChannel,
      connection,
      player,
      songs: [],
      volume: DEFAULT_VOLUME,
      currentResource: null,
      currentCleanup: null,
    };

    guildQueues.set(guildId, q);

    player.on(AudioPlayerStatus.Idle, () => {
      const activeQ = guildQueues.get(guildId);
      if (!activeQ) return;
      activeQ.songs.shift();
      if (activeQ.songs.length > 0) {
        playNextInQueue(guildId);
      }
    });

    player.on('error', (err) => {
      console.error(`[${BOT_NAME}] Erro no AudioPlayer:`, err);
      const activeQ = guildQueues.get(guildId);
      if (!activeQ) return;
      activeQ.songs.shift();
      if (activeQ.songs.length > 0) {
        playNextInQueue(guildId);
      }
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        destroyGuildQueue(guildId);
      }
    });
  } else {
    q.textChannel = textChannel;
    q.voiceChannelName = voiceChannel.name;
    if (q.connection.joinConfig.channelId !== voiceChannel.id) {
      q.connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: false,
      });
      await entersState(q.connection, VoiceConnectionStatus.Ready, 20_000);
      q.connection.subscribe(q.player);
    }
  }

  const wasEmpty = q.songs.length === 0;
  q.songs.push(song);

  if (wasEmpty) {
    await playNextInQueue(guildId);
  } else if (!silentQueueNotice) {
    await textChannel
      .send(
        `Adicionada na fila (#${q.songs.length - 1}): **${song.title}** (\`${song.durationFormatted}\`) — pedido por ${requestedByTag}`
      )
      .catch(() => {});
  }

  return song;
}

// ============================================================================
// AUDITORIA E CARGOS DE ELOS DO VALORANT
// ============================================================================

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

function buildManualRoleRow(customId = 'manual_valorant_role') {
  const select = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('Escolha seu elo do VALORANT manualmente')
    .addOptions(VALORANT_ROLES.map((r) => ({ label: r.name, value: r.name })));
  return new ActionRowBuilder().addComponents(select);
}

// ============================================================================
// AVISO FIXO E VERIFICAÇÃO 100% PRIVADA NO CANAL ELO (SÓ MEMBRO + ADMINS)
// ============================================================================

function normalizeChannelKey(raw = '') {
  return String(raw)
    .replace(/^#/, '')
    .normalize('NFKD')
    .replace(/[\uFE00-\uFE0F\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function isEloPanelChannel(channel) {
  if (!channel || !channel.name || channel.isThread?.()) return false;
  if (channel.name === ELO_PANEL_CHANNEL_NAME) return true;
  const normTarget = normalizeChannelKey(ELO_PANEL_CHANNEL_NAME);
  const normActual = normalizeChannelKey(channel.name);
  return normActual === normTarget || normActual.endsWith('•elo') || normActual.endsWith('・elo');
}

function findEloPanelChannel(guild) {
  return guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && isEloPanelChannel(c)
  );
}

function isAdminOrMod(member) {
  if (!member?.permissions) return false;
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    member.permissions.has(PermissionFlagsBits.ManageRoles) ||
    member.permissions.has(PermissionFlagsBits.ModerateMembers)
  );
}

function buildPrivateEloNoticePayload() {
  const embed = new EmbedBuilder()
    .setColor(0xe11d48)
    .setTitle('🕷️ Verificação Privada de Elo — VALORANT')
    .setDescription(
      'Coloque o seu elo no servidor com **privacidade total** usando um dos botões abaixo.\n\n' +
        '🔒 **Como funciona:**\n' +
        '• **Vincular Riot ID (Privado):** abre uma janela particular na sua tela para informar `Nome#TAG`. Nenhum outro membro vê sua conta — ela fica **somente entre você e os Admins**.\n' +
        '• **Escolher Elo (Privado):** abre uma lista particular visível só para você e registra sua escolha diretamente para a administração.\n' +
        '• **Sala Privada c/ Admins:** abre um espaço trancado neste canal onde **apenas você e os Admins** conseguem conversar ou enviar print do elo.\n\n' +
        '*Não digite sua conta no chat aberto: mensagens comuns enviadas aqui são apagadas automaticamente para proteger sua privacidade.*'
    )
    .setFooter({ text: `${BOT_NAME} · Registro confidencial entre você e os Admins` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('open_private_riot_modal')
      .setLabel('Vincular Riot ID (Privado)')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('open_private_manual_elo')
      .setLabel('Escolher Elo (Privado)')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('open_private_admin_thread')
      .setLabel('Sala Privada c/ Admins')
      .setStyle(ButtonStyle.Primary)
  );

  return { embeds: [embed], components: [row] };
}

async function ensurePrivateEloNotice(guild, forceRepost = false) {
  const eloChannel = findEloPanelChannel(guild);
  if (!eloChannel) return false;

  try {
    if (!forceRepost) {
      const recent = await eloChannel.messages.fetch({ limit: 25 }).catch(() => null);
      const alreadyPosted = recent?.some(
        (m) =>
          m.author?.id === client.user?.id &&
          m.components?.some((row) =>
            row.components?.some((comp) => comp.customId === 'open_private_riot_modal')
          )
      );
      if (alreadyPosted) return true;
    }

    await eloChannel.send(buildPrivateEloNoticePayload());
    console.log(`[${BOT_NAME}] Aviso privado de elo publicado em #${eloChannel.name} (${guild.name})`);
    return true;
  } catch (err) {
    console.error(`[${BOT_NAME}] Erro ao enviar aviso em #${eloChannel.name}:`, err.message);
    return false;
  }
}

async function openOrGetPrivateAdminEloThread(guild, member) {
  const eloChannel = findEloPanelChannel(guild);
  if (!eloChannel || typeof eloChannel.threads?.create !== 'function') return null;

  try {
    const safeUser =
      member.user.username.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 18) || 'membro';
    const threadName = `🔒・elo-${safeUser}`;
    const active = await eloChannel.threads.fetchActive().catch(() => null);
    let thread = active?.threads.find(
      (t) => t.name === threadName && t.type === ChannelType.PrivateThread
    );

    if (!thread) {
      thread = await eloChannel.threads.create({
        name: threadName,
        autoArchiveDuration: 1440,
        type: ChannelType.PrivateThread,
        invitable: false,
        reason: `Atendimento privado de elo entre ${member.user.tag} e Admins`,
      });
    } else if (thread.archived) {
      await thread.setArchived(false).catch(() => null);
    }

    await thread.members.add(member.id).catch(() => null);
    return thread;
  } catch (err) {
    console.warn(`[${BOT_NAME}] Aviso ao criar sala privada de elo:`, err.message);
    return null;
  }
}

async function notifyAdminsPrivately(
  guild,
  member,
  { modeLabel, riotId, rankLabel, note, applied }
) {
  await sendAuditLog(guild, {
    category: 'ROLES',
    action: `Envio Privado de Elo (${ELO_PANEL_CHANNEL_NAME})`,
    actorTag: member.user.tag,
    target: `${member.user.tag}${riotId ? ` · Riot: ${riotId}` : ''}`,
    reason: `${modeLabel}${note ? ` — Obs: ${note}` : ''}`,
    after: rankLabel,
  });

  const thread = await openOrGetPrivateAdminEloThread(guild, member);
  if (!thread) return null;

  try {
    const adminSelect = new StringSelectMenuBuilder()
      .setCustomId(`admin_set_elo:${member.id}`)
      .setPlaceholder('Admin: Alterar ou confirmar cargo de elo deste membro')
      .addOptions(VALORANT_ROLES.map((r) => ({ label: `Definir ${r.name}`, value: r.name })));

    const closeBtn = new ButtonBuilder()
      .setCustomId(`close_elo_thread:${member.id}`)
      .setLabel('Arquivar Sala Privada (Admin)')
      .setStyle(ButtonStyle.Secondary);

    const embed = new EmbedBuilder()
      .setColor(0xe11d48)
      .setTitle('🔒 Registro Privado de Elo — Somente Você e Admins')
      .setDescription(
        `Olá <@${member.id}>! Este registro é **100% privado** e visível somente para você e os Administradores do servidor.`
      )
      .addFields(
        { name: 'Membro', value: `<@${member.id}> (\`${member.user.tag}\`)`, inline: true },
        { name: 'Modo', value: modeLabel, inline: true },
        {
          name: 'Conta Riot Informada',
          value: riotId ? `\`${riotId}\` *(visível só aqui e p/ Admins)*` : 'Não informada (escolha manual)',
          inline: false,
        },
        {
          name: 'Status do Cargo',
          value: applied
            ? `Cargo **${rankLabel}** aplicado no servidor`
            : `**${rankLabel}** — aguardando escolha manual ou validação dos Admins`,
          inline: false,
        },
        ...(note ? [{ name: 'Observação enviada pelo membro', value: note, inline: false }] : [])
      )
      .setTimestamp();

    await thread.send({
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(adminSelect),
        new ActionRowBuilder().addComponents(closeBtn),
      ],
    });
  } catch (err) {
    console.warn(`[${BOT_NAME}] Erro ao enviar resumo na sala privada:`, err.message);
  }

  return thread;
}

// ============================================================================
// SISTEMA DE TICKETS 100% PRIVADOS COM ADMINS (SUGESTÃO, DÚVIDA E DENÚNCIA)
// ============================================================================

const TICKET_CATEGORIES = {
  sugestao: {
    label: 'Sugestão para o Servidor',
    buttonLabel: 'Enviar Sugestão',
    color: 0x10b981,
    style: ButtonStyle.Success,
  },
  duvida: {
    label: 'Tirar Dúvida com Admins',
    buttonLabel: 'Tirar Dúvida',
    color: 0x3b82f6,
    style: ButtonStyle.Primary,
  },
  denuncia: {
    label: 'Denúncia Confidencial de Membro',
    buttonLabel: 'Denunciar Membro',
    color: 0xe11d48,
    style: ButtonStyle.Danger,
  },
};

function isTicketPanelChannel(channel) {
  if (!channel || !channel.name || channel.isThread?.()) return false;
  if (channel.name.startsWith('🔒-') || channel.topic?.startsWith('ticket-owner:')) return false;
  if (channel.name === TICKET_PANEL_CHANNEL_NAME) return true;
  const normTarget = normalizeChannelKey(TICKET_PANEL_CHANNEL_NAME);
  const normActual = normalizeChannelKey(channel.name);
  return (
    normActual === normTarget ||
    normActual === 'tickets' ||
    normActual === 'ticket' ||
    normActual.endsWith('•tickets') ||
    normActual.endsWith('・tickets') ||
    normActual.endsWith('•ticket') ||
    normActual.endsWith('・ticket')
  );
}

function findTicketPanelChannel(guild) {
  return guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && isTicketPanelChannel(c)
  );
}

function buildTicketPanelPayload() {
  const embed = new EmbedBuilder()
    .setColor(0xe11d48)
    .setTitle('📩 Central de Atendimento Privado — Fale com os Admins')
    .setDescription(
      'Precisa falar com a administração do servidor? Escolha uma categoria abaixo para abrir um **canal 100% privado** onde **somente você e os Admins** têm acesso:\n\n' +
        '💡 **Enviar Sugestão:** ideias de melhorias, eventos, playlists ou novidades para a comunidade.\n' +
        '❓ **Tirar Dúvida:** suporte sobre cargos, regras, calls ou funcionamento do servidor.\n' +
        '🚨 **Denunciar Membro:** relato sigiloso sobre ofensas, toxicidade, trollagem em call ou quebra de regras (você poderá anexar prints e clipes dentro do ticket privado).\n\n' +
        '*Você também pode usar `/ticket` em qualquer canal do servidor.*'
    )
    .setFooter({ text: `${BOT_NAME} · Atendimento sigiloso entre você e a Administração` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('open_ticket_modal:sugestao')
      .setLabel(TICKET_CATEGORIES.sugestao.buttonLabel)
      .setStyle(TICKET_CATEGORIES.sugestao.style),
    new ButtonBuilder()
      .setCustomId('open_ticket_modal:duvida')
      .setLabel(TICKET_CATEGORIES.duvida.buttonLabel)
      .setStyle(TICKET_CATEGORIES.duvida.style),
    new ButtonBuilder()
      .setCustomId('open_ticket_modal:denuncia')
      .setLabel(TICKET_CATEGORIES.denuncia.buttonLabel)
      .setStyle(TICKET_CATEGORIES.denuncia.style)
  );

  return { embeds: [embed], components: [row] };
}

async function ensureTicketPanelNotice(guild, forceRepost = false, explicitChannel = null) {
  const targetChannel = explicitChannel || findTicketPanelChannel(guild);
  if (!targetChannel || !targetChannel.isTextBased?.()) return null;

  try {
    if (!forceRepost) {
      const recent = await targetChannel.messages.fetch({ limit: 25 }).catch(() => null);
      const alreadyPosted = recent?.some(
        (m) =>
          m.author?.id === client.user?.id &&
          m.components?.some((row) =>
            row.components?.some((comp) => comp.customId === 'open_ticket_modal:denuncia')
          )
      );
      if (alreadyPosted) return targetChannel;
    }

    await targetChannel.send(buildTicketPanelPayload());
    console.log(`[${BOT_NAME}] Painel de tickets publicado em #${targetChannel.name} (${guild.name})`);
    return targetChannel;
  } catch (err) {
    console.error(`[${BOT_NAME}] Erro ao publicar painel de tickets em #${targetChannel.name}:`, err.message);
    return null;
  }
}

function buildTicketModal(rawType) {
  const tipo = TICKET_CATEGORIES[rawType] ? rawType : 'duvida';

  if (tipo === 'denuncia') {
    const modal = new ModalBuilder()
      .setCustomId('submit_ticket_modal:denuncia')
      .setTitle('Denunciar Membro (Confidencial)');

    const accusedInput = new TextInputBuilder()
      .setCustomId('ticket_accused')
      .setLabel('Membro denunciado (@nick, nome ou ID)')
      .setPlaceholder('Ex: @jogador_toxico')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(80);

    const subjectInput = new TextInputBuilder()
      .setCustomId('ticket_subject')
      .setLabel('Motivo resumido da denúncia')
      .setPlaceholder('Ex: Ofensas na Call Ranked / Quebra de regras')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(100);

    const detailsInput = new TextInputBuilder()
      .setCustomId('ticket_details')
      .setLabel('O que aconteceu? (detalhes, canal e horário)')
      .setPlaceholder('Conte com detalhes para os Admins analisarem com sigilo...')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(1000);

    const proofInput = new TextInputBuilder()
      .setCustomId('ticket_proof')
      .setLabel('Links de prints ou clipes (opcional)')
      .setPlaceholder('Você também poderá enviar imagens direto no canal do ticket!')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(200);

    modal.addComponents(
      new ActionRowBuilder().addComponents(accusedInput),
      new ActionRowBuilder().addComponents(subjectInput),
      new ActionRowBuilder().addComponents(detailsInput),
      new ActionRowBuilder().addComponents(proofInput)
    );
    return modal;
  }

  const modal = new ModalBuilder()
    .setCustomId(`submit_ticket_modal:${tipo}`)
    .setTitle(tipo === 'sugestao' ? 'Enviar Sugestão aos Admins' : 'Tirar Dúvida com os Admins');

  const subjectInput = new TextInputBuilder()
    .setCustomId('ticket_subject')
    .setLabel(tipo === 'sugestao' ? 'Título da sua sugestão' : 'Qual é a sua dúvida?')
    .setPlaceholder(
      tipo === 'sugestao'
        ? 'Ex: Campeonato 5x5 da comunidade no fim de semana'
        : 'Ex: Como funcionam os cargos ou eventos do servidor?'
    )
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const detailsInput = new TextInputBuilder()
    .setCustomId('ticket_details')
    .setLabel(
      tipo === 'sugestao' ? 'Explique sua sugestão em detalhes' : 'Detalhes para os Admins te responderem'
    )
    .setPlaceholder('Escreva aqui sua mensagem privada para a administração...')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);

  modal.addComponents(
    new ActionRowBuilder().addComponents(subjectInput),
    new ActionRowBuilder().addComponents(detailsInput)
  );
  return modal;
}

async function openPrivateTicketRoom(guild, member, fallbackChannel, tipo) {
  const safeUser =
    member.user.username.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 16) || 'membro';
  const channelName = `🔒-${tipo}-${safeUser}`;
  const topicPrefix = `ticket-owner:${member.id} | tipo:${tipo}`;

  const existingChannel = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.topic?.startsWith(topicPrefix)
  );
  if (existingChannel) return existingChannel;

  const panelChannel = findTicketPanelChannel(guild);
  const parentId = panelChannel?.parentId || fallbackChannel?.parentId || undefined;

  const staffRoles = Array.from(
    guild.roles.cache
      .filter(
        (r) =>
          r.id !== guild.id &&
          !r.managed &&
          (r.permissions.has(PermissionFlagsBits.Administrator) ||
            r.permissions.has(PermissionFlagsBits.ManageGuild) ||
            r.permissions.has(PermissionFlagsBits.ModerateMembers))
      )
      .values()
  ).slice(0, 20);

  const permissionOverwrites = [
    {
      id: guild.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: member.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
    {
      id: client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
    ...staffRoles.map((role) => ({
      id: role.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ManageMessages,
      ],
    })),
  ];

  try {
    const createdChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: parentId,
      topic: `${topicPrefix} | Ticket privado de ${member.user.tag}`,
      permissionOverwrites,
      reason: `Ticket privado (${tipo}) aberto por ${member.user.tag}`,
    });
    return createdChannel;
  } catch (err) {
    console.warn(
      `[${BOT_NAME}] Sem permissão ManageChannels para criar canal de ticket (${err.message}); usando PrivateThread.`
    );
    const hostChannel =
      panelChannel || (fallbackChannel?.type === ChannelType.GuildText ? fallbackChannel : null);
    if (!hostChannel || typeof hostChannel.threads?.create !== 'function') return null;

    try {
      const thread = await hostChannel.threads.create({
        name: channelName,
        autoArchiveDuration: 1440,
        type: ChannelType.PrivateThread,
        invitable: false,
        reason: `Ticket privado (${tipo}) aberto por ${member.user.tag}`,
      });
      await thread.members.add(member.id).catch(() => null);
      return thread;
    } catch (threadErr) {
      console.error(`[${BOT_NAME}] Falha ao criar tópico privado de ticket:`, threadErr.message);
      return null;
    }
  }
}

const SLASH_COMMANDS_JSON = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Toca uma música ou adiciona à fila da call')
    .addStringOption((opt) =>
      opt.setName('busca').setDescription('Nome da música ou link (YouTube/Spotify/SoundCloud)').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Pula para a próxima música da fila da call'),
  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Para a música, limpa a fila e desconecta da call'),
  new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Ajusta o volume da música na call (0 a 150%)')
    .addIntegerOption((opt) =>
      opt.setName('nivel').setDescription('Volume desejado em % (padrão suave: 40)').setMinValue(0).setMaxValue(150).setRequired(true)
    ),
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
    .setName('aviso-elo')
    .setDescription('Publica o aviso de verificação privada de elo no canal configurado')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('painel-tickets')
    .setDescription('Publica o painel fixo de tickets privados (Sugestão, Dúvida e Denúncia)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Abre um ticket privado com os Admins (Sugestão, Dúvida ou Denúncia)')
    .addStringOption((opt) =>
      opt
        .setName('tipo')
        .setDescription('Escolha o motivo do ticket privado')
        .setRequired(true)
        .addChoices(
          { name: 'Enviar Sugestão', value: 'sugestao' },
          { name: 'Tirar Dúvida', value: 'duvida' },
          { name: 'Denunciar Membro (Confidencial)', value: 'denuncia' }
        )
    ),
  new SlashCommandBuilder()
    .setName('vincular')
    .setDescription('Vincula sua conta Riot em modo privado (visível só para você e Admins)')
    .addStringOption((opt) => opt.setName('riotid').setDescription('Formato Nome#TAG').setRequired(true)),
  new SlashCommandBuilder()
    .setName('cargo-manual')
    .setDescription('Abre o seletor privado de cargo de elo do VALORANT'),
].map((c) => c.toJSON());

async function syncSlashCommandsForGuild(guildId, guildName = guildId) {
  const appId = process.env.DISCORD_CLIENT_ID || client.user?.id;
  if (!appId || !process.env.DISCORD_BOT_TOKEN) return;
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
    await rest.put(Routes.applicationGuildCommands(appId, guildId), {
      body: SLASH_COMMANDS_JSON,
    });
    console.log(`[${BOT_NAME}] Comandos / sincronizados no servidor: ${guildName}`);
  } catch (err) {
    console.error(`Aviso ao sincronizar comandos em ${guildName}:`, err);
  }
}

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  if (message.content.startsWith(PREFIX)) {
    const [rawFirst] = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const firstCmd = rawFirst?.toLowerCase();
    if (firstCmd === 'aviso-elo' || firstCmd === 'painel-elo') {
      if (!isAdminOrMod(message.member)) {
        if (isEloPanelChannel(message.channel)) {
          await message.delete().catch(() => null);
        }
        return;
      }
      if (isEloPanelChannel(message.channel)) {
        await message.delete().catch(() => null);
      }
      const ok = await ensurePrivateEloNotice(message.guild, true);
      if (!isEloPanelChannel(message.channel)) {
        await message.reply(
          ok
            ? `Aviso privado de elo enviado no canal **${ELO_PANEL_CHANNEL_NAME}**!`
            : `Não encontrei o canal de texto **${ELO_PANEL_CHANNEL_NAME}** neste servidor.`
        );
      }
      return;
    }

    if (firstCmd === 'painel-tickets' || firstCmd === 'aviso-tickets') {
      if (!isAdminOrMod(message.member)) {
        if (isTicketPanelChannel(message.channel)) {
          await message.delete().catch(() => null);
        }
        return;
      }
      const dedicated = findTicketPanelChannel(message.guild);
      const targetCh = dedicated || message.channel;
      if (targetCh.id === message.channel.id) {
        await message.delete().catch(() => null);
      }
      const postedIn = await ensureTicketPanelNotice(message.guild, true, targetCh);
      if (postedIn && postedIn.id !== message.channel.id) {
        await message.reply(`Painel de tickets privados publicado em <#${postedIn.id}>!`);
      }
      return;
    }
  }

  // Proteção automática no canal de elo: apaga mensagens públicas para manter tudo entre o membro e os Admins
  if (isEloPanelChannel(message.channel)) {
    await message.delete().catch(() => null);
    const tempNotice = await message.channel
      .send(
        `<@${message.author.id}>, apaguei sua mensagem para manter seu elo **privado**! Clique nos botões do aviso acima para enviar somente entre você e os Admins.`
      )
      .catch(() => null);
    if (tempNotice) {
      setTimeout(() => tempNotice.delete().catch(() => null), 8000);
    }
    return;
  }

  // Proteção automática no canal de painel de Tickets: evita que alguém exponha uma denúncia em público
  if (isTicketPanelChannel(message.channel)) {
    await message.delete().catch(() => null);
    const tempNotice = await message.channel
      .send(
        `<@${message.author.id}>, use os botões do painel acima (ou \`/ticket\`) para abrir seu atendimento **privado** com os Admins!`
      )
      .catch(() => null);
    if (tempNotice) {
      setTimeout(() => tempNotice.delete().catch(() => null), 8000);
    }
    return;
  }

  if (!message.content.startsWith(PREFIX)) return;

  const [cmdRaw, ...args] = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = cmdRaw.toLowerCase();
  const query = args.join(' ');

  if (cmd === 'play' || cmd === 'p' || cmd === 'tocar') {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) return message.reply('Entre em uma call de voz no Discord para pedir música!');
    if (!query) return message.reply(`Uso: \`${PREFIX}play nome da música ou link\``);

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

    try {
      await enqueueAndPlay({
        voiceChannel,
        textChannel: message.channel,
        query,
        requestedByTag: message.author.toString(),
      });
    } catch (err) {
      console.error(`[${BOT_NAME}] Falha no !play:`, err);
      return message.reply(`Não consegui reproduzir **${query}** (\`${err.message}\`).`);
    }
  }

  if (cmd === 'playlist' || cmd === 'pl') {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) return message.reply('Entre em uma call de voz primeiro!');
    const foundKey = Object.keys(CUSTOM_PLAYLISTS).find((k) =>
      k.toLowerCase().includes(query.toLowerCase())
    );
    if (!foundKey) {
      return message.reply(`Playlists disponíveis: ${Object.keys(CUSTOM_PLAYLISTS).join(' · ')}`);
    }
    try {
      for (const trackQuery of CUSTOM_PLAYLISTS[foundKey]) {
        await enqueueAndPlay({
          voiceChannel,
          textChannel: message.channel,
          query: trackQuery,
          requestedByTag: message.author.toString(),
          silentQueueNotice: true,
        });
      }
      return message.reply(`Playlist **${foundKey}** adicionada na call **${voiceChannel.name}**!`);
    } catch (err) {
      console.error(`[${BOT_NAME}] Falha na playlist:`, err);
      return message.reply('Erro ao carregar uma das faixas da playlist na call.');
    }
  }

  if (cmd === 'skip' || cmd === 's' || cmd === 'pular') {
    const q = guildQueues.get(message.guild.id);
    if (!q || !q.songs.length) return message.reply('Nenhuma música tocando na call agora.');
    const skipped = q.songs[0];
    q.player.stop();
    return message.reply(`Faixa **${skipped.title}** pulada!`);
  }

  if (cmd === 'pause' || cmd === 'pausar') {
    const q = guildQueues.get(message.guild.id);
    if (!q) return message.reply('Nenhuma música ativa na call.');
    q.player.pause();
    return message.reply('Áudio pausado na call.');
  }

  if (cmd === 'resume' || cmd === 'continuar') {
    const q = guildQueues.get(message.guild.id);
    if (!q) return message.reply('Nenhuma música pausada na call.');
    q.player.unpause();
    return message.reply('Áudio retomado na call!');
  }

  if (cmd === 'stop' || cmd === 'parar' || cmd === 'clear') {
    if (!guildQueues.has(message.guild.id)) return message.reply('O bot não está tocando nada agora.');
    destroyGuildQueue(message.guild.id);
    return message.reply('Reprodução encerrada e fila limpa!');
  }

  if (cmd === 'volume' || cmd === 'vol') {
    const q = guildQueues.get(message.guild.id);
    if (!q) return message.reply('Nenhuma música tocando no momento.');
    const vol = Number(query);
    if (!Number.isFinite(vol) || vol < 0 || vol > 150) {
      return message.reply(`Uso: \`${PREFIX}volume 0-150\` (atual: ${q.volume}%)`);
    }
    q.volume = Math.round(vol);
    q.currentResource?.volume?.setVolumeLogarithmic(q.volume / 100);
    return message.reply(`Volume da call ajustado para **${q.volume}%**!`);
  }

  if (cmd === 'queue' || cmd === 'fila' || cmd === 'q') {
    const q = guildQueues.get(message.guild.id);
    if (!q || !q.songs.length) return message.reply('A fila da call está vazia.');
    const lines = q.songs
      .slice(0, 10)
      .map((s, idx) =>
        idx === 0
          ? `>**Tocando agora:** ${s.title} (\`${s.durationFormatted}\`)`
          : `\`${idx}.\` ${s.title} (\`${s.durationFormatted}\`)`
      );
    return message.reply(lines.join('\n'));
  }

  if (cmd === 'modskip' || cmd === 'forceskip' || cmd === 'vetar') {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return message.reply('Apenas moderadores podem usar o Mod Skip.');
    }
    const q = guildQueues.get(message.guild.id);
    if (!q || !q.songs[0]) return message.reply('Nenhuma faixa ativa na call.');
    const removed = q.songs[0];
    const nextTitle = q.songs[1]?.title || 'Fila encerrada';
    const reason = query || 'Faixa inadequada para a call';
    q.player.stop();

    await sendAuditLog(message.guild, {
      category: 'MOD_SKIP',
      action: 'Mod Skip — Remoção Rápida',
      actorTag: message.author.tag,
      target: `${removed.title} (pedido por ${removed.requestedByTag})`,
      reason,
      before: removed.title,
      after: nextTitle,
    });
    return message.channel.send(`Faixa **${removed.title}** removida pela moderação (${reason}).`);
  }

  if (cmd === 'vincular') {
    const [riotName, riotTag] = query.split('#');
    if (!riotName || !riotTag) {
      return message.reply(`Use: ${PREFIX}vincular Nome#TAG (ex: ${PREFIX}vincular Jogador#BR1)`);
    }
    const rankData = await fetchValorantRank('br', riotName, riotTag);
    if (!rankData) {
      return message.reply({
        content: 'Conta privada ou API indisponível no momento. Selecione seu cargo manualmente abaixo:',
        components: [buildManualRoleRow()],
      });
    }

    await applyValorantRole(
      message.member,
      rankData.ptRoleName,
      'Vínculo Automático Riot',
      client.user.tag,
      rankData.fullRankLabel
    );
    linkedAccounts.set(`${message.guild.id}:${message.author.id}`, {
      userId: message.author.id,
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
  if (interaction.isButton()) {
    if (interaction.customId === 'open_private_riot_modal') {
      const modal = new ModalBuilder()
        .setCustomId('submit_private_riot_modal')
        .setTitle('Verificação Privada de Elo');

      const riotInput = new TextInputBuilder()
        .setCustomId('riot_id_input')
        .setLabel('Sua Conta Riot (Nome#TAG)')
        .setPlaceholder('Ex: Jogador#BR1')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(40);

      const noteInput = new TextInputBuilder()
        .setCustomId('elo_note_input')
        .setLabel('Observação para os Admins (opcional)')
        .setPlaceholder('Ex: Elo atual caso o perfil seja privado')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(200);

      modal.addComponents(
        new ActionRowBuilder().addComponents(riotInput),
        new ActionRowBuilder().addComponents(noteInput)
      );
      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId === 'open_private_manual_elo') {
      await interaction.reply({
        content:
          '🔒 **Modo Privado:** selecione seu elo abaixo. Somente você e os Admins terão acesso ao registro:',
        components: [buildManualRoleRow('private_manual_valorant_role')],
        ephemeral: true,
      });
      return;
    }

    if (interaction.customId === 'open_private_admin_thread') {
      await interaction.deferReply({ ephemeral: true });
      const thread = await openOrGetPrivateAdminEloThread(interaction.guild, interaction.member);
      if (!thread) {
        return interaction.editReply(
          'Não consegui abrir a sala privada automaticamente (verifique se o bot tem permissão de *Criar Tópicos Privados* no canal). Use o botão **Vincular Riot ID (Privado)** ou **Escolher Elo (Privado)** que também são 100% visíveis só para você e os Admins!'
        );
      }
      await thread
        .send(
          `🔒 Olá <@${interaction.user.id}>! Esta sala privada foi aberta para você enviar seu elo ou print diretamente para os **Admins** do servidor.`
        )
        .catch(() => null);
      return interaction.editReply(
        `🔒 Sua sala privada com os Admins está pronta: <#${thread.id}> (ninguém mais do servidor vê este canal).`
      );
    }

    if (interaction.customId.startsWith('close_elo_thread:')) {
      if (!isAdminOrMod(interaction.member)) {
        return interaction.reply({
          content: 'Apenas Administradores ou Moderadores podem arquivar esta sala.',
          ephemeral: true,
        });
      }
      await interaction.reply('🔒 Sala privada arquivada pela administração.');
      if (interaction.channel?.isThread?.()) {
        await interaction.channel.setLocked(true).catch(() => null);
        await interaction.channel.setArchived(true).catch(() => null);
      }
      return;
    }

    if (interaction.customId.startsWith('open_ticket_modal:')) {
      const tipo = interaction.customId.split(':')[1];
      await interaction.showModal(buildTicketModal(tipo));
      return;
    }

    if (interaction.customId.startsWith('ticket_claim:')) {
      if (!isAdminOrMod(interaction.member)) {
        return interaction.reply({
          content: 'Apenas Administradores ou Moderadores podem assumir tickets.',
          ephemeral: true,
        });
      }
      const [, authorId, tipo] = interaction.customId.split(':');
      const meta = TICKET_CATEGORIES[tipo] || TICKET_CATEGORIES.duvida;
      await sendAuditLog(interaction.guild, {
        category: 'TICKETS',
        action: `Ticket Assumido (${meta.label})`,
        actorTag: interaction.user.tag,
        target: `<@${authorId}> em #${interaction.channel?.name || 'ticket'}`,
        reason: 'Admin iniciou o atendimento confidencial',
      });
      return interaction.reply(
        `✅ Atendimento assumido pelo Admin <@${interaction.user.id}>! Pode enviar mais detalhes ou anexos abaixo.`
      );
    }

    if (interaction.customId.startsWith('ticket_close:')) {
      const [, authorId, tipo] = interaction.customId.split(':');
      if (!isAdminOrMod(interaction.member) && interaction.user.id !== authorId) {
        return interaction.reply({
          content: 'Apenas os Admins ou o próprio autor podem encerrar este ticket.',
          ephemeral: true,
        });
      }
      const meta = TICKET_CATEGORIES[tipo] || TICKET_CATEGORIES.duvida;
      const recentMsgs = await interaction.channel?.messages?.fetch({ limit: 20 }).catch(() => null);
      const msgCount = recentMsgs ? recentMsgs.size : 1;

      await sendAuditLog(interaction.guild, {
        category: tipo === 'denuncia' ? 'MOD_SKIP' : 'TICKETS',
        action: `Ticket Encerrado (${meta.label})`,
        actorTag: interaction.user.tag,
        target: `Autor <@${authorId}> · #${interaction.channel?.name || 'ticket'}`,
        reason: 'Atendimento finalizado e arquivado pela administração',
        after: `${msgCount} mensagens registradas no atendimento`,
      });

      await interaction.reply(
        `🔒 Ticket encerrado por <@${interaction.user.id}>! O registro foi salvo na auditoria dos Admins e este canal confidencial será fechado em 5 segundos.`
      );

      setTimeout(async () => {
        try {
          if (interaction.channel?.isThread?.()) {
            await interaction.channel.setLocked(true).catch(() => null);
            await interaction.channel.setArchived(true).catch(() => null);
          } else if (interaction.channel?.topic?.startsWith('ticket-owner:')) {
            await interaction.channel.delete('Ticket privado encerrado');
          }
        } catch {}
      }, 5000);
      return;
    }
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('submit_ticket_modal:')) {
    await interaction.deferReply({ ephemeral: true });
    const tipo = interaction.customId.split(':')[1];
    const meta = TICKET_CATEGORIES[tipo] || TICKET_CATEGORIES.duvida;

    const subject = interaction.fields.getTextInputValue('ticket_subject').trim();
    const details = interaction.fields.getTextInputValue('ticket_details').trim();
    const accused =
      tipo === 'denuncia'
        ? interaction.fields.getTextInputValue('ticket_accused')?.trim() || ''
        : '';
    const proof =
      tipo === 'denuncia'
        ? interaction.fields.getTextInputValue('ticket_proof')?.trim() || ''
        : '';

    const room = await openPrivateTicketRoom(
      interaction.guild,
      interaction.member,
      interaction.channel,
      tipo
    );

    if (!room) {
      return interaction.editReply(
        'Não consegui criar o canal privado do ticket. Peça a um Admin para verificar se o bot possui a permissão **Gerenciar Canais** ou **Criar Tópicos Privados**!'
      );
    }

    const ticketEmbed = new EmbedBuilder()
      .setColor(meta.color)
      .setTitle(`🔒 ${meta.label}`)
      .setDescription(
        `Olá <@${interaction.user.id}>! Este canal é **100% confidencial** — somente você e os **Admins/Moderadores** do servidor conseguem ver ou responder aqui.`
      )
      .addFields(
        {
          name: 'Autor do Ticket',
          value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`,
          inline: true,
        },
        { name: 'Categoria', value: meta.label, inline: true },
        ...(accused ? [{ name: '🚨 Membro Denunciado', value: accused, inline: false }] : []),
        { name: 'Assunto', value: subject, inline: false },
        { name: 'Descrição Detalhada', value: details, inline: false },
        ...(proof ? [{ name: 'Provas / Links Informados', value: proof, inline: false }] : [])
      )
      .setFooter({
        text: 'Você pode enviar prints, vídeos ou mais informações diretamente neste chat privado.',
      })
      .setTimestamp();

    const controlsRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket_claim:${interaction.user.id}:${tipo}`)
        .setLabel('Assumir Ticket (Admin)')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`ticket_close:${interaction.user.id}:${tipo}`)
        .setLabel('Resolver & Fechar Ticket')
        .setStyle(ButtonStyle.Secondary)
    );

    await room.send({
      content: `🔒 Atendimento privado de <@${interaction.user.id}> aberto para a administração:`,
      embeds: [ticketEmbed],
      components: [controlsRow],
    });

    await sendAuditLog(interaction.guild, {
      category: tipo === 'denuncia' ? 'MOD_SKIP' : 'TICKETS',
      action: `Novo Ticket Privado — ${meta.label}`,
      actorTag: interaction.user.tag,
      target: accused ? `Denunciado: ${accused}` : subject,
      reason: subject,
      after: `Sala confidencial #${room.name}`,
    });

    return interaction.editReply(
      `🔒 Seu ticket privado (**${meta.label}**) foi aberto em <#${room.id}>! Somente você e os Admins do servidor têm acesso.`
    );
  }

  if (interaction.isModalSubmit() && interaction.customId === 'submit_private_riot_modal') {
    await interaction.deferReply({ ephemeral: true });
    const rawRiotId = interaction.fields.getTextInputValue('riot_id_input').trim();
    const note = interaction.fields.getTextInputValue('elo_note_input')?.trim() || '';
    const [riotName, riotTag] = rawRiotId.split('#').map((s) => s.trim());

    if (!riotName || !riotTag) {
      return interaction.editReply(
        'Formato inválido! Clique novamente no botão e informe no formato `Nome#TAG` (ex: `Jogador#BR1`).'
      );
    }

    const rankData = await fetchValorantRank('br', riotName, riotTag);
    if (!rankData) {
      const thread = await notifyAdminsPrivately(interaction.guild, interaction.member, {
        modeLabel: 'Envio Privado (Conta Riot Privada / Manual)',
        riotId: `${riotName}#${riotTag}`,
        rankLabel: 'Pendente de Seleção Manual / Admin',
        note,
        applied: false,
      });
      return interaction.editReply({
        content:
          `🔒 Sua conta **${riotName}#${riotTag}** foi enviada de forma privada somente para os Admins${
            thread ? ` em <#${thread.id}>` : ''
          }.\nComo o perfil não retornou MMR público agora, selecione seu elo manualmente abaixo:`,
        components: [buildManualRoleRow('private_manual_valorant_role')],
      });
    }

    await applyValorantRole(
      interaction.member,
      rankData.ptRoleName,
      `Envio Privado (${ELO_PANEL_CHANNEL_NAME})`,
      client.user.tag,
      rankData.fullRankLabel
    );
    linkedAccounts.set(`${interaction.guild.id}:${interaction.user.id}`, {
      userId: interaction.user.id,
      guildId: interaction.guild.id,
      riotName,
      riotTag,
      region: 'br',
      lastTierOrder: rankData.tierOrder,
      lastRankName: rankData.fullRankLabel,
      isPrivateElo: true,
    });

    const thread = await notifyAdminsPrivately(interaction.guild, interaction.member, {
      modeLabel: 'Vínculo Riot Privado',
      riotId: `${riotName}#${riotTag}`,
      rankLabel: `${rankData.fullRankLabel} (${rankData.rr} RR)`,
      note,
      applied: true,
    });

    return interaction.editReply(
      `🔒 Pronto! Sua conta **${riotName}#${riotTag}** ficou salva **somente entre você e os Admins**${
        thread ? ` (<#${thread.id}>)` : ''
      } e seu cargo foi atualizado para **${rankData.fullRankLabel}** (${rankData.rr} RR).`
    );
  }

  if (interaction.isStringSelectMenu()) {
    if (
      interaction.customId === 'manual_valorant_role' ||
      interaction.customId === 'private_manual_valorant_role'
    ) {
      const isPrivate = interaction.customId === 'private_manual_valorant_role';
      await interaction.deferReply({ ephemeral: true });
      const chosenRole = interaction.values[0];
      await applyValorantRole(
        interaction.member,
        chosenRole,
        isPrivate ? `Seleção Manual Privada (${ELO_PANEL_CHANNEL_NAME})` : 'Seleção Manual pelo Membro',
        interaction.user.tag
      );

      let thread = null;
      if (isPrivate) {
        thread = await notifyAdminsPrivately(interaction.guild, interaction.member, {
          modeLabel: 'Seleção Manual Privada',
          riotId: null,
          rankLabel: chosenRole,
          note: '',
          applied: true,
        });
      }

      await interaction.editReply(
        `🔒 Cargo **${chosenRole}** atribuído em modo privado! Somente você e os Admins têm acesso a este registro${
          thread ? ` (<#${thread.id}>)` : ''
        }.`
      );
      return;
    }

    if (interaction.customId.startsWith('admin_set_elo:')) {
      if (!isAdminOrMod(interaction.member)) {
        return interaction.reply({
          content: 'Apenas Administradores ou Moderadores podem alterar o cargo por aqui.',
          ephemeral: true,
        });
      }
      await interaction.deferReply({ ephemeral: true });
      const targetUserId = interaction.customId.split(':')[1];
      const chosenRole = interaction.values[0];
      const targetMember = await interaction.guild.members.fetch(targetUserId).catch(() => null);
      if (!targetMember) {
        return interaction.editReply('Membro não encontrado no servidor.');
      }

      await applyValorantRole(
        targetMember,
        chosenRole,
        `Ajuste Privado por Admin (${interaction.user.tag})`,
        interaction.user.tag
      );
      await interaction.channel
        ?.send(
          `✅ Cargo de <@${targetMember.id}> atualizado para **${chosenRole}** pelo Admin <@${interaction.user.id}>.`
        )
        .catch(() => null);
      return interaction.editReply(`Cargo **${chosenRole}** aplicado para ${targetMember.user.tag}!`);
    }
  }

  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'aviso-elo') {
    await interaction.deferReply({ ephemeral: true });
    const ok = await ensurePrivateEloNotice(interaction.guild, true);
    return interaction.editReply(
      ok
        ? `Aviso oficial de verificação privada publicado com sucesso em **${ELO_PANEL_CHANNEL_NAME}**!`
        : `Não encontrei o canal **${ELO_PANEL_CHANNEL_NAME}** neste servidor. Verifique o nome exato do canal de texto.`
    );
  }

  if (interaction.commandName === 'painel-tickets') {
    await interaction.deferReply({ ephemeral: true });
    const targetCh = findTicketPanelChannel(interaction.guild) || interaction.channel;
    const posted = await ensureTicketPanelNotice(interaction.guild, true, targetCh);
    return interaction.editReply(
      posted
        ? `Painel oficial de tickets privados publicado com sucesso em <#${posted.id}>!`
        : 'Não foi possível publicar o painel de tickets neste canal.'
    );
  }

  if (interaction.commandName === 'ticket') {
    const tipo = interaction.options.getString('tipo', true);
    await interaction.showModal(buildTicketModal(tipo));
    return;
  }

  if (interaction.commandName === 'criar-cargos-valorant') {
    await interaction.deferReply({ ephemeral: true });
    const created = await ensureValorantRoles(interaction.guild, interaction.user.tag);
    await interaction.editReply(
      created.length
        ? `Cargos criados com sucesso: ${created.join(', ')}`
        : 'Todos os 9 cargos do VALORANT já estão criados neste servidor!'
    );
  }

  if (interaction.commandName === 'cargo-manual') {
    await interaction.reply({
      content: '🔒 Selecione abaixo o seu elo atual do VALORANT (visível apenas para você e Admins):',
      components: [buildManualRoleRow('private_manual_valorant_role')],
      ephemeral: true,
    });
  }

  if (interaction.commandName === 'vincular') {
    await interaction.deferReply({ ephemeral: true });
    const rawRiotId = interaction.options.getString('riotid', true);
    const [riotName, riotTag] = rawRiotId.split('#');
    if (!riotName || !riotTag) {
      return interaction.editReply('Formato inválido! Use `Nome#TAG` (ex: `Jogador#BR1`).');
    }
    const rankData = await fetchValorantRank('br', riotName, riotTag);
    if (!rankData) {
      return interaction.editReply({
        content: 'Não foi possível ler seu MMR automaticamente. Escolha o cargo de forma privada abaixo:',
        components: [buildManualRoleRow('private_manual_valorant_role')],
      });
    }
    await applyValorantRole(
      interaction.member,
      rankData.ptRoleName,
      'Vínculo Privado Riot (/vincular)',
      client.user.tag,
      rankData.fullRankLabel
    );
    linkedAccounts.set(`${interaction.guild.id}:${interaction.user.id}`, {
      userId: interaction.user.id,
      guildId: interaction.guild.id,
      riotName,
      riotTag,
      region: 'br',
      lastTierOrder: rankData.tierOrder,
      lastRankName: rankData.fullRankLabel,
      isPrivateElo: true,
    });
    await notifyAdminsPrivately(interaction.guild, interaction.member, {
      modeLabel: 'Comando /vincular Privado',
      riotId: `${riotName}#${riotTag}`,
      rankLabel: `${rankData.fullRankLabel} (${rankData.rr} RR)`,
      note: '',
      applied: true,
    });
    await interaction.editReply(
      `🔒 Conta **${riotName}#${riotTag}** vinculada em modo privado (visível só para você e Admins)! Novo cargo: **${rankData.fullRankLabel}** (${rankData.rr} RR).`
    );
  }

  if (interaction.commandName === 'play') {
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({ content: 'Entre em uma call de voz no Discord primeiro!', ephemeral: true });
    }
    const search = interaction.options.getString('busca', true);
    if (BLOCKED_TERMS.some((term) => search.toLowerCase().includes(term.toLowerCase()))) {
      return interaction.reply({
        content: 'Essa música contém palavras bloqueadas nas regras da call.',
        ephemeral: true,
      });
    }
    await interaction.deferReply();
    try {
      const song = await enqueueAndPlay({
        voiceChannel,
        textChannel: interaction.channel,
        query: search,
        requestedByTag: interaction.user.toString(),
      });
      await interaction.editReply(
        `Carregada para a call **${voiceChannel.name}**: **${song.title}** (\`${song.durationFormatted}\`)`
      );
    } catch (err) {
      console.error(`[${BOT_NAME}] Falha no /play:`, err);
      await interaction.editReply(`Não consegui tocar **${search}** (\`${err.message}\`).`);
    }
  }

  if (interaction.commandName === 'skip') {
    const q = guildQueues.get(interaction.guildId);
    if (!q || !q.songs.length) {
      return interaction.reply({ content: 'Nenhuma música tocando agora.', ephemeral: true });
    }
    const skipped = q.songs[0];
    q.player.stop();
    await interaction.reply(`Faixa **${skipped.title}** pulada!`);
  }

  if (interaction.commandName === 'stop') {
    if (!guildQueues.has(interaction.guildId)) {
      return interaction.reply({ content: 'Nenhuma música ativa na call.', ephemeral: true });
    }
    destroyGuildQueue(interaction.guildId);
    await interaction.reply('Reprodução encerrada e desconectado da call!');
  }

  if (interaction.commandName === 'volume') {
    const q = guildQueues.get(interaction.guildId);
    if (!q) {
      return interaction.reply({ content: 'Nenhuma música ativa na call agora.', ephemeral: true });
    }
    const vol = interaction.options.getInteger('nivel', true);
    q.volume = vol;
    q.currentResource?.volume?.setVolumeLogarithmic(q.volume / 100);
    await interaction.reply(`Volume da call ajustado para **${q.volume}%**!`);
  }

  if (interaction.commandName === 'modskip') {
    const q = guildQueues.get(interaction.guildId);
    if (!q || !q.songs[0]) {
      return interaction.reply({ content: 'Nenhuma faixa tocando no momento.', ephemeral: true });
    }
    const removed = q.songs[0];
    const nextTitle = q.songs[1]?.title || 'Fila encerrada';
    const reason = interaction.options.getString('motivo', true);
    q.player.stop();

    await sendAuditLog(interaction.guild, {
      category: 'MOD_SKIP',
      action: 'Mod Skip (/modskip)',
      actorTag: interaction.user.tag,
      target: `${removed.title}`,
      reason,
      before: removed.title,
      after: nextTitle,
    });
    await interaction.reply(`Faixa **${removed.title}** removida pela moderação (${reason}).`);
  }
});

setInterval(async () => {
  for (const account of linkedAccounts.values()) {
    const rankData = await fetchValorantRank(account.region, account.riotName, account.riotTag);
    if (!rankData || rankData.tierOrder <= account.lastTierOrder) continue;

    const guild = client.guilds.cache.get(account.guildId);
    if (!guild) continue;
    const member = await guild.members.fetch(account.userId).catch(() => null);
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
      const publicMsg = account.isPrivateElo
        ? `Parabéns <@${account.userId}>! Subiu de **${oldRank}** para **${rankData.fullRankLabel}** (${rankData.rr} RR)!`
        : `Parabéns <@${account.userId}> (**${account.riotName}#${account.riotTag}**)! Subiu de **${oldRank}** para **${rankData.fullRankLabel}** (${rankData.rr} RR)!`;
      await rankUpChannel.send(publicMsg);
    }
  }
}, 15 * 60 * 1000);

// Sincroniza Slash Commands, aviso privado no canal de Elo e Painel de Tickets em TODOS os servidores
client.once('ready', async () => {
  console.log(`[${BOT_NAME}] Conectado no Discord como ${client.user.tag} em ${client.guilds.cache.size} servidor(es)`);
  console.log(generateDependencyReport());
  for (const guild of client.guilds.cache.values()) {
    await syncSlashCommandsForGuild(guild.id, guild.name);
    await ensurePrivateEloNotice(guild, false);
    await ensureTicketPanelNotice(guild, false);
  }
});

client.on('guildCreate', async (guild) => {
  console.log(`[${BOT_NAME}] Entrou em um novo servidor: ${guild.name} (${guild.id})`);
  await syncSlashCommandsForGuild(guild.id, guild.name);
  await ensurePrivateEloNotice(guild, false);
  await ensureTicketPanelNotice(guild, false);
});

client.on('channelCreate', async (channel) => {
  if (!channel.guild) return;
  if (isEloPanelChannel(channel)) {
    await ensurePrivateEloNotice(channel.guild, false);
  }
  if (isTicketPanelChannel(channel)) {
    await ensureTicketPanelNotice(channel.guild, false, channel);
  }
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
  if (!newChannel.guild) return;
  if (!isEloPanelChannel(oldChannel) && isEloPanelChannel(newChannel)) {
    await ensurePrivateEloNotice(newChannel.guild, false);
  }
  if (!isTicketPanelChannel(oldChannel) && isTicketPanelChannel(newChannel)) {
    await ensureTicketPanelNotice(newChannel.guild, false, newChannel);
  }
});

if (!process.env.DISCORD_BOT_TOKEN) {
  console.error(`[${BOT_NAME}] ERRO: Variável DISCORD_BOT_TOKEN não configurada no Environment do Render!`);
} else {
  client.login(process.env.DISCORD_BOT_TOKEN);
}
