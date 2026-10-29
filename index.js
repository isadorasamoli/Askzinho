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
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
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
const RANKUP_CHANNEL_NAME = "upou-de-elo";
const MODLOG_CHANNEL_NAME = "auditoria-mod";
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

async function createCloudSafeAudioResource(song, volumePercent = 80) {
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
  resource.volume?.setVolume(Math.max(0, Math.min(2, volumePercent / 100)));

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
      volume: 80,
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

function buildManualRoleRow() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('manual_valorant_role')
    .setPlaceholder('Escolha seu elo do VALORANT manualmente')
    .addOptions(VALORANT_ROLES.map((r) => ({ label: r.name, value: r.name })));
  return new ActionRowBuilder().addComponents(select);
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
    q.currentResource?.volume?.setVolume(q.volume / 100);
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
  if (interaction.isStringSelectMenu() && interaction.customId === 'manual_valorant_role') {
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
    return;
  }

  if (!interaction.isChatInputCommand()) return;

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
      content: 'Selecione abaixo o seu elo atual do VALORANT:',
      components: [buildManualRoleRow()],
      ephemeral: true,
    });
  }

  if (interaction.commandName === 'vincular') {
    await interaction.deferReply();
    const rawRiotId = interaction.options.getString('riotid', true);
    const [riotName, riotTag] = rawRiotId.split('#');
    if (!riotName || !riotTag) {
      return interaction.editReply('Formato inválido! Use `Nome#TAG` (ex: `Jogador#BR1`).');
    }
    const rankData = await fetchValorantRank('br', riotName, riotTag);
    if (!rankData) {
      return interaction.editReply({
        content: 'Não foi possível ler seu MMR automaticamente. Escolha o cargo manualmente abaixo:',
        components: [buildManualRoleRow()],
      });
    }
    await applyValorantRole(
      interaction.member,
      rankData.ptRoleName,
      'Vínculo Automático Riot (/vincular)',
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
    });
    await interaction.editReply(
      `Conta **${riotName}#${riotTag}** vinculada! Novo cargo: **${rankData.fullRankLabel}** (${rankData.rr} RR).`
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
      await rankUpChannel.send(
        `Parabéns <@${account.userId}> (**${account.riotName}#${account.riotTag}**)! Subiu de **${oldRank}** para **${rankData.fullRankLabel}** (${rankData.rr} RR)!`
      );
    }
  }
}, 15 * 60 * 1000);

// Sincroniza Slash Commands em TODOS os servidores atuais e em qualquer servidor novo onde o bot entrar
client.once('ready', async () => {
  console.log(`[${BOT_NAME}] Conectado no Discord como ${client.user.tag} em ${client.guilds.cache.size} servidor(es)`);
  console.log(generateDependencyReport());
  for (const guild of client.guilds.cache.values()) {
    await syncSlashCommandsForGuild(guild.id, guild.name);
  }
});

client.on('guildCreate', async (guild) => {
  console.log(`[${BOT_NAME}] Entrou em um novo servidor: ${guild.name} (${guild.id})`);
  await syncSlashCommandsForGuild(guild.id, guild.name);
});

if (!process.env.DISCORD_BOT_TOKEN) {
  console.error(`[${BOT_NAME}] ERRO: Variável DISCORD_BOT_TOKEN não configurada no Environment do Render!`);
} else {
  client.login(process.env.DISCORD_BOT_TOKEN);
}
