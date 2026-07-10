import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import db, { type Account, type Card } from "../db.js";
import { isAdmin, sendPanel } from "../utils.js";

export function randomDigits(n: number) {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
}

export const apricontoData = new SlashCommandBuilder()
  .setName("apriconto")
  .setDescription("Pubblica il pannello della banca (solo proprietario)");

export async function apricontoHandler(interaction: ChatInputCommandInteraction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: "❌ Non hai i permessi per pubblicare il pannello banca.", ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setTitle("🏦 Banca")
    .setDescription(
      "Usa i pulsanti qui sotto per gestire il tuo conto bancario.\n\n" +
      "**Apri Conto** — crea il tuo conto se non ce l'hai ancora\n" +
      "**Crea PIN** — imposta un PIN a 4 cifre\n" +
      "**Crea Carta** — genera la tua carta virtuale"
    )
    .setColor(0x57F287)
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
    .setTitle("🏦 Il Tuo Conto")
    .setColor(0x5865F2)
    .setThumbnail(interaction.user.displayAvatarURL())
    .addFields(
      { name: "Intestatario", value: `<@${interaction.user.id}>`, inline: true },
      { name: "Saldo", value: `€${account.balance}`, inline: true },
      { name: "Carte", value: cards.length > 0 ? cards.map((c) => `\`${c.cardNumber}\``).join("\n") : "Nessuna carta", inline: false },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
