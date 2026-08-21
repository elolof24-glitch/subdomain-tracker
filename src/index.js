import 'dotenv/config';
import {
  AttachmentBuilder,
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
const guildId = String(process.env.DISCORD_GUILD_ID || '').trim();
const rawChannelId = String(process.env.DISCORD_ALERT_CHANNEL_ID || '').trim();
const alertChannelId = rawChannelId.includes('/') ? rawChannelId.split('/').pop() : rawChannelId;
const alertRoleId = String(process.env.DISCORD_ALERT_ROLE_ID || '').trim();

if (!token || !clientId) throw new Error('DISCORD_TOKEN and DISCORD_CLIENT_ID are required');
if (!guildId) throw new Error('DISCORD_GUILD_ID is required');
if (!alertChannelId) throw new Error('DISCORD_ALERT_CHANNEL_ID is required');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder().setName('add').setDescription('Monitor a domain for new subdomains').addStringOption(option => option.setName('domain').setDescription('Example: pump.fun').setRequired(true)),
  new SlashCommandBuilder().setName('remove').setDescription('Stop monitoring a domain').addStringOption(option => option.setName('domain').setDescription('Example: pump.fun').setRequired(true)),
  new SlashCommandBuilder().setName('list').setDescription('List monitored domains'),
  new SlashCommandBuilder().setName('scan').setDescription('Scan now').addStringOption(option => option.setName('domain').setDescription('Optional domain; blank scans all').setRequired(false)),
  new SlashCommandBuilder().setName('testalert').setDescription('Test the alert channel and role mention'),
  new SlashCommandBuilder().setName('debugchannels').setDescription('List channels visible to the bot'),
  new SlashCommandBuilder().setName('find').setDescription('Open compact DotDB searches by keyword').addStringOption(option => option.setName('keyword').setDescription('Example: uniswap').setRequired(true))
].map(command => command.toJSON());

function validDomain(domain) {
  return typeof domain === 'string' && domain.includes('.') && !domain.includes(' ');
}

function hostnameFile(domain, hostnames) {
  const header = [
    `Subdomain scan for ${domain}`,
    `Generated: ${new Date().toISOString()}`,
    `Total hostnames: ${hostnames.length}`,
    '',
    'Hostnames:',
    ''
  ].join('\n');

  return Buffer.from(`${header}${hostnames.join('\n')}\n`, 'utf8');
}

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
}

function splitHostnames(hostnames, maxLength = 1000) {
  const chunks = [];
  let current = '';

  for (const hostname of hostnames) {
    const line = `\`${hostname}\`\n`;
    if (current.length + line.length > maxLength && current) {
      chunks.push(current.trimEnd());
      current = '';
    }
    current += line;
  }

  if (current) chunks.push(current.trimEnd());
  return chunks;
}

function alertEmbeds(domain, hostnames) {
  return splitHostnames(hostnames).map((chunk, index) => new EmbedBuilder()
    .setColor(0x20e0a0)
    .setTitle(index === 0 ? '🔔 New subdomains found' : '🔔 New subdomains found — continued')
    .setDescription(index === 0 ? `Monitoring scan detected new hostnames for **${domain}**.` : `Additional hostnames detected for **${domain}**.`)
    .addFields({ name: 'Hostnames', value: chunk })
    .setFooter({ text: 'cnig69' })
    .setTimestamp());
}

function roleMention() {
  return alertRoleId ? `<@&${alertRoleId}>` : '';
}

async function getAlertChannel() {
  const guild = await client.guilds.fetch(guildId);
  const channels = await guild.channels.fetch();
  const channel = [...channels.values()].find(item => item && String(item.id) === String(alertChannelId));

  if (!channel) throw new Error(`Alert channel ${alertChannelId} was not found in guild ${guildId}`);
  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
    throw new Error('Alert channel must be a normal text or announcement channel');
  }

  const permissions = channel.permissionsFor(client.user);
  if (!permissions?.has(PermissionFlagsBits.ViewChannel)) throw new Error('Bot lacks View Channel permission in the alert channel');
  if (!permissions.has(PermissionFlagsBits.SendMessages)) throw new Error('Bot lacks Send Messages permission in the alert channel');
  if (!permissions.has(PermissionFlagsBits.EmbedLinks)) throw new Error('Bot lacks Embed Links permission in the alert channel');

  return channel;
}

async function sendAlert({ domain, hostnames }) {
  const channel = await getAlertChannel();
  const embeds = alertEmbeds(domain, hostnames);

  for (let index = 0; index < embeds.length; index += 10) {
    await channel.send({
      content: index === 0 ? roleMention() : '',
      embeds: embeds.slice(index, index + 10),
      allowedMentions: {
        roles: index === 0 && alertRoleId ? [alertRoleId] : []
      }
    });
  }
}

async function notify({ domain, hostnames }) {
  await sendAlert({ domain, hostnames });
}

let scanRunning = false;

async function scanAllDomains() {
  if (scanRunning) {
    console.warn('Skipping scan because the previous scan is still running.');
    return;
  }

  scanRunning = true;

  try {
    for (const monitored of listDomains()) {
      try {
        const result = await scanDomain(monitored.domain, notify, { notifyOnFresh: true });
        console.log(`${result.domain}: ${result.fresh.length} new hostname(s)`);
      } catch (error) {
        console.error(`Scan failed for ${monitored.domain}:`, error.message);
      }
    }
  } finally {
    scanRunning = false;
  }
}

client.once('ready', async () => {
  await registerCommands();
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Guild: ${guildId}`);
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
      await interaction.deferReply({ ephemeral: true });
      const domain = normalizeDomain(interaction.options.getString('domain'));
      if (!validDomain(domain)) return interaction.editReply('Use a domain such as `pump.fun`.');
      addDomain(domain);
      return interaction.editReply(`Monitoring **${domain}**. Run \`/scan domain:${domain}\` for the baseline.`);
    }

    if (interaction.commandName === 'remove') {
      await interaction.deferReply({ ephemeral: true });
      const domain = normalizeDomain(interaction.options.getString('domain'));
      const result = removeDomain(domain);
      return interaction.editReply(result.changes ? `Stopped monitoring **${domain}**.` : `**${domain}** was not monitored.`);
    }

    if (interaction.commandName === 'list') {
      const domains = listDomains();
      return interaction.reply({
        content: domains.length
          ? domains.map(item => {
              const lastScan = item.last_scan
                ? `<t:${Math.floor(new Date(item.last_scan).getTime() / 1000)}:f>`
                : 'never';
              return `• **${item.domain}** — last scan: ${lastScan}`;
            }).join('\n')
          : 'No domains are monitored.',
        ephemeral: true
      });
    }

    if (interaction.commandName === 'debugchannels') {
      await interaction.deferReply({ ephemeral: true });
      const guild = await client.guilds.fetch(guildId);
      const channels = await guild.channels.fetch();
      const output = [...channels.values()].filter(Boolean).map(channel => `${channel.name || 'unnamed'} — ${channel.id} — type ${channel.type}`).join('\n');
      return interaction.editReply(output || 'No channels are visible to the bot.');
    }

    if (interaction.commandName === 'testalert') {
      await interaction.deferReply({ ephemeral: true });
      await sendAlert({ domain: 'example.com', hostnames: ['test.example.com'] });
      return interaction.editReply('Test alert sent.');
    }

    if (interaction.commandName === 'find') {
      const keyword = interaction.options
        .getString('keyword')
        .trim()
        .toLowerCase();

      if (!/^[a-z0-9-]{1,63}$/.test(keyword)) {
        return interaction.reply({
          content: 'Use a keyword containing only letters, numbers, or hyphens.',
          ephemeral: true
        });
      }

      const makeSearchUrl = position => {
        const url = new URL('https://dotdb.com/search');
        url.searchParams.set('keyword', keyword);
        url.searchParams.set('position', position);
        return url.toString();
      };

      const links = [
        `[Beginning](<${makeSearchUrl('beginning')}>)`,
        `[Ending](<${makeSearchUrl('end')}>)`,
        `[Anywhere](<${makeSearchUrl('any')}>)`
      ].join('  •  ');

      return interaction.reply({
        content: `**DotDB · ${keyword}**\n${links}`,
        ephemeral: true
      });
    }

    if (interaction.commandName === 'scan') {
      await interaction.deferReply({ ephemeral: true });
      const requested = interaction.options.getString('domain');

      if (requested) {
        const domain = normalizeDomain(requested);
        if (!getDomain(domain)) return interaction.editReply('That domain is not monitored.');

        const result = await scanDomain(domain, null, { notifyOnFresh: false });
        const file = new AttachmentBuilder(
          hostnameFile(domain, result.hostnames),
          { name: `${domain}-subdomains.txt` }
        );

        return interaction.editReply({
          content: [
            `Scan complete for **${domain}**.`,
            `Found ${result.total} subdomain(s).`,
            result.fresh.length > 0
              ? `${result.fresh.length} hostname(s) were new to the tracker.`
              : 'No new hostnames since the previous scan.',
            'The complete hostname list is attached below.'
          ].join('\n'),
          files: [file]
        });
      }

      const results = [];
      const files = [];

      for (const monitored of listDomains()) {
        try {
          const result = await scanDomain(monitored.domain, null, { notifyOnFresh: false });
          results.push(`• **${result.domain}** — ${result.total} observed, ${result.fresh.length} new to the tracker`);
          files.push(new AttachmentBuilder(hostnameFile(result.domain, result.hostnames), { name: `${result.domain}-subdomains.txt` }));
        } catch (error) {
          results.push(`• **${monitored.domain}** — error: ${error.message}`);
        }
      }

      return interaction.editReply({
        content: results.length ? `Manual scan complete.\n${results.join('\n')}` : 'No domains are monitored.',
        files
      });
    }
  } catch (error) {
    console.error(error);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(`Error: ${error.message}`);
    } else {
      await interaction.reply({ content: `Error: ${error.message}`, ephemeral: true });
    }
  }
});

await client.login(token);
