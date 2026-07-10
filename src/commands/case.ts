import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import db, { type House } from "../db.js";
import { isAdmin, sendPanel } from "../utils.js";

export const pannellocaseData = new SlashCommandBuilder()
  .setName("pannellocase")
  .setDescription("Mostra le case in vendita");

export async function pannellocaseHandler(interaction: ChatInputCommandInteraction) {
  const houses = db.prepare("SELECT * FROM houses ORDER BY price ASC").all() as House[];

  const embed = new EmbedBuilder()
    .setTitle("🏠 Agenzia Immobiliare")
    .setColor(0xEB459E)
    .setDescription(houses.length === 0 ? "Nessuna casa disponibile al momento." : "Scegli una casa da acquistare!")
    .setTimestamp();

  if (houses.length === 0) {
    return sendPanel(interaction, { embeds: [embed] });
  }

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const chunks: House[][] = [];
  for (let i = 0; i < houses.length; i += 5) chunks.push(houses.slice(i, i + 5));

  for (const chunk of chunks.slice(0, 5)) {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      chunk.map((h) =>
        new ButtonBuilder()
          .setCustomId(`house_buy:${h.id}`)
          .setLabel(`${h.name} — €${h.price}`)
          .setStyle(ButtonStyle.Secondary)
      )
    );
    rows.push(row);
  }

  houses.forEach((h) =>
    embed.addFields({ name: `🏠 ${h.name}`, value: `Prezzo: **€${h.price}**`, inline: true })
  );

  await sendPanel(interaction, { embeds: [embed], components: rows });
}

export const creacasaData = new SlashCommandBuilder()
  .setName("creacasa")
  .setDescription("Aggiungi una casa in vendita (solo proprietario)")
  .addStringOption((o) => o.setName("nome").setDescription("Nome della casa").setRequired(true))
  .addIntegerOption((o) => o.setName("prezzo").setDescription("Prezzo").setRequired(true).setMinValue(0));

export async function creacasaHandler(interaction: ChatInputCommandInteraction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: "❌ Non hai i permessi per aggiungere case.", ephemeral: true });
  }
  const nome = interaction.options.getString("nome", true);
  const prezzo = interaction.options.getInteger("prezzo", true);
  db.prepare("INSERT INTO houses (name, price) VALUES (?, ?)").run(nome, prezzo);

  const embed = new EmbedBuilder()
    .setTitle("✅ Casa Aggiunta")
    .setColor(0x57F287)
    .addFields(
      { name: "Nome", value: nome, inline: true },
      { name: "Prezzo", value: `€${prezzo}`, inline: true },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

export const eliminacasaData = new SlashCommandBuilder()
  .setName("eliminacasa")
  .setDescription("Rimuovi una casa in vendita (solo proprietario)")
  .addStringOption((o) => o.setName("nome").setDescription("Nome della casa da rimuovere").setRequired(true));

export async function eliminacasaHandler(interaction: ChatInputCommandInteraction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: "❌ Non hai i permessi per rimuovere case.", ephemeral: true });
  }
  const nome = interaction.options.getString("nome", true);
  const result = db.prepare("DELETE FROM houses WHERE name = ? COLLATE NOCASE").run(nome);

  if (result.changes === 0) {
    return interaction.reply({ content: `❌ Casa "${nome}" non trovata.`, ephemeral: true });
  }
  await interaction.reply({ content: `✅ Casa **${nome}** rimossa.`, ephemeral: true });
}
