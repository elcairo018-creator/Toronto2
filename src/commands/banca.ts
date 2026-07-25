import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import db, { type Account, type Card } from "../db.js";
import { isAdmin, sendPanel, COLORS, FOOTER } from "../utils.js";

export function randomDigits(n: number) {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
}

// ── /apriconto ────────────────────────────────────────────────────────────────
export const apricontoData = new SlashCommandBuilder()
  .setName("apriconto")
  .setDescription("Pubblica il pannello della banca (solo proprietario)");

export async function apricontoHandler(interaction: ChatInputCommandInteraction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: "❌ Non hai i permessi per pubblicare il pannello banca.", ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setTitle("🏦 ₊˚ ℬᴀɴᴄᴀ 𝒯οяοηтο ₊˚ 💳")
    .setDescription(
      "⏔⏔⏔ ꒰ 🏦 ꒱ ⏔⏔⏔\n\n" +
      "🧸 ु°\n\n" +
      "ᴜsᴀ ɪ ᴘᴜʟsᴀɴᴛɪ ǫᴜɪ sᴏᴛᴛᴏ ᴘᴇʀ ɢᴇsᴛɪʀᴇ ɪʟ ᴛᴜᴏ ᴄᴏɴᴛᴏ ʙᴀɴᴄᴀʀɪᴏ.\n\n" +
      "🏦 **Apri Conto** — ᴄʀᴇᴀ ɪʟ ᴛᴜᴏ ᴄᴏɴᴛᴏ sᴇ ɴᴏɴ ᴄᴇ ʟ'ʜᴀɪ ᴀɴᴄᴏʀᴀ\n" +
      "🔑 **Crea PIN** — ɪᴍᴘᴏsᴛᴀ ᴜɴ ᴘɪɴ ᴀ 4 ᴄɪFʀᴇ\n" +
      "💳 **Crea Carta** — ɢᴇɴᴇʀᴀ ʟᴀ ᴛᴜᴀ ᴄᴀʀᴛᴀ ᴠɪʀᴛᴜᴀʟᴇ\n\n" +
      "🧸 ु°\n\n" +
      "⏔⏔⏔ ꒰ 🏦 ꒱ ⏔⏔⏔\n\n" +
      "🪐 ˚ʚ♡ɞ˚ 🪐"
    )
    .setColor(COLORS.banca)
    .setFooter(FOOTER)
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("banca_apri")
      .setLabel("🏦 Apri Conto")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("banca_pin")
      .setLabel("🔑 Crea PIN")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("banca_carta")
      .setLabel("💳 Crea Carta")
      .setStyle(ButtonStyle.Secondary),
  );

  await sendPanel(interaction, { embeds: [embed], components: [row] });
}

// ── /mostraconto ──────────────────────────────────────────────────────────────
export const mostracontoData = new SlashCommandBuilder()
  .setName("mostraconto")
  .setDescription("Mostra il tuo conto in banca");

export async function mostracontoHandler(interaction: ChatInputCommandInteraction) {
  const account = db.prepare("SELECT * FROM accounts WHERE userId = ?").get(interaction.user.id) as Account | undefined;
  if (!account) {
    return interaction.reply({ content: "❌ Non hai un conto. Usa `/apriconto` prima.", ephemeral: true });
  }
  const cards = db.prepare("SELECT * FROM cards WHERE userId = ?").all(interaction.user.id) as Card[];

  const embed = new EmbedBuilder()
    .setTitle("🏦 ₊˚ ɪʟ ᴛᴜᴏ ᴄᴏɴᴛᴏ ₊˚ 💳")
    .setDescription("⏔⏔⏔ ꒰ 💳 ꒱ ⏔⏔⏔\n\n🤍 ु°")
    .setColor(COLORS.banca)
    .setThumbnail(interaction.user.displayAvatarURL())
    .addFields(
      { name: "ɪɴᴛᴇsᴛᴀᴛᴀʀɪᴏ", value: `<@${interaction.user.id}>`, inline: true },
      { name: "sᴀʟᴅᴏ", value: `**€${account.balance}**`, inline: true },
      {
        name: "ᴄᴀʀᴛᴇ",
        value: cards.length > 0 ? cards.map((c) => `\`${c.cardNumber}\``).join("\n") : "Nessuna carta",
        inline: false,
      },
    )
    .setFooter(FOOTER)
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// ── /pannelloconto ────────────────────────────────────────────────────────────
export const pannellocontoData = new SlashCommandBuilder()
  .setName("pannelloconto")
  .setDescription("Pubblica il pannello conto bancario (solo proprietario)");

export async function pannellocontoHandler(interaction: ChatInputCommandInteraction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: "❌ Non hai i permessi per pubblicare questo pannello.", ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setTitle("🏦 ₊˚ ℬᴀɴᴄᴀ 𝒯οяοηтο ₊˚ 💳")
    .setDescription(
      "⏔⏔⏔ ꒰ 💳 ꒱ ⏔⏔⏔\n\n" +
      "🧸 ु°\n\n" +
      "ᴄʟɪᴄᴄᴀ ɪʟ ᴘᴜʟsᴀɴᴛᴇ ǫᴜɪ sᴏᴛᴛᴏ ᴘᴇʀ ᴠɪsᴜᴀʟɪᴢᴢᴀʀᴇ ɪʟ ᴛᴜᴏ sᴀʟᴅᴏ ɪɴ ʙᴀɴᴄᴀ.\n" +
      "ɪʟ sᴀʟᴅᴏ ᴇ ᴠɪsɪʙɪʟᴇ sᴏʟᴏ ᴀ ᴛᴇ 🤍\n\n" +
      "🧸 ु°\n\n" +
      "⏔⏔⏔ ꒰ 💳 ꒱ ⏔⏔⏔\n\n" +
      "🪐 ˚ʚ♡ɞ˚ 🪐"
    )
    .setColor(COLORS.banca)
    .setFooter(FOOTER)
    .setTimestamp();

  const button = new ButtonBuilder()
    .setCustomId("conto_mostra")
    .setLabel("💰 Visualizza Saldo")
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

  await sendPanel(interaction, { embeds: [embed], components: [row] });
}
