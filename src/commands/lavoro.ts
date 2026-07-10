import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import db, { type Job, type Employee } from "../db.js";
import { isAdmin, LAVORI_CHANNEL_ID, sendPanel } from "../utils.js";

export const stipendioData = new SlashCommandBuilder()
  .setName("stipendio")
  .setDescription("Ritira il tuo stipendio");

export async function stipendioHandler(interaction: ChatInputCommandInteraction) {
  const account = db.prepare("SELECT * FROM accounts WHERE userId = ?").get(interaction.user.id);
  if (!account) {
    return interaction.reply({ content: "❌ Non hai un conto bancario. Usa `/apriconto` prima.", ephemeral: true });
  }

  const emp = db.prepare(`
    SELECT e.*, j.name as jobName, j.salary
    FROM employees e
    JOIN jobs j ON j.id = e.jobId
    WHERE e.userId = ?
    LIMIT 1
  `).get(interaction.user.id) as (Employee & { jobName: string; salary: number }) | undefined;

  if (!emp) {
    return interaction.reply({ content: "❌ Non hai un lavoro. Candidati tramite il pannello lavori.", ephemeral: true });
  }

  const now = new Date();
  if (emp.lastSalary) {
    const last = new Date(emp.lastSalary);
    const diffMs = now.getTime() - last.getTime();
    const diffH = diffMs / (1000 * 60 * 60);
    if (diffH < 24) {
      const remaining = Math.ceil(24 - diffH);
      return interaction.reply({ content: `❌ Hai già ritirato lo stipendio. Riprova tra **${remaining} ore**.`, ephemeral: true });
    }
  }

  db.prepare("UPDATE employees SET lastSalary = ? WHERE userId = ? AND jobId = ?")
    .run(now.toISOString(), interaction.user.id, emp.jobId);
  db.prepare("UPDATE accounts SET balance = balance + ? WHERE userId = ?")
    .run(emp.salary, interaction.user.id);

  const embed = new EmbedBuilder()
    .setTitle("💰 Stipendio Ritirato!")
    .setColor(0x57F287)
    .addFields(
      { name: "Lavoro", value: emp.jobName, inline: true },
      { name: "Importo", value: `€${emp.salary}`, inline: true },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

export const pannellolavoriData = new SlashCommandBuilder()
  .setName("pannellolavori")
  .setDescription("Pubblica il pannello per candidarsi a un lavoro (solo proprietario)");

export async function pannellolavoriHandler(interaction: ChatInputCommandInteraction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: "❌ Non hai i permessi per pubblicare il pannello.", ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setTitle("💼 Lavori Disponibili")
    .setDescription("Clicca il pulsante qui sotto per vedere i lavori disponibili e candidarti.")
    .setColor(0x5865F2)
    .setFooter({ text: "Apri il menu per candidarti" })
    .setTimestamp();

  const button = new ButtonBuilder()
    .setCustomId("candidatura_open")
    .setLabel("Candidati ai Lavori")
    .setStyle(ButtonStyle.Primary)
    .setEmoji("📋");

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

  await sendPanel(interaction, { embeds: [embed], components: [row] });
}

export const crealavoriData = new SlashCommandBuilder()
  .setName("crealavoro")
  .setDescription("Crea un lavoro o aggiorna stipendio/posti (solo proprietario)")
  .addStringOption((o) => o.setName("nome").setDescription("Nome del lavoro").setRequired(true))
  .addRoleOption((o) => o.setName("ruolo").setDescription("Ruolo Discord assegnato (richiesto solo per creare)").setRequired(false))
  .addIntegerOption((o) => o.setName("stipendio").setDescription("Stipendio giornaliero (€)").setMinValue(0))
  .addIntegerOption((o) => o.setName("posti").setDescription("Posti disponibili (vuoto = illimitati)").setMinValue(1));

export async function crealavoriHandler(interaction: ChatInputCommandInteraction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: "❌ Non hai i permessi per usare questo comando.", ephemeral: true });
  }

  const nome      = interaction.options.getString("nome", true);
  const ruolo     = interaction.options.getRole("ruolo");
  const stipendio = interaction.options.getInteger("stipendio");
  const posti     = interaction.options.getInteger("posti");

  const existing = db.prepare("SELECT * FROM jobs WHERE name = ? COLLATE NOCASE").get(nome) as Job | undefined;

  if (existing) {
    if (stipendio === null && posti === null && !ruolo) {
      return interaction.reply({ content: `ℹ️ Il lavoro **${nome}** esiste già. Specifica almeno uno tra \`stipendio\`, \`posti\` o \`ruolo\` per aggiornarlo.`, ephemeral: true });
    }

    if (stipendio !== null) db.prepare("UPDATE jobs SET salary = ? WHERE id = ?").run(stipendio, existing.id);
    if (posti !== null)     db.prepare("UPDATE jobs SET maxSlots = ? WHERE id = ?").run(posti, existing.id);
    if (ruolo)              db.prepare("UPDATE jobs SET roleId = ? WHERE id = ?").run(ruolo.id, existing.id);

    const updated = db.prepare("SELECT * FROM jobs WHERE id = ?").get(existing.id) as Job;
    const embed = new EmbedBuilder()
      .setTitle("✏️ Lavoro Aggiornato")
      .setColor(0xFEE75C)
      .addFields(
        { name: "Nome",      value: updated.name,                                          inline: true },
        { name: "Ruolo",     value: `<@&${updated.roleId}>`,                               inline: true },
        { name: "Stipendio", value: `€${updated.salary}`,                                  inline: true },
        { name: "Posti",     value: updated.maxSlots ? String(updated.maxSlots) : "Illimitati", inline: true },
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (!ruolo) {
    return interaction.reply({ content: "❌ Per creare un nuovo lavoro devi specificare il `ruolo`.", ephemeral: true });
  }

  db.prepare("INSERT INTO jobs (name, roleId, salary, maxSlots) VALUES (?, ?, ?, ?)").run(
    nome, ruolo.id, stipendio ?? 0, posti ?? null
  );

  const embed = new EmbedBuilder()
    .setTitle("✅ Lavoro Creato")
    .setColor(0x57F287)
    .addFields(
      { name: "Nome",      value: nome,                                    inline: true },
      { name: "Ruolo",     value: `<@&${ruolo.id}>`,                       inline: true },
      { name: "Stipendio", value: `€${stipendio ?? 0}`,                    inline: true },
      { name: "Posti",     value: posti ? String(posti) : "Illimitati",    inline: true },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

export const pannellolicenziamentoData = new SlashCommandBuilder()
  .setName("pannellolicenziamento")
  .setDescription("Pubblica il pannello per licenziare dipendenti (solo staff)");

export async function pannellolicenziamentoHandler(interaction: ChatInputCommandInteraction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: "❌ Non hai i permessi per pubblicare questo pannello.", ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setTitle("🔥 Gestione Licenziamenti")
    .setDescription("Clicca il pulsante qui sotto per selezionare un dipendente da licenziare.")
    .setColor(0xED4245)
    .setTimestamp();

  const button = new ButtonBuilder()
    .setCustomId("licenziamento_open")
    .setLabel("Licenzia Dipendente")
    .setEmoji("🔥")
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);
  await sendPanel(interaction, { embeds: [embed], components: [row] });
}

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
    if (member) {
      await member.roles.remove(emp.roleId).catch(() => null);
    }
  } catch { /* ignora se il ruolo non esiste più */ }

  const embed = new EmbedBuilder()
    .setTitle("📋 Dimissioni Accettate")
    .setDescription(
      `Hai dato le dimissioni da **${emp.jobName}**.\n\n` +
      `Sei ora disoccupato. Puoi candidarti a un nuovo lavoro nel canale <#${LAVORI_CHANNEL_ID}>.`
    )
    .setColor(0xED4245)
    .setThumbnail(interaction.user.displayAvatarURL())
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

export const eliminalavoroData = new SlashCommandBuilder()
  .setName("eliminalavoro")
  .setDescription("Elimina un lavoro (solo proprietario)")
  .addStringOption((o) => o.setName("nome").setDescription("Nome del lavoro da eliminare").setRequired(true));

export async function eliminalavoroHandler(interaction: ChatInputCommandInteraction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: "❌ Non hai i permessi per eliminare lavori.", ephemeral: true });
  }
  const nome = interaction.options.getString("nome", true);
  const result = db.prepare("DELETE FROM jobs WHERE name = ? COLLATE NOCASE").run(nome);

  if (result.changes === 0) {
    return interaction.reply({ content: `❌ Lavoro "${nome}" non trovato.`, ephemeral: true });
  }
  await interaction.reply({ content: `✅ Lavoro **${nome}** eliminato.`, ephemeral: true });
}
