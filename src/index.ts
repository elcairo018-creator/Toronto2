import {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  REST,
  Routes,
  type ChatInputCommandInteraction,
  type SlashCommandOptionsOnlyBuilder,
  Events,
} from "discord.js";
import { logger } from "./logger.js";

import {
  apricontoData, apricontoHandler,
  mostracontoData, mostracontoHandler,
} from "./commands/banca.js";

import {
  stipendioData, stipendioHandler,
  pannellolavoriData, pannellolavoriHandler,
  crealavoriData, crealavoriHandler,
  eliminalavoroData, eliminalavoroHandler,
  pannellolicenziamentoData, pannellolicenziamentoHandler,
  dimissioniData, dimissioniHandler,
} from "./commands/lavoro.js";

import {
  pannelloautoData, pannelloautoHandler,
  creaautoData, creaautoHandler,
  eliminaautoData, eliminaautoHandler,
} from "./commands/auto.js";

import {
  pannellocaseData, pannellocaseHandler,
  creacasaData, creacasaHandler,
  eliminacasaData, eliminacasaHandler,
} from "./commands/case.js";

import {
  pannellonegozioData, pannellonegozioHandler,
  pannellocreaprodottoData, pannellocreaprodottoHandler,
  creaprodottoData, creaprodottoHandler,
  eliminaprodottoData, eliminaprodottoHandler,
  pannellopagamentiData, pannellopagamentiHandler,
  negozioData, negozioHandler,
  chiudinegozioData, chiudinegozioHandler,
  negozioAutocomplete,
} from "./commands/negozio.js";

import { handleButton, handleModal, handleSelectMenu } from "./interactions.js";

type CommandHandler = (interaction: ChatInputCommandInteraction) => Promise<unknown>;

const commands = new Collection<string, CommandHandler>();
const commandBuilders: SlashCommandOptionsOnlyBuilder[] = [];

function reg(data: SlashCommandOptionsOnlyBuilder, handler: CommandHandler) {
  commands.set(data.name, handler);
  commandBuilders.push(data);
}

reg(apricontoData, apricontoHandler);
reg(mostracontoData, mostracontoHandler);
reg(stipendioData, stipendioHandler);
reg(dimissioniData, dimissioniHandler);
reg(pannellolavoriData, pannellolavoriHandler);
reg(crealavoriData, crealavoriHandler);
reg(eliminalavoroData, eliminalavoroHandler);
reg(pannellolicenziamentoData, pannellolicenziamentoHandler);
reg(pannelloautoData, pannelloautoHandler);
reg(creaautoData, creaautoHandler);
reg(eliminaautoData, eliminaautoHandler);
reg(pannellocaseData, pannellocaseHandler);
reg(creacasaData, creacasaHandler);
reg(eliminacasaData, eliminacasaHandler);
reg(pannellonegozioData, pannellonegozioHandler);
reg(pannellocreaprodottoData, pannellocreaprodottoHandler);
reg(creaprodottoData, creaprodottoHandler);
reg(eliminaprodottoData, eliminaprodottoHandler);
reg(pannellopagamentiData, pannellopagamentiHandler);
reg(negozioData, negozioHandler);
reg(chiudinegozioData, chiudinegozioHandler);

async function deployCommands(token: string, clientId: string, guildId: string) {
  const rest = new REST({ version: "10" }).setToken(token);
  try {
    logger.info({ count: commandBuilders.length }, "Deploying slash commands...");
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commandBuilders.map((c) => c.toJSON()),
    });
    logger.info("Slash commands deployed successfully.");
  } catch (err) {
    logger.error({ err }, "Failed to deploy slash commands");
  }
}

export async function startBot() {
  const token = process.env["DISCORD_TOKEN"];
  const clientId = process.env["DISCORD_CLIENT_ID"];
  const guildId = process.env["DISCORD_GUILD_ID"];

  if (!token || !clientId || !guildId) {
    logger.error("Missing DISCORD_TOKEN, DISCORD_CLIENT_ID or DISCORD_GUILD_ID — bot not started.");
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  client.once(Events.ClientReady, async (c) => {
    logger.info({ tag: c.user.tag }, "Discord bot online");
    await deployCommands(token, clientId, guildId);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      // Slash commands
      if (interaction.isChatInputCommand()) {
        const handler = commands.get(interaction.commandName);
        if (handler) await handler(interaction);
        return;
      }

      // Autocomplete
      if (interaction.isAutocomplete()) {
        const cmdName = interaction.commandName;
        if (cmdName === "creaprodotto" || cmdName === "eliminaprodotto" || cmdName === "chiudinegozio") {
          await negozioAutocomplete(interaction);
        }
        return;
      }

      // Bottoni
      if (interaction.isButton()) {
        await handleButton(interaction);
        return;
      }

      // Select menu (tendine)
      if (interaction.isStringSelectMenu()) {
        await handleSelectMenu(interaction);
        return;
      }

      // Modal
      if (interaction.isModalSubmit()) {
        await handleModal(interaction);
        return;
      }
    } catch (err) {
      logger.error({ err, interactionId: interaction.id }, "Error handling interaction");
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "❌ Si è verificato un errore. Riprova più tardi.",
          ephemeral: true,
        }).catch(() => null);
      }
    }
  });

  client.on(Events.Error, (err) => {
    logger.error({ err }, "Discord client error");
  });

  await client.login(token);
}
