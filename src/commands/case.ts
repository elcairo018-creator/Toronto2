import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  AttachmentBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import db, { type House } from "../db.js";
import { canManageHouses, sendPanel, COLORS, FOOTER } from "../utils.js";

export const pannellocaseData = new SlashCommandBuilder()
  .setName("pannellocase")
  .setDescription("Mostra le case in vendita");

export async function pannellocaseHandler(interaction: ChatInputCommandInteraction) {
  const houses = db.prepare("SELECT * FROM houses ORDER BY price ASC").all() as House[];

  if (houses.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle("🏠 Agenzia Immobiliare — Toronto RP")
      .setColor(0xEB459E)
      .setDescription("Nessuna casa disponibile al momento.")
      .setFooter(FOOTER)
      .setTimestamp();
    return sendPanel(interaction, { embeds: [embed] });
  }

  // Una embed per ogni casa (con immagine se presente), bottone acquisto sotto
  const embeds: EmbedBuilder[] = [];
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  for (const h of houses.slice(0, 10)) {
    const embed = new EmbedBuilder()
      .setTitle(`🏠 ${h.name}`)
      .setColor(0xEB459E)
      .addFields({ name: "💰 Prezzo", value: `€${h.price}`, inline: true })
      .setFooter(FOOTER);

    if (h.imageUrl) embed.setImage(h.imageUrl);

    embeds.push(embed);

    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`house_buy:${h.id}`)
          .setLabel(`🛒 Acquista ${h.name}`)
          .setStyle(ButtonStyle.Primary),
      ),
    );
  }

  await sendPanel(interaction, { embeds, components: rows.slice(0, 5) });
}

// ── /creacasa ─────────────────────────────────────────────────────────────────
export const creacasaData = new SlashCommandBuilder()
  .setName("creacasa")
  .setDescription("Aggiungi una casa in vendita (solo proprietario / agenzia)")
  .addStringOption((o) => o.setName("nome").setDescription("Nome della casa").setRequired(true))
  .addIntegerOption((o) => o.setName("prezzo").setDescription("Prezzo in €").setRequired(true).setMinValue(0))
  .addAttachmentOption((o) =>
    o.setName("immagine").setDescription("Foto della casa (jpg/png)").setRequired(false),
  );

export async function creacasaHandler(interaction: ChatInputCommandInteraction) {
  if (!canManageHouses(interaction)) {
    return interaction.reply({ content: "❌ Non hai i permessi per aggiungere case.", ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const nome       = interaction.options.getString("nome", true);
  const prezzo     = interaction.options.getInteger("prezzo", true);
  const attachment = interaction.options.getAttachment("immagine");

  let imageUrl: string | null = null;

  if (attachment) {
    const storageChannelId = process.env.CASE_IMAGES_CHANNEL_ID;

    if (storageChannelId) {
      try {
        // Scarica il file dall'URL temporaneo di Discord
        const res = await fetch(attachment.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        const file   = new AttachmentBuilder(buffer, { name: attachment.name });

        // Ri-carica nel canale di archivio → ottieni URL CDN permanente
        const storageChannel = await interaction.client.channels.fetch(storageChannelId);
        if (storageChannel && "send" in storageChannel) {
          const msg = await (storageChannel as any).send({
            content: `[archivio] ${nome}`,
            files: [file],
          });
          imageUrl = msg.attachments.first()?.url ?? null;
        }
      } catch (err) {
        // Fallback: usa l'URL temporaneo (scadrà, ma meglio di niente)
        imageUrl = attachment.url;
        console.error("[creacasa] Errore archiviazione immagine:", err);
      }
    } else {
      // Nessun canale archivio configurato — usa URL diretto (temporaneo)
      imageUrl = attachment.url;
    }
  }

  db.prepare("INSERT INTO houses (name, price, imageUrl) VALUES (?, ?, ?)").run(nome, prezzo, imageUrl);

  const embed = new EmbedBuilder()
    .setTitle("✅ Casa Aggiunta")
    .setColor(COLORS.success)
    .addFields(
      { name: "Nome",   value: nome,         inline: true },
      { name: "Prezzo", value: `€${prezzo}`, inline: true },
    )
    .setFooter(FOOTER)
    .setTimestamp();

  if (imageUrl) embed.setImage(imageUrl);

  await interaction.editReply({ embeds: [embed] });
}

// ── /eliminacasa ──────────────────────────────────────────────────────────────
export const eliminacasaData = new SlashCommandBuilder()
  .setName("eliminacasa")
  .setDescription("Rimuovi una casa in vendita (solo proprietario / agenzia)")
  .addStringOption((o) => o.setName("nome").setDescription("Nome della casa da rimuovere").setRequired(true));

export async function eliminacasaHandler(interaction: ChatInputCommandInteraction) {
  if (!canManageHouses(interaction)) {
    return interaction.reply({ content: "❌ Non hai i permessi per rimuovere case.", ephemeral: true });
  }
  const nome = interaction.options.getString("nome", true);
  const result = db.prepare("DELETE FROM houses WHERE name = ? COLLATE NOCASE").run(nome);

  if (result.changes === 0) {
    return interaction.reply({ content: `❌ Casa "${nome}" non trovata.`, ephemeral: true });
  }
  await interaction.reply({ content: `✅ Casa **${nome}** rimossa.`, ephemeral: true });
}
