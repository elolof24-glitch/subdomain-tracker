import 'dotenv/config';
import {
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  PermissionFlagsBits,
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

if (!guildId) {
  throw new Error('DISCORD_GUILD_ID is required');
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
    .setDescription('Test the alert channel and role mention')
].map(command => command.toJSON());

function validDomain(domain) {
  return typeof domain === 'string' && domain.includes('.') && !domain.includes(' ');
}

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(
    Routes.applicationGuildCommands(clientId, guildId),
    { body: commands }
  );
}

function alertEmbed(domain, hostnames) {
  const formattedHostnames = hostnames
    .slice(0, 25)
    .map(hostname => '`' + hostname + '`')
    .join('\n');

  return new EmbedBuilder()
    .setColor(0x20e0a0)
    .setTitle('🚨 New Subdomains Added')
    .setDescription('New subdomains observed for **' + domain + '**.')
    .addFields({
      name: 'Hostnames',
      value: formattedHostnames || 'No hostname details available.'
    })
    .setFooter({ text: 'Subdomain Tracker • Certificate Transparency' })
    .setTimestamp();
}

function roleMention() {
  return alertRoleId ? '<@&' + alertRoleId + '>' : '';
}

async function getAlertChannel() {
  const guild = await client.guilds.fetch(guildId);
  const channel = await guild.channels.fetch(alertChannelId);

  if (!channel) {
    throw new Error(
      'Alert channel ' + alertChannelId + ' was not found in server ' + guildId
    );
  }

  if (
    channel.type !== ChannelType.GuildText &&
    channel.type !== ChannelType.GuildAnnouncement
  ) {
    throw new Error(
      'Alert channel must be a normal text or announcement channel'
    );
  }

  const permissions = channel.permissionsFor(client.user);

  if (!permissions?.has(PermissionFlagsBits.ViewChannel)) {
    throw new Error('Bot lacks View Channel permission in the alert channel');
  }

  if (!permissions.has(PermissionFlagsBits.SendMessages)) {
    throw new Error('Bot lacks Send Messages permission in the alert channel');
  }

  if (!permissions.has(PermissionFlagsBits.EmbedLinks)) {
    throw new Error('Bot lacks Embed Links permission in the alert channel');
  }

  return channel;
}

async function sendAlert({ domain, hostnames }) {
  const channel = await getAlertChannel();

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
      console.log(
        result.domain + ': ' + result.fresh.length + ' new hostname(s)'
      );
    } catch (error) {
      console.error(
        'Scan failed for ' + monitored.domain + ':',
        error.message
      );
    }
  }
}

client.once('ready', async () => {
  await registerCommands();
  console.log('Logged in as ' + client.user.tag);
  console.log('Guild: ' + guildId);
  console.log('Alerts channel: ' + alertChannelId);
  console.log('Alerts role: ' + (alertRoleId || 'none'));

  await scanAllDomains();

  const seconds = Math.max(10, Number(process.env.POLL_SECONDS || 60));
  console.log('Polling every ' + seconds + ' seconds.');
  setInterval(scanAllDomains, seconds * 1000);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'add') {
      await interaction.deferReply({ ephemeral: true });

      const domain = normalizeDomain(
        interaction.options.getString('domain')
      );

      if (!validDomain(domain)) {
        return interaction.editReply('Use a domain such as `pump.fun`.');
      }

      addDomain(domain);
      return interaction.editReply(
        'Monitoring **' + domain + '**. Run `/scan domain:' + domain + '` for the baseline.'
      );
    }

    if (interaction.commandName === 'remove') {
      await interaction.deferReply({ ephemeral: true });

      const domain = normalizeDomain(
        interaction.options.getString('domain')
      );
      const result = removeDomain(domain);

      return interaction.editReply(
        result.changes
          ? 'Stopped monitoring **' + domain + '**.'
          : '**' + domain + '** was not monitored.'
      );
    }

    if (interaction.commandName === 'list') {
      const domains = listDomains();

      return interaction.reply({
        content: domains.length
          ? domains.map(item =>
              '• **' + item.domain + '** — last scan: ' +
              (item.last_scan || 'never')
            ).join('\n')
          : 'No domains are monitored.',
        ephemeral: true
      });
    }

    if (interaction.commandName === 'testalert') {
      await interaction.deferReply({ ephemeral: true });

      await sendAlert({
        domain: 'example.com',
        hostnames: ['test.example.com']
      });

      return interaction.editReply('Test alert sent.');
    }

    if (interaction.commandName === 'scan') {
      await interaction.deferReply({ ephemeral: true });

      const requested = interaction.options.getString('domain');

      if (requested) {
        const domain = normalizeDomain(requested);

        if (!getDomain(domain)) {
          return interaction.editReply('That domain is not monitored.');
        }

        const result = await scanDomain(domain, notify);
        return interaction.editReply(
          'Scanned **' + domain + '**: ' + result.total +
          ' observed, ' + result.fresh.length + ' new.'
        );
      }

      await scanAllDomains();
      return interaction.editReply('Scanned all monitored domains.');
    }
  } catch (error) {
    console.error(error);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply('Error: ' + error.message);
    } else {
      await interaction.reply({
        content: 'Error: ' + error.message,
        ephemeral: true
      });
    }
  }
});

await client.login(token);
