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

if (!token || !clientId) {
  throw new Error('DISCORD_TOKEN and DISCORD_CLIENT_ID are required');
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
      .setRequired(true))
    .addStringOption(option => option
      .setName('webhook')
      .setDescription('Discord webhook URL')
      .setRequired(false)),

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
    .setName('webhook')
    .setDescription('Change a domain webhook')
    .addStringOption(option => option
      .setName('domain')
      .setDescription('Example: pump.fun')
      .setRequired(true))
    .addStringOption(option => option
      .setName('url')
      .setDescription('Discord webhook URL')
      .setRequired(true)),

  new SlashCommandBuilder()
    .setName('testwebhook')
    .setDescription('Test a domain webhook')
    .addStringOption(option => option
      .setName('domain')
      .setDescription('Monitored domain')
      .setRequired(true))
].map(command => command.toJSON());

function validWebhook(url) {
  return /^https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/\S+$/i.test(url);
}

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

async function postWebhook(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Discord webhook returned HTTP ${response.status}`);
  }
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

async function notify({ domain, hostnames }) {
  const monitored = getDomain(domain);
  if (!monitored?.webhook) return;

  await postWebhook(monitored.webhook, {
    username: 'Subdomain Tracker',
    embeds: [alertEmbed(domain, hostnames).toJSON()]
  });
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
      const webhook = interaction.options.getString('webhook');

      if (!validDomain(domain)) {
        return interaction.reply({
          content: 'Use a domain such as `pump.fun`.',
          ephemeral: true
        });
      }

      if (webhook && !validWebhook(webhook)) {
        return interaction.reply({
          content: 'That webhook URL is invalid.',
          ephemeral: true
        });
      }

      addDomain(domain, webhook || null);
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

    if (interaction.commandName === 'webhook') {
      const domain = normalizeDomain(interaction.options.getString('domain'));
      const url = interaction.options.getString('url');

      if (!getDomain(domain)) {
        return interaction.reply({
          content: 'Use `/add` for this domain first.',
          ephemeral: true
        });
      }

      if (!validWebhook(url)) {
        return interaction.reply({
          content: 'That webhook URL is invalid.',
          ephemeral: true
        });
      }

      addDomain(domain, url);
      return interaction.reply(`Webhook updated for **${domain}**.`);
    }

    if (interaction.commandName === 'testwebhook') {
      const domain = normalizeDomain(interaction.options.getString('domain'));
      const monitored = getDomain(domain);

      if (!monitored?.webhook) {
        return interaction.reply({
          content: 'No webhook configured for that domain.',
          ephemeral: true
        });
      }

      await postWebhook(monitored.webhook, {
        username: 'Subdomain Tracker',
        embeds: [alertEmbed(domain, [`test.${domain}`]).toJSON()]
      });

      return interaction.reply({
        content: `Test sent for **${domain}**.`,
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
