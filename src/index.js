import 'dotenv/config';
import {
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} from 'discord.js';
import {
  addDomain,
  getDomain,
  listDomains,
  removeDomain
} from './store.js';
import { normalizeDomain, scanDomain } from './monitor.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const alertChannelId = process.env.DISCORD_ALERT_CHANNEL_ID;
const alertRoleId = process.env.DISCORD_ALERT_ROLE_ID;

if (!token || !clientId) {
  throw new Error('DISCORD_TOKEN and DISCORD_CLIENT_ID are required');
}

if (!alertChannelId) {
  throw new Error('DISCORD_ALERT_CHANNEL_ID is required');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const commands = [
  new SlashCommandBuilder()
    .setName('add')
    .setDescription('Monitor a domain for new subdomains')
    .addStringOption(option => option
      .setName('domain')
      .setDescription('Example: pump.fun')
      .setRequired(true)),

  new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Stop monitoring a domain')
    .addStringOption(option => option
      .setName('domain')
      .setDescription('Example: pump.fun')
      .setRequired(true)),

  new SlashCommandBuilder()
    .setName('list')
    .setDescription('List monitored domains'),

  new SlashCommandBuilder()
    .setName('scan')
    .setDescription('Scan now')
    .addStringOption(option => option
      .setName('domain')
      .setDescription('Optional domain; blank scans all')
      .setRequired(false)),

  new SlashCommandBuilder()
    .setName('testalert')
    .setDescription('Test the alert channel and role mention'),

  new SlashCommandBuilder()
    .setName('testwebhook')
    .setDescription('Legacy webhook test; direct alerts are now used')
].map(command => command.toJSON());

function validDomain(domain) {
  return domain.includes('.') && !domain.includes(' ');
}

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(token);
  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);

  await rest.put(route, { body: commands });
}

function alertEmbed(domain, hostnames) {
  const formattedHostnames = hostnames
    .slice(0, 25)
    .map(hostname => `\`${hostname}\``)
    .join('\n');

  return new EmbedBuilder()
    .setColor(0x20e0a0)
    .setTitle('🚨 New Subdomains Added')
    .setDescription(`New subdomains observed for **${domain}**.`)
    .addFields({
      name: 'Hostnames',
      value: formattedHostnames || 'No hostname details available.'
    })
    .setFooter({ text: 'Subdomain Tracker • Certificate Transparency' })
    .setTimestamp();
}

function roleMention() {
  return alertRoleId ? `<@&${alertRoleId}>` : '';
}

async function sendAlert({ domain, hostnames }) {
  const channel = await client.channels.fetch(alertChannelId);

  if (!channel || !channel.isTextBased()) {
    throw new Error('Alert channel was not found or is not text-based');
  }

  await channel.send({
    content: roleMention(),
    embeds: [alertEmbed(domain, hostnames)],
    allowedMentions: {
      roles: alertRoleId ? [alertRoleId] : []
    }
  });
}

async function notify({ domain, hostnames }) {
  await sendAlert({ domain, hostnames });
}

async function scanAllDomains() {
  for (const monitored of listDomains()) {
    try {
      const result = await scanDomain(monitored.domain, notify);
      console.log(`${result.domain}: ${result.fresh.length} new hostname(s)`);
    } catch (error) {
      console.error(`Scan failed for ${monitored.domain}:`, error.message);
    }
  }
}

client.once('ready', async () => {
  await registerCommands();
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Alerts channel: ${alertChannelId}`);
  console.log(`Alerts role: ${alertRoleId || 'none'}`);

  await scanAllDomains();

  const seconds = Math.max(10, Number(process.env.POLL_SECONDS || 60));
  console.log(`Polling every ${seconds} seconds.`);
  setInterval(scanAllDomains, seconds * 1000);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'add') {
      const domain = normalizeDomain(interaction.options.getString('domain'));

      if (!validDomain(domain)) {
        return interaction.reply({
          content: 'Use a domain such as `pump.fun`.',
          ephemeral: true
        });
      }

      addDomain(domain);
      return interaction.reply(
        `Monitoring **${domain}**. Run \`/scan domain:${domain}\` for the baseline.`
      );
    }

    if (interaction.commandName === 'remove') {
      const domain = normalizeDomain(interaction.options.getString('domain'));
      const result = removeDomain(domain);

      return interaction.reply(
        result.changes
          ? `Stopped monitoring **${domain}**.`
          : `**${domain}** was not monitored.`
      );
    }

    if (interaction.commandName === 'list') {
      const domains = listDomains();

      return interaction.reply(
        domains.length
          ? domains.map(item =>
              `• **${item.domain}** — last scan: ${item.last_scan || 'never'}`
            ).join('\n')
          : 'No domains are monitored.'
      );
    }

    if (interaction.commandName === 'testalert') {
      await sendAlert({
        domain: 'example.com',
        hostnames: ['test.example.com']
      });

      return interaction.reply({
        content: 'Test alert sent.',
        ephemeral: true
      });
    }

    if (interaction.commandName === 'testwebhook') {
      return interaction.reply({
        content: 'Direct bot alerts are enabled. Use `/testalert` instead.',
        ephemeral: true
      });
    }

    if (interaction.commandName === 'scan') {
      const requested = interaction.options.getString('domain');
      await interaction.deferReply({ ephemeral: true });

      if (requested) {
        const domain = normalizeDomain(requested);

        if (!getDomain(domain)) {
          return interaction.editReply('That domain is not monitored.');
        }

        const result = await scanDomain(domain, notify);
        return interaction.editReply(
          `Scanned **${domain}**: ${result.total} observed, ${result.fresh.length} new.`
        );
      }

      await scanAllDomains();
      return interaction.editReply('Scanned all monitored domains.');
    }
  } catch (error) {
    console.error(error);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(`Error: ${error.message}`);
    } else {
      await interaction.reply({
        content: `Error: ${error.message}`,
        ephemeral: true
      });
    }
  }
});

await client.login(token);

