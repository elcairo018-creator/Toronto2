import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from "discord.js";
import db, { type Job, type Employee, saveJobsSeed } from "../db.js";
import {
  isAdmin,
  sendPanel,
  buildListalavoriEmbed,
  COLORS,
  FOOTER,
} from "../utils.js";

// ── /stipendio ────────────────────────────────────────────────────────────────
export const stipendioData = new SlashCommandBuilder()
  .setName("stipendio")
  .setDescription("Ritira il tuo stipendio");

export async function stipendioHandler(interaction: ChatInputCommandInteraction) {
  const account = db.prepare("SELECT * FROM accounts WHERE userId = ?").get(interaction.user.id);
  if (!account) {
    return interaction.reply({
      content: "❌ Non hai un conto bancario. Aprilo dal pannello 🏦 Banca.",
      ephemeral: true,
    });
  }

  const emp = db.prepare(`
    SELECT e.*, j.name as jobName, j.salary
    FROM employees e
    JOIN jobs j ON j.id = e.jobId
    WHERE e.userId = ?
    LIMIT 1
  `).get(interaction.user.id) as (Employee & { jobName: string; salary: number }) | undefined;

  if (!emp) {
    return interaction.reply({
      content: "❌ Non hai un lavoro. Candidati tramite il pannello lavori.",
      ephemeral: true,
    });
  }

  const now = new Date();
  if (emp.lastSalary) {
    const last = new Date(emp.lastSalary);
    const diffH = (now.getTime() - last.getTime()) / (1000 * 60 * 60);
    if (diffH < 24) {
      const remaining = Math.ceil(24 - diffH);
      return interaction.reply({
        content: `❌ Hai già ritirato lo stipendio. Riprova tra **${remaining} ore**.`,
        ephemeral: true,
      });
    }
  }

  db.prepare("UPDATE employees SET lastSalary = ? WHERE userId = ? AND jobId = ?")
    .run(now.toISOString(), interaction.user.id, emp.jobId);
  db.prepare("UPDATE accounts SET balance = balance + ? WHERE userId = ?")
    .run(emp.salary, interaction.user.id);

  const embed = new EmbedBuilder()
    .setTitle("💰 ₊˚ sᴛɪᴘᴇɴᴅɪᴏ ʀɪᴛɪʀᴀᴛᴏ ₊˚ 🎉")
    .setDescription("⏔⏔⏔ ꒰ 💰 ꒱ ⏔⏔⏔\n\n🧸 ु°")
    .setColor(COLORS.success)
    .addFields(
      { name: "ʟᴀᴠᴏʀᴏ",    value: emp.jobName,       inline: true },
      { name: "ɪᴍᴘᴏʀᴛᴏ",   value: `€${emp.salary}`,  inline: true },
    )
    .setFooter(FOOTER)
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// ── /pannellolavori ───────────────────────────────────────────────────────────
export const pannellolavoriData = new SlashCommandBuilder()
  .setName("pannellolavori")
  .setDescription("Pubblica il pannello per candidarsi a un lavoro (solo proprietario)");

export async function pannellolavoriHandler(interaction: ChatInputCommandInteraction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: "❌ Non hai i permessi per pubblicare il pannello.", ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setTitle("💼 ₊˚ 𝒯οяοηтο 𝒥ο𝒷ѕ ₊˚ 📋")
    .setDescription(
      "⏔⏔⏔ ꒰ 📋 ꒱ ⏔⏔⏔\n\n" +
      "🧸 ु°\n\n" +
      "ᴄʟɪᴄᴄᴀ ɪʟ ᴘᴜʟsᴀɴᴛᴇ ᴘᴇʀ ᴠᴇᴅᴇʀᴇ ɪ ʟᴀᴠᴏʀɪ ᴅɪsᴘᴏɴɪʙɪʟɪ ᴇ ᴄᴀɴᴅɪᴅᴀʀᴛɪ.\n\n" +
      "🧸 ु°\n\n" +
      "⏔⏔⏔ ꒰ 📋 ꒱ ⏔⏔⏔\n\n" +
      "🪐 ˚ʚ♡ɞ˚ 🪐"
    )
    .setColor(COLORS.lavori)
    .setFooter(FOOTER)
    .setTimestamp();

  const button = new ButtonBuilder()
    .setCustomId("candidatura_open")
    .setLabel("📋 Candidati ai Lavori")
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

  await sendPanel(interaction, { embeds: [embed], components: [row] });
}

// ── /crealavoro ───────────────────────────────────────────────────────────────
export const crealavoriData = new SlashCommandBuilder()
  .setName("crealavoro")
  .setDescription("Crea un lavoro o aggiorna stipendio/posti (solo proprietario)")
  .addStringOption((o) => o.setName("nome").setDescription("Nome del lavoro").setRequired(true))
  .addRoleOption((o) => o.setName("ruolo").setDescription("Ruolo Discord del lavoro"))
  .addIntegerOption((o) => o.setName("stipendio").setDescription("Stipendio giornaliero (€)").setMinValue(0))
  .addIntegerOption((o) => o.setName("posti").setDescription("Posti massimi (lascia vuoto = illimitati)").setMinValue(1))
  .addChannelOption((o) => o.setName("canale_candidature").setDescription("Canale dove vengono inviate le candidature per questo lavoro"));

export async function crealavoriHandler(interaction: ChatInputCommandInteraction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: "❌ Non hai i permessi per usare questo comando.", ephemeral: true });
  }

  const nome      = interaction.options.getString("nome", true);
  const ruolo     = interaction.options.getRole("ruolo");
  const stipendio = interaction.options.getInteger("stipendio");
  const posti     = interaction.options.getInteger("posti");
  const canale    = interaction.options.getChannel("canale_candidature");

  const existing = db.prepare("SELECT * FROM jobs WHERE name = ? COLLATE NOCASE").get(nome) as Job | undefined;

  if (existing) {
    if (stipendio === null && posti === null && !ruolo && !canale) {
      return interaction.reply({
        content: `ℹ️ Il lavoro **${nome}** esiste già. Specifica almeno uno tra \`stipendio\`, \`posti\`, \`ruolo\` o \`canale_candidature\` per aggiornarlo.`,
        ephemeral: true,
      });
    }

    if (stipendio !== null) db.prepare("UPDATE jobs SET salary = ? WHERE id = ?").run(stipendio, existing.id);
    if (posti !== null)     db.prepare("UPDATE jobs SET maxSlots = ? WHERE id = ?").run(posti, existing.id);
    if (ruolo)              db.prepare("UPDATE jobs SET roleId = ? WHERE id = ?").run(ruolo.id, existing.id);
    if (canale)             db.prepare("UPDATE jobs SET candidatureChannelId = ? WHERE id = ?").run(canale.id, existing.id);

    const updated = db.prepare("SELECT * FROM jobs WHERE id = ?").get(existing.id) as Job;

    const embed = new EmbedBuilder()
      .setTitle("✏️ ₊˚ ʟᴀᴠᴏʀᴏ ᴀɢɢɪᴏʀɴᴀᴛᴏ ₊˚")
      .setDescription("⏔⏔⏔ ꒰ ✏️ ꒱ ⏔⏔⏔\n\n🧸 ु°")
      .setColor(COLORS.warning)
      .addFields(
        { name: "ɴᴏᴍᴇ",               value: updated.name,                                                                    inline: true },
        { name: "ʀᴜᴏʟᴏ",              value: `<@&${updated.roleId}>`,                                                         inline: true },
        { name: "sᴛɪᴘᴇɴᴅɪᴏ",          value: `€${updated.salary}`,                                                            inline: true },
        { name: "ᴘᴏsᴛɪ",              value: updated.maxSlots ? String(updated.maxSlots) : "Illimitati",                      inline: true },
        { name: "ᴄᴀɴᴀʟᴇ ᴄᴀɴᴅɪᴅᴀᴛᴜʀᴇ", value: updated.candidatureChannelId ? `<#${updated.candidatureChannelId}>` : "DM staff", inline: true },
      )
      .setFooter(FOOTER)
      .setTimestamp();

    saveJobsSeed();
    // Aggiorna il pannello listalavori se pubblicato
    await updateListalavoriIfPublished(interaction.client);
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (!ruolo) {
    return interaction.reply({ content: "❌ Per creare un nuovo lavoro devi specificare il `ruolo`.", ephemeral: true });
  }

  db.prepare("INSERT INTO jobs (name, roleId, salary, maxSlots, candidatureChannelId) VALUES (?, ?, ?, ?, ?)").run(
    nome, ruolo.id, stipendio ?? 0, posti ?? null, canale?.id ?? null
  );

  const embed = new EmbedBuilder()
    .setTitle("✅ ₊˚ ʟᴀᴠᴏʀᴏ ᴄʀᴇᴀᴛᴏ ₊˚")
    .setDescription("⏔⏔⏔ ꒰ ✅ ꒱ ⏔⏔⏔\n\n🧸 ु°")
    .setColor(COLORS.success)
    .addFields(
      { name: "ɴᴏᴍᴇ",               value: nome,                                              inline: true },
      { name: "ʀᴜᴏʟᴏ",              value: `<@&${ruolo.id}>`,                                 inline: true },
      { name: "sᴛɪᴘᴇɴᴅɪᴏ",          value: `€${stipendio ?? 0}`,                              inline: true },
      { name: "ᴘᴏsᴛɪ",              value: posti ? String(posti) : "Illimitati",              inline: true },
      { name: "ᴄᴀɴᴀʟᴇ ᴄᴀɴᴅɪᴅᴀᴛᴜʀᴇ", value: canale ? `<#${canale.id}>` : "DM allo staff",     inline: true },
    )
    .setFooter(FOOTER)
    .setTimestamp();

  saveJobsSeed();
  await updateListalavoriIfPublished(interaction.client);
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// ── /pannellolicenziamento ────────────────────────────────────────────────────
export const pannellolicenziamentoData = new SlashCommandBuilder()
  .setName("pannellolicenziamento")
  .setDescription("Pubblica il pannello per licenziare dipendenti o dimettersi");

export async function pannellolicenziamentoHandler(interaction: ChatInputCommandInteraction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: "❌ Non hai i permessi per pubblicare questo pannello.", ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setTitle("🔥 ₊˚ ɢᴇsᴛɪᴏɴᴇ ɪᴍᴘɪᴇɢʜɪ ₊˚ 🚪")
    .setDescription(
      "⏔⏔⏔ ꒰ 🔥 ꒱ ⏔⏔⏔\n\n" +
      "🧸 ु°\n\n" +
      "🔥 **Licenzia Dipendente** ﹕ sᴏʟᴏ sᴛᴀFF — sᴇʟᴇᴢɪᴏɴᴀ ᴜɴ ᴅɪᴘᴇɴᴅᴇɴᴛᴇ ᴅᴀ ʟɪᴄᴇɴᴢɪᴀʀᴇ.\n" +
      "🚪 **Dimettiti** ﹕ ʟᴀsᴄɪᴀ ᴅᴀ sᴏʟᴏ ɪʟ ᴛᴜᴏ ʟᴀᴠᴏʀᴏ ᴀᴛᴛᴜᴀʟᴇ.\n\n" +
      "🧸 ु°\n\n" +
      "⏔⏔⏔ ꒰ 🔥 ꒱ ⏔⏔⏔\n\n" +
      "🪐 ˚ʚ♡ɞ˚ 🪐"
    )
    .setColor(COLORS.danger)
    .setFooter(FOOTER)
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("licenziamento_open")
      .setLabel("🔥 Licenzia Dipendente")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("dimissioni_open")
      .setLabel("🚪 Dimettiti")
      .setStyle(ButtonStyle.Secondary),
  );

  await sendPanel(interaction, { embeds: [embed], components: [row] });
}

// ── /dimissioni ───────────────────────────────────────────────────────────────
export const dimissioniData = new SlashCommandBuilder()
  .setName("dimissioni")
  .setDescription("Dai le dimissioni dal tuo lavoro attuale");

export async function dimissioniHandler(interaction: ChatInputCommandInteraction) {
  const userId = interaction.user.id;

  const emp = db.prepare(`
    SELECT e.*, j.name AS jobName, j.roleId, j.id AS jobId
    FROM employees e
    JOIN jobs j ON j.id = e.jobId
    WHERE e.userId = ?
    LIMIT 1
  `).get(userId) as (Employee & { jobName: string; roleId: string; jobId: number }) | undefined;

  if (!emp) {
    return interaction.reply({ content: "❌ Non sei assunto in nessun lavoro.", ephemeral: true });
  }

  db.prepare("DELETE FROM employees WHERE userId = ? AND jobId = ?").run(userId, emp.jobId);
  db.prepare("UPDATE jobs SET currentSlots = MAX(0, currentSlots - 1) WHERE id = ?").run(emp.jobId);

  const guild = interaction.guild!;
  try {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) await member.roles.remove(emp.roleId).catch(() => null);
  } catch { /* ignora */ }

  await updateListalavoriIfPublished(interaction.client);

  const embed = new EmbedBuilder()
    .setTitle("🚪 ₊˚ ᴅɪᴍɪssɪᴏɴɪ ᴀᴄᴄᴇᴛᴛᴀᴛᴇ ₊˚")
    .setDescription(
      "⏔⏔⏔ ꒰ 🚪 ꒱ ⏔⏔⏔\n\n" +
      `🧸 ु°\n\nʜᴀɪ ʟᴀsᴄɪᴀᴛᴏ ɪʟ ʟᴀᴠᴏʀᴏ ᴅɪ **${emp.jobName}**.\n\n🧸 ु°`
    )
    .setColor(COLORS.danger)
    .setThumbnail(interaction.user.displayAvatarURL())
    .setFooter(FOOTER)
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// ── /eliminalavoro (con autocomplete) ────────────────────────────────────────
export const eliminalavoroData = new SlashCommandBuilder()
  .setName("eliminalavoro")
  .setDescription("Elimina un lavoro (solo proprietario)")
  .addStringOption((o) =>
    o.setName("nome")
      .setDescription("Nome del lavoro da eliminare")
      .setRequired(true)
      .setAutocomplete(true)
  );

export async function eliminalavoroAutocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const jobs = db.prepare("SELECT name FROM jobs ORDER BY name ASC").all() as { name: string }[];
  const filtered = jobs
    .filter((j) => j.name.toLowerCase().includes(focused))
    .slice(0, 25);
  await interaction.respond(filtered.map((j) => ({ name: j.name, value: j.name })));
}

export async function eliminalavoroHandler(interaction: ChatInputCommandInteraction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: "❌ Non hai i permessi per eliminare lavori.", ephemeral: true });
  }
  const nome = interaction.options.getString("nome", true);

  const job = db.prepare("SELECT * FROM jobs WHERE name = ? COLLATE NOCASE").get(nome) as Job | undefined;
  if (!job) {
    return interaction.reply({ content: `❌ Lavoro "${nome}" non trovato.`, ephemeral: true });
  }

  const employees = db.prepare("SELECT userId FROM employees WHERE jobId = ?").all(job.id) as { userId: string }[];
  const guild = interaction.guild;
  if (guild) {
    for (const emp of employees) {
      try {
        const member = await guild.members.fetch(emp.userId).catch(() => null);
        if (member) await member.roles.remove(job.roleId).catch(() => null);
      } catch { /* ignora */ }
    }
  }

  db.prepare("DELETE FROM jobs WHERE id = ?").run(job.id);
  saveJobsSeed();
  await updateListalavoriIfPublished(interaction.client);

  const embed = new EmbedBuilder()
    .setTitle("🗑️ ₊˚ ʟᴀᴠᴏʀᴏ ᴇʟɪᴍɪɴᴀᴛᴏ ₊˚")
    .setDescription(
      "⏔⏔⏔ ꒰ 🗑️ ꒱ ⏔⏔⏔\n\n🧸 ु°\n\n" +
      `ɪʟ ʟᴀᴠᴏʀᴏ **${nome}** ᴇ sᴛᴀᴛᴏ ᴇʟɪᴍɪɴᴀᴛᴏ.\n` +
      `ʀᴜᴏʟᴏ ʀɪᴍᴏssᴏ ᴀ **${employees.length}** ᴅɪᴘᴇɴᴅᴇɴᴛᴇ/ɪ.\n\n🧸 ु°`
    )
    .setColor(COLORS.danger)
    .setFooter(FOOTER)
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// ── /listalavori ──────────────────────────────────────────────────────────────
export const listalavoriData = new SlashCommandBuilder()
  .setName("listalavori")
  .setDescription("Pubblica il pannello estetico con tutti i lavori (solo proprietario)");

export async function listalavoriHandler(interaction: ChatInputCommandInteraction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: "❌ Non hai i permessi per pubblicare questo pannello.", ephemeral: true });
  }

  const embed = buildListalavoriEmbed();
  const msg = await sendPanel(interaction, { embeds: [embed] });

  // Salva riferimento per aggiornamenti in tempo reale
  if (msg) {
    db.prepare("INSERT OR REPLACE INTO panels (name, channelId, messageId) VALUES (?, ?, ?)")
      .run("listalavori", msg.channelId, msg.id);
  }
}

// ── Helper interno: aggiorna il pannello listalavori se già pubblicato ────────
async function updateListalavoriIfPublished(client: import("discord.js").Client): Promise<void> {
  const { updateListalavoriPanel } = await import("../utils.js");
  await updateListalavoriPanel(client);
}
