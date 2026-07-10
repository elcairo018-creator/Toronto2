import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from "discord.js";
import db, { type Shop, type Product } from "../db.js";
import { isAdmin, sendPanel } from "../utils.js";

export const pannellonegozioData = new SlashCommandBuilder()
  .setName("pannellonegozio")
  .setDescription("Pubblica il pannello dei negozi");

export async function pannellonegozioHandler(interaction: ChatInputCommandInteraction) {
  const embed = new EmbedBuilder()
    .setTitle("🛍️ Negozi Online")
    .setDescription(
      "**Sfoglia Negozi** — sfoglia i negozi disponibili e acquista i tuoi prodotti preferiti.\n" +
      "**Richiedi Apertura Negozio** — richiedi di aprire il tuo negozio personale."
    )
    .setColor(0xFEE75C)
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("negozio_open")
      .setLabel("Sfoglia Negozi")
      .setEmoji("🛍️")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("negozio_richiedi")
      .setLabel("Richiedi Apertura Negozio")
      .setEmoji("📝")
      .setStyle(ButtonStyle.Success),
  );
  await sendPanel(interaction, { embeds: [embed], components: [row] });
}

export const negozioData = new SlashCommandBuilder()
  .setName("negozio")
  .setDescription("Crea un nuovo negozio (solo proprietario)")
  .addStringOption((o) => o.setName("nome").setDescription("Nome del negozio").setRequired(true));

export async function negozioHandler(interaction: ChatInputCommandInteraction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: "❌ Non hai i permessi per creare negozi.", ephemeral: true });
  }

  const nome = interaction.options.getString("nome", true);

  const existing = db.prepare("SELECT id FROM shops WHERE name = ? COLLATE NOCASE").get(nome);
  if (existing) {
    return interaction.reply({ content: `❌ Il negozio "${nome}" esiste già.`, ephemeral: true });
  }

  const result = db.prepare("INSERT INTO shops (name) VALUES (?)").run(nome);

  const embed = new EmbedBuilder()
    .setTitle("✅ Negozio Creato")
    .setColor(0x57F287)
    .addFields(
      { name: "Nome", value: nome, inline: true },
      { name: "ID", value: String(result.lastInsertRowid), inline: true },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

export const chiudinegozioData = new SlashCommandBuilder()
  .setName("chiudinegozio")
  .setDescription("Chiudi ed elimina un negozio (solo proprietario)")
  .addStringOption((o) =>
    o.setName("nome").setDescription("Nome del negozio").setRequired(true).setAutocomplete(true)
  );

export async function chiudinegozioHandler(interaction: ChatInputCommandInteraction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: "❌ Non hai i permessi per chiudere negozi.", ephemeral: true });
  }
  const nome = interaction.options.getString("nome", true);
  const result = db.prepare("DELETE FROM shops WHERE name = ? COLLATE NOCASE").run(nome);

  if (result.changes === 0) {
    return interaction.reply({ content: `❌ Negozio "${nome}" non trovato.`, ephemeral: true });
  }
  await interaction.reply({ content: `✅ Negozio **${nome}** chiuso ed eliminato.`, ephemeral: true });
}

export const creaprodottoData = new SlashCommandBuilder()
  .setName("creaprodotto")
  .setDescription("Crea un prodotto in un negozio (solo proprietario)")
  .addStringOption((o) =>
    o.setName("negozio").setDescription("Nome del negozio").setRequired(true).setAutocomplete(true)
  )
  .addStringOption((o) => o.setName("nome").setDescription("Nome del prodotto").setRequired(true))
  .addIntegerOption((o) => o.setName("prezzo").setDescription("Prezzo (€)").setRequired(true).setMinValue(0))
  .addStringOption((o) => o.setName("descrizione").setDescription("Descrizione del prodotto").setRequired(false))
  .addAttachmentOption((o) => o.setName("immagine").setDescription("Immagine del prodotto").setRequired(false));

export async function creaprodottoHandler(interaction: ChatInputCommandInteraction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: "❌ Non hai i permessi per creare prodotti.", ephemeral: true });
  }

  const shopName = interaction.options.getString("negozio", true);
  const nome = interaction.options.getString("nome", true);
  const prezzo = interaction.options.getInteger("prezzo", true);
  const descrizione = interaction.options.getString("descrizione") ?? "";
  const immagine = interaction.options.getAttachment("immagine");

  const shop = db.prepare("SELECT * FROM shops WHERE name = ? COLLATE NOCASE").get(shopName) as Shop | undefined;
  if (!shop) {
    return interaction.reply({ content: `❌ Negozio "${shopName}" non trovato. Creane uno con \`/negozio\`.`, ephemeral: true });
  }

  if (immagine && immagine.contentType && !immagine.contentType.startsWith("image/")) {
    return interaction.reply({ content: "❌ Il file allegato non è un'immagine valida. Usa PNG, JPG o GIF.", ephemeral: true });
  }

  const imageUrl = immagine?.url ?? null;

  const result = db.prepare(
    "INSERT INTO products (shopId, name, price, description, imageUrl) VALUES (?, ?, ?, ?, ?)"
  ).run(shop.id, nome, prezzo, descrizione, imageUrl);

  const embed = new EmbedBuilder()
    .setTitle(`🛍️ ${nome}`)
    .setDescription(descrizione || "*Nessuna descrizione*")
    .setColor(0x57F287)
    .addFields(
      { name: "Negozio", value: shop.name, inline: true },
      { name: "Prezzo", value: `€${prezzo}`, inline: true },
      { name: "ID Prodotto", value: String(result.lastInsertRowid), inline: true },
    )
    .setTimestamp();

  if (imageUrl) embed.setImage(imageUrl);

  await interaction.reply({ content: "✅ Prodotto aggiunto!", embeds: [embed] });
}

export const eliminaprodottoData = new SlashCommandBuilder()
  .setName("eliminaprodotto")
  .setDescription("Elimina un prodotto da un negozio (solo proprietario)")
  .addStringOption((o) =>
    o.setName("negozio").setDescription("Nome del negozio").setRequired(true).setAutocomplete(true)
  )
  .addStringOption((o) =>
    o.setName("prodotto").setDescription("Nome del prodotto").setRequired(true).setAutocomplete(true)
  );

export async function eliminaprodottoHandler(interaction: ChatInputCommandInteraction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: "❌ Non hai i permessi per eliminare prodotti.", ephemeral: true });
  }
  const shopName = interaction.options.getString("negozio", true);
  const prodName = interaction.options.getString("prodotto", true);

  const shop = db.prepare("SELECT * FROM shops WHERE name = ? COLLATE NOCASE").get(shopName) as Shop | undefined;
  if (!shop) {
    return interaction.reply({ content: `❌ Negozio "${shopName}" non trovato.`, ephemeral: true });
  }

  const result = db.prepare("DELETE FROM products WHERE shopId = ? AND name = ? COLLATE NOCASE").run(shop.id, prodName);
  if (result.changes === 0) {
    return interaction.reply({ content: `❌ Prodotto "${prodName}" non trovato nel negozio "${shopName}".`, ephemeral: true });
  }

  await interaction.reply({ content: `✅ Prodotto **${prodName}** eliminato da **${shopName}**.`, ephemeral: true });
}

export const pannellopagamentiData = new SlashCommandBuilder()
  .setName("pannellopagamenti")
  .setDescription("Pubblica il pannello per inviare pagamenti");

export async function pannellopagamentiHandler(interaction: ChatInputCommandInteraction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: "❌ Non hai i permessi per pubblicare questo pannello.", ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setTitle("💳 Pagamenti")
    .setDescription("Clicca il pulsante qui sotto per inviare denaro a un altro utente.")
    .setColor(0xFEE75C)
    .setTimestamp();

  const button = new ButtonBuilder()
    .setCustomId("pagamento_open")
    .setLabel("Invia Pagamento")
    .setStyle(ButtonStyle.Success)
    .setEmoji("💸");

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);
  await sendPanel(interaction, { embeds: [embed], components: [row] });
}

export async function negozioAutocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused(true);

  if (focused.name === "negozio") {
    const shops = db.prepare("SELECT name FROM shops WHERE name LIKE ? LIMIT 25").all(`%${focused.value}%`) as { name: string }[];
    await interaction.respond(shops.map((s) => ({ name: s.name, value: s.name })));
    return;
  }

  if (focused.name === "prodotto") {
    const shopName = interaction.options.getString("negozio") ?? "";
    const shop = db.prepare("SELECT * FROM shops WHERE name = ? COLLATE NOCASE").get(shopName) as Shop | undefined;
    if (shop) {
      const products = db.prepare("SELECT name FROM products WHERE shopId = ? AND name LIKE ? LIMIT 25")
        .all(shop.id, `%${focused.value}%`) as { name: string }[];
      await interaction.respond(products.map((p) => ({ name: p.name, value: p.name })));
    } else {
      await interaction.respond([]);
    }
    return;
  }

  await interaction.respond([]);
}
