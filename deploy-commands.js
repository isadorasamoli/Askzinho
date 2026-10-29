import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

const commands = [
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
    .setDescription('Publica o painel fixo de tickets privados no canal configurado')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('vincular')
    .setDescription('Vincula sua conta Riot em modo privado (visível só para você e Admins)')
    .addStringOption((opt) => opt.setName('riotid').setDescription('Formato Nome#TAG').setRequired(true)),
  new SlashCommandBuilder()
    .setName('cargo-manual')
    .setDescription('Abre o seletor privado de cargo de elo do VALORANT'),
].map((c) => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

// Registra globalmente para funcionar em qualquer servidor onde o bot estiver
await rest.put(
  Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
  { body: commands }
);

console.log('Slash commands globais registrados com sucesso para todos os servidores!');
