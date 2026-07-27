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

// ── /paga ─────────────────────────────────────────────────────────────────────
export const pagaData = new SlashCommandBuilder()
  .setName("paga")
  .setDescription("Invia denaro a un altro utente taggandolo")
  .addUserOption((o) =>
    o.setName("destinatario").setDescription("Tagga l'utente a cui vuoi inviare denaro").setRequired(true),
  )
  .addIntegerOption((o) =>
    o.setName("importo").setDescription("Importo in € da inviare").setRequired(true).setMinValue(1),
  )
  .addStringOption((o) =>
    o.setName("causale").setDescription("Motivo del pagamento (opzionale)").setRequired(false),
  );

export async function pagaHandler(interaction: ChatInputCommandInteraction) {
  const recipient = interaction.options.getUser("destinatario", true);
  const amount    = interaction.options.getInteger("importo", true);
  const causale   = interaction.options.getString("causale") ?? "Nessuna causale";

  if (recipient.id === interaction.user.id) {
    return interaction.reply({ content: "❌ Non puoi inviare denaro a te stesso.", ephemeral: true });
  }
  if (recipient.bot) {
    return interaction.reply({ content: "❌ Non puoi inviare denaro a un bot.", ephemeral: true });
  }

  const senderAccount = db
    .prepare("SELECT * FROM accounts WHERE userId = ?")
    .get(interaction.user.id) as Account | undefined;
  if (!senderAccount) {
    return interaction.reply({
      content: "❌ Non hai un conto bancario. Aprilo dal pannello 🏦 Banca.",
      ephemeral: true,
    });
  }
  if (senderAccount.balance < amount) {
    return interaction.reply({
      content: `❌ Saldo insufficiente. Hai **€${senderAccount.balance}**.`,
      ephemeral: true,
    });
  }

  const recipientAccount = db
    .prepare("SELECT * FROM accounts WHERE userId = ?")
    .get(recipient.id) as Account | undefined;
  if (!recipientAccount) {
    return interaction.reply({
      content: `❌ <@${recipient.id}> non ha un conto bancario.`,
      ephemeral: true,
    });
  }

  // Esegui il trasferimento
  db.prepare("UPDATE accounts SET balance = balance - ? WHERE userId = ?").run(amount, interaction.user.id);
  db.prepare("UPDATE accounts SET balance = balance + ? WHERE userId = ?").run(amount, recipient.id);
  db.prepare(
    "INSERT INTO transactions (fromId, toId, amount, note) VALUES (?, ?, ?, ?)",
  ).run(interaction.user.id, recipient.id, amount, causale);

  const embedMittente = new EmbedBuilder()
    .setTitle("💸 Pagamento Inviato")
    .setColor(COLORS.success)
    .addFields(
      { name: "Destinatario", value: `<@${recipient.id}>`, inline: true },
      { name: "Importo",      value: `€${amount}`,         inline: true },
      { name: "Causale",      value: causale,               inline: false },
      { name: "Nuovo Saldo",  value: `€${senderAccount.balance - amount}`, inline: true },
    )
    .setFooter(FOOTER)
    .setTimestamp();

  await interaction.reply({ embeds: [embedMittente], ephemeral: true });

  // Notifica DM al destinatario
  try {
    await recipient.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("💰 Pagamento Ricevuto!")
          .setColor(COLORS.success)
          .addFields(
            { name: "Da",      value: `<@${interaction.user.id}> (${interaction.user.username})`, inline: false },
            { name: "Importo", value: `€${amount}`,  inline: true },
            { name: "Causale", value: causale,        inline: true },
          )
          .setFooter(FOOTER)
          .setTimestamp(),
      ],
    });
  } catch { /* DM chiusi — ignora */ }
}

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
