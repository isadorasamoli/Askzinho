import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

const commands = [
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
  { body: commands }
);

console.log('Slash commands registrados com sucesso!');
