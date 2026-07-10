import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import db, { type Car } from "../db.js";
import { canManageCars, sendPanel } from "../utils.js";

export const pannelloautoData = new SlashCommandBuilder()
  .setName("pannelloauto")
  .setDescription("Mostra le auto in vendita");

export async function pannelloautoHandler(interaction: ChatInputCommandInteraction) {
  const cars = db.prepare("SELECT * FROM cars ORDER BY price ASC").all() as Car[];

  const embed = new EmbedBuilder()
    .setTitle("🚗 Concessionaria")
    .setColor(0xFEE75C)
    .setDescription(cars.length === 0 ? "Nessuna auto disponibile al momento." : "Scegli un'auto da acquistare!")
    .setTimestamp();

  if (cars.length === 0) {
    return sendPanel(interaction, { embeds: [embed] });
  }

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const chunks: Car[][] = [];
  for (let i = 0; i < cars.length; i += 5) chunks.push(cars.slice(i, i + 5));

  for (const chunk of chunks.slice(0, 5)) {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      chunk.map((car) =>
        new ButtonBuilder()
          .setCustomId(`auto_buy:${car.id}`)
          .setLabel(`${car.name} — €${car.price}`)
          .setStyle(ButtonStyle.Secondary)
      )
    );
    rows.push(row);
  }

  cars.forEach((c) =>
    embed.addFields({ name: `🚗 ${c.name}`, value: `Prezzo: **€${c.price}**`, inline: true })
  );

  await sendPanel(interaction, { embeds: [embed], components: rows });
}

export const creaautoData = new SlashCommandBuilder()
  .setName("creaauto")
  .setDescription("Aggiungi un'auto in vendita (solo proprietario)")
  .addStringOption((o) => o.setName("nome").setDescription("Nome dell'auto").setRequired(true))
  .addIntegerOption((o) => o.setName("prezzo").setDescription("Prezzo").setRequired(true).setMinValue(0));

export async function creaautoHandler(interaction: ChatInputCommandInteraction) {
  if (!canManageCars(interaction)) {
    return interaction.reply({ content: "❌ Devi avere il ruolo **Staff** o **Concessionario** per aggiungere auto.", ephemeral: true });
  }
  const nome = interaction.options.getString("nome", true);
  const prezzo = interaction.options.getInteger("prezzo", true);
  db.prepare("INSERT INTO cars (name, price) VALUES (?, ?)").run(nome, prezzo);

  const embed = new EmbedBuilder()
    .setTitle("✅ Auto Aggiunta")
    .setColor(0x57F287)
    .addFields(
      { name: "Nome", value: nome, inline: true },
      { name: "Prezzo", value: `€${prezzo}`, inline: true },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

export const eliminaautoData = new SlashCommandBuilder()
  .setName("eliminaauto")
  .setDescription("Rimuovi un'auto in vendita (solo proprietario)")
  .addStringOption((o) => o.setName("nome").setDescription("Nome dell'auto da rimuovere").setRequired(true));

export async function eliminaautoHandler(interaction: ChatInputCommandInteraction) {
  if (!canManageCars(interaction)) {
    return interaction.reply({ content: "❌ Devi avere il ruolo **Staff** o **Concessionario** per rimuovere auto.", ephemeral: true });
  }
  const nome = interaction.options.getString("nome", true);
  const result = db.prepare("DELETE FROM cars WHERE name = ? COLLATE NOCASE").run(nome);

  if (result.changes === 0) {
    return interaction.reply({ content: `❌ Auto "${nome}" non trovata.`, ephemeral: true });
  }
  await interaction.reply({ content: `✅ Auto **${nome}** rimossa.`, ephemeral: true });
}
