import {
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import db, { type Job, type Shop, type Product, type Account, type Application, type ShopRequest } from "./db.js";
import { POSTINO_ROLE_ID, STAFF_ROLE_ID, memberIsStaff } from "./utils.js";

const BANDO_CHANNELS: Record<string, string> = {
  polizia:  "1521494201513283744",
  medici:   "1521494211231482037",
  pompieri: "1521494206332272660",
};

export async function handleButton(interaction: ButtonInteraction) {
  const [action, ...args] = interaction.customId.split(":");

  if (action === "banca_apri") {
    const existing = db.prepare("SELECT userId FROM accounts WHERE userId = ?").get(interaction.user.id);
    if (existing) {
      return interaction.reply({ content: "❌ Hai già un conto in banca!", ephemeral: true });
    }
    db.prepare("INSERT INTO accounts (userId, balance) VALUES (?, 0)").run(interaction.user.id);
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("🏦 Conto Aperto!")
          .setDescription("Il tuo conto è stato creato con successo.\nUsa **Crea PIN** e **Crea Carta** per completare la configurazione.")
          .setColor(0x57F287)
          .addFields({ name: "Saldo iniziale", value: "€0", inline: true })
          .setTimestamp(),
      ],
      ephemeral: true,
    });
  }

  if (action === "banca_pin") {
    const account = db.prepare("SELECT * FROM accounts WHERE userId = ?").get(interaction.user.id);
    if (!account) {
      return interaction.reply({ content: "❌ Non hai un conto bancario.", ephemeral: true });
    }
    const modal = new ModalBuilder()
      .setCustomId("banca_pin_modal")
      .setTitle("Imposta PIN");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("pin")
          .setLabel("PIN a 4 cifre")
          .setStyle(TextInputStyle.Short)
          .setMinLength(4)
          .setMaxLength(4)
          .setPlaceholder("Es: 1234")
          .setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }

  if (action === "banca_carta") {
    const account = db.prepare("SELECT * FROM accounts WHERE userId = ?").get(interaction.user.id);
    if (!account) {
      return interaction.reply({ content: "❌ Non hai un conto bancario.", ephemeral: true });
    }
    const existing = db.prepare("SELECT id FROM cards WHERE userId = ?").get(interaction.user.id);
    if (existing) {
      return interaction.reply({ content: "❌ Hai già una carta bancaria!", ephemeral: true });
    }
    const randomDigits = (n: number) =>
      Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
    const cardNumber = `${randomDigits(4)} ${randomDigits(4)} ${randomDigits(4)} ${randomDigits(4)}`;
    const cvv = randomDigits(3);
    const now = new Date();
    const expiry = `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getFullYear() + 3).slice(-2)}`;
    db.prepare("INSERT INTO cards (userId, cardNumber, cvv, expiry) VALUES (?, ?, ?, ?)").run(
      interaction.user.id, cardNumber, cvv, expiry
    );
    const embed = new EmbedBuilder()
      .setTitle("💳 Carta Bancaria Creata")
      .setColor(0x5865F2)
      .addFields(
        { name: "Numero Carta", value: `\`${cardNumber}\``, inline: false },
        { name: "CVV", value: `||${cvv}||`, inline: true },
        { name: "Scadenza", value: expiry, inline: true },
      )
      .setFooter({ text: "Tieni queste informazioni al sicuro!" })
      .setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (action === "candidatura_open") {
    const jobs = db.prepare("SELECT * FROM jobs ORDER BY name ASC").all() as Job[];

    if (jobs.length === 0) {
      return interaction.reply({ content: "❌ Non ci sono lavori disponibili al momento.", ephemeral: true });
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId("candidatura_select")
      .setPlaceholder("Seleziona un lavoro...")
      .addOptions(
        jobs.slice(0, 25).map((j) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(j.name)
            .setValue(String(j.id))
        )
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

    return interaction.reply({ components: [row], ephemeral: true });
  }

  if (action === "job_accept") {
    // Proprietario del server OPPURE membro con ruolo Staff (il bottone arriva in DM,
    // quindi interaction.member è null: va verificato recuperando il membro dalla guild)
    const guild = interaction.guild ?? await interaction.client.guilds.fetch(interaction.guildId!).catch(() => null);
    const invoker = guild ? await guild.members.fetch(interaction.user.id).catch(() => null) : null;
    const authorized = !!guild && (interaction.user.id === guild.ownerId || (invoker?.roles.cache.has(STAFF_ROLE_ID) ?? false));
    if (!authorized) {
      return interaction.reply({ content: "❌ Solo il proprietario o lo staff possono accettare candidature.", ephemeral: true });
    }

    const appId = args[0];
    const app = db.prepare("SELECT * FROM applications WHERE id = ?").get(appId) as Application | undefined;
    if (!app || app.status !== "pending") {
      return interaction.reply({ content: "❌ Candidatura non trovata o già gestita.", ephemeral: true });
    }

    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(app.jobId) as Job | undefined;
    if (!job) {
      return interaction.reply({ content: "❌ Il lavoro non esiste più.", ephemeral: true });
    }

    const accepted = db.transaction(() => {
      const freshJob = db.prepare("SELECT * FROM jobs WHERE id = ?").get(app.jobId) as Job;
      if (freshJob.maxSlots !== null && freshJob.currentSlots >= freshJob.maxSlots) {
        return false;
      }
      const ins = db.prepare("INSERT OR IGNORE INTO employees (userId, jobId) VALUES (?, ?)").run(app.userId, app.jobId);
      if (ins.changes === 0) return false;
      db.prepare("UPDATE jobs SET currentSlots = currentSlots + 1 WHERE id = ?").run(app.jobId);
      db.prepare("UPDATE applications SET status = 'accepted' WHERE id = ?").run(appId);
      return true;
    })();

    if (!accepted) {
      db.prepare("UPDATE applications SET status = 'rejected' WHERE id = ?").run(appId);
      return interaction.update({
        content: `❌ Impossibile accettare: posti esauriti o utente già assunto.`,
        components: [],
        embeds: [],
      });
    }

    try {
      const guild = await interaction.client.guilds.fetch(app.guildId);
      const member = await guild.members.fetch(app.userId).catch(() => null);
      if (member) {
        await member.roles.add(job.roleId).catch(() => null);
        await member.user.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("✅ Candidatura Accettata!")
              .setDescription(`La tua candidatura per **${job.name}** è stata **accettata**!`)
              .setColor(0x57F287)
              .setTimestamp(),
          ],
        }).catch(() => null);
      }
    } catch { /* guild non accessibile */ }

    await interaction.update({
      content: `✅ Candidatura di <@${app.userId}> per **${job.name}** **accettata**.`,
      components: [],
      embeds: [],
    });
    return;
  }

  if (action === "job_reject") {
    // Proprietario del server OPPURE membro con ruolo Staff (vedi nota su job_accept)
    const guild = interaction.guild ?? await interaction.client.guilds.fetch(interaction.guildId!).catch(() => null);
    const invoker = guild ? await guild.members.fetch(interaction.user.id).catch(() => null) : null;
    const authorized = !!guild && (interaction.user.id === guild.ownerId || (invoker?.roles.cache.has(STAFF_ROLE_ID) ?? false));
    if (!authorized) {
      return interaction.reply({ content: "❌ Solo il proprietario o lo staff possono rifiutare candidature.", ephemeral: true });
    }

    const appId = args[0];
    const app = db.prepare("SELECT * FROM applications WHERE id = ?").get(appId) as Application | undefined;
    if (!app || app.status !== "pending") {
      return interaction.reply({ content: "❌ Candidatura non trovata o già gestita.", ephemeral: true });
    }

    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(app.jobId) as Job | undefined;
    db.prepare("UPDATE applications SET status = 'rejected' WHERE id = ?").run(appId);

    try {
      const guild = await interaction.client.guilds.fetch(app.guildId);
      const member = await guild.members.fetch(app.userId).catch(() => null);
      if (member) {
        await member.user.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("❌ Candidatura Rifiutata")
              .setDescription(`La tua candidatura per **${job?.name ?? "il lavoro"}** è stata **rifiutata**.`)
              .setColor(0xED4245)
              .setTimestamp(),
          ],
        }).catch(() => null);
      }
    } catch { /* ignore */ }

    await interaction.update({
      content: `❌ Candidatura di <@${app.userId}> per **${job?.name ?? "il lavoro"}** **rifiutata**.`,
      components: [],
      embeds: [],
    });
    return;
  }

  if (action === "negozio_open") {
    const shops = db.prepare("SELECT * FROM shops ORDER BY name ASC").all() as Shop[];
    if (shops.length === 0) {
      return interaction.reply({ content: "❌ Nessun negozio disponibile al momento.", ephemeral: true });
    }
    const select = new StringSelectMenuBuilder()
      .setCustomId("negozio_select")
      .setPlaceholder("Scegli un negozio...")
      .addOptions(
        shops.slice(0, 25).map((s) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(s.name)
            .setValue(String(s.id))
            .setEmoji("🛍️")
        )
      );
    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    return interaction.reply({ components: [row], ephemeral: true });
  }

  if (action === "negozio_richiedi") {
    const modal = new ModalBuilder()
      .setCustomId("negozio_richiedi_modal")
      .setTitle("Richiedi Apertura Negozio");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("shop_name")
          .setLabel("Nome del negozio")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("shop_desc")
          .setLabel("Descrizione / motivo della richiesta")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
      ),
    );
    return interaction.showModal(modal);
  }

  if (action === "negozio_richiesta_approva" || action === "negozio_richiesta_rifiuta") {
    const guild = interaction.guild ?? await interaction.client.guilds.fetch(interaction.guildId!).catch(() => null);
    if (!guild || !memberIsStaff(interaction.member, interaction.user.id, guild.ownerId)) {
      return interaction.reply({ content: "❌ Solo lo staff può gestire questa richiesta.", ephemeral: true });
    }

    const requestId = args[0];
    const request = db.prepare("SELECT * FROM shop_requests WHERE id = ?").get(requestId) as ShopRequest | undefined;
    if (!request || request.status !== "pending") {
      return interaction.reply({ content: "❌ Richiesta non trovata o già gestita.", ephemeral: true });
    }

    if (action === "negozio_richiesta_approva") {
      const outcome = db.transaction(() => {
        const fresh = db.prepare("SELECT * FROM shop_requests WHERE id = ?").get(requestId) as ShopRequest | undefined;
        if (!fresh || fresh.status !== "pending") return "already_handled" as const;

        const dup = db.prepare("SELECT id FROM shops WHERE name = ? COLLATE NOCASE").get(fresh.shopName);
        if (dup) {
          db.prepare("UPDATE shop_requests SET status = 'rejected' WHERE id = ?").run(requestId);
          return "duplicate" as const;
        }

        db.prepare("INSERT INTO shops (name, ownerId) VALUES (?, ?)").run(fresh.shopName, fresh.userId);
        db.prepare("UPDATE shop_requests SET status = 'approved' WHERE id = ?").run(requestId);
        return "approved" as const;
      })();

      if (outcome === "already_handled") {
        return interaction.reply({ content: "❌ Richiesta già gestita da un altro membro dello staff.", ephemeral: true });
      }
      if (outcome === "duplicate") {
        return interaction.update({
          content: `❌ Impossibile approvare: esiste già un negozio chiamato **${request.shopName}**.`,
          embeds: [], components: [],
        });
      }

      try {
        const user = await interaction.client.users.fetch(request.userId);
        await user.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("✅ Richiesta Approvata!")
              .setDescription(`Il tuo negozio **${request.shopName}** è stato approvato ed è ora attivo!`)
              .setColor(0x57F287)
              .setTimestamp(),
          ],
        }).catch(() => null);
      } catch { /* ignore */ }

      return interaction.update({
        content: `✅ Richiesta di <@${request.userId}> per **${request.shopName}** **approvata** da <@${interaction.user.id}>. Il negozio è ora attivo.`,
        embeds: [], components: [],
      });
    } else {
      const rejectResult = db.prepare(
        "UPDATE shop_requests SET status = 'rejected' WHERE id = ? AND status = 'pending'"
      ).run(requestId);
      if (rejectResult.changes === 0) {
        return interaction.reply({ content: "❌ Richiesta già gestita da un altro membro dello staff.", ephemeral: true });
      }

      try {
        const user = await interaction.client.users.fetch(request.userId);
        await user.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("❌ Richiesta Rifiutata")
              .setDescription(`La tua richiesta per aprire il negozio **${request.shopName}** è stata rifiutata.`)
              .setColor(0xED4245)
              .setTimestamp(),
          ],
        }).catch(() => null);
      } catch { /* ignore */ }

      return interaction.update({
        content: `❌ Richiesta di <@${request.userId}> per **${request.shopName}** **rifiutata** da <@${interaction.user.id}>.`,
        embeds: [], components: [],
      });
    }
  }

  // ── Crea prodotto (solo dipendenti con un lavoro assegnato) ────────────────
  if (action === "creaprodotto_open") {
    const isEmployee = db.prepare("SELECT userId FROM employees WHERE userId = ?").get(interaction.user.id);
    if (!isEmployee) {
      return interaction.reply({ content: "❌ Solo i dipendenti (con un lavoro assegnato) possono creare prodotti.", ephemeral: true });
    }

    const shops = db.prepare("SELECT * FROM shops ORDER BY name ASC").all() as Shop[];
    if (shops.length === 0) {
      return interaction.reply({ content: "❌ Nessun negozio disponibile al momento.", ephemeral: true });
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId("creaprodotto_select_shop")
      .setPlaceholder("Scegli il negozio del prodotto...")
      .addOptions(
        shops.slice(0, 25).map((s) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(s.name)
            .setValue(String(s.id))
            .setEmoji("🛍️")
        )
      );
    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    return interaction.reply({ content: "Seleziona il negozio a cui aggiungere il prodotto:", components: [row], ephemeral: true });
  }

  // ── Elimina prodotto: apre tendina di tutti i negozi (solo dipendenti) ────
  if (action === "eliminaprodotto_open") {
    const isEmployee = db.prepare("SELECT userId FROM employees WHERE userId = ?").get(interaction.user.id);
    if (!isEmployee) {
      return interaction.reply({ content: "❌ Solo i dipendenti (con un lavoro assegnato) possono eliminare prodotti.", ephemeral: true });
    }

    const allShops = db.prepare("SELECT * FROM shops ORDER BY name ASC").all() as Shop[];
    if (allShops.length === 0) {
      return interaction.reply({ content: "❌ Nessun negozio disponibile al momento.", ephemeral: true });
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId("eliminaprodotto_select_shop")
      .setPlaceholder("Scegli il negozio...")
      .addOptions(
        allShops.slice(0, 25).map((s) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(s.name)
            .setValue(String(s.id))
            .setEmoji("🛍️")
        )
      );
    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    return interaction.reply({ content: "Seleziona il negozio da cui eliminare un prodotto:", components: [row], ephemeral: true });
  }

  // ── Dimettiti: apre conferma prima di lasciare il lavoro ───────────────────
  if (action === "dimissioni_open") {
    const emp = db.prepare(`
      SELECT e.*, j.name AS jobName, j.roleId, j.id AS jobId
      FROM employees e
      JOIN jobs j ON j.id = e.jobId
      WHERE e.userId = ?
      LIMIT 1
    `).get(interaction.user.id) as { userId: string; jobId: number; jobName: string; roleId: string } | undefined;

    if (!emp) {
      return interaction.reply({ content: "❌ Non sei assunto in nessun lavoro.", ephemeral: true });
    }

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`dimissioni_confirm:${emp.jobId}`)
        .setLabel("Conferma Dimissioni")
        .setEmoji("⚠️")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("dimissioni_cancel")
        .setLabel("Annulla")
        .setStyle(ButtonStyle.Secondary),
    );

    return interaction.reply({
      content: `⚠️ Sei sicuro di voler dare le dimissioni da **${emp.jobName}**? Ti verrà tolto il ruolo e perderai il posto di lavoro.`,
      components: [row],
      ephemeral: true,
    });
  }

  // ── Dimettiti: conferma → rimuove dal lavoro e toglie il ruolo ─────────────
  if (action === "dimissioni_confirm") {
    const jobId = parseInt(args[0]!);
    const userId = interaction.user.id;

    const emp = db.prepare(`
      SELECT e.*, j.name AS jobName, j.roleId
      FROM employees e
      JOIN jobs j ON j.id = e.jobId
      WHERE e.userId = ? AND e.jobId = ?
    `).get(userId, jobId) as { userId: string; jobId: number; jobName: string; roleId: string } | undefined;

    if (!emp) {
      return interaction.update({ content: "❌ Non risulti più assunto in questo lavoro.", components: [], embeds: [] });
    }

    db.prepare("DELETE FROM employees WHERE userId = ? AND jobId = ?").run(userId, jobId);
    db.prepare("UPDATE jobs SET currentSlots = MAX(0, currentSlots - 1) WHERE id = ?").run(jobId);

    const guild = interaction.guild ?? await interaction.client.guilds.fetch(interaction.guildId!).catch(() => null);
    if (guild) {
      try {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) await member.roles.remove(emp.roleId).catch(() => null);
      } catch { /* ignora se il ruolo non esiste più */ }
    }

    return interaction.update({
      content: `📋 Hai dato le dimissioni da **${emp.jobName}**. Sei ora disoccupato e il ruolo ti è stato rimosso.`,
      components: [],
      embeds: [],
    });
  }

  // ── Dimettiti: annulla ──────────────────────────────────────────────────────
  if (action === "dimissioni_cancel") {
    return interaction.update({ content: "✅ Dimissioni annullate.", components: [], embeds: [] });
  }

  if (action === "licenziamento_open") {
    const guild = interaction.guild ?? await interaction.client.guilds.fetch(interaction.guildId!).catch(() => null);
    if (!guild || !memberIsStaff(interaction.member, interaction.user.id, guild.ownerId)) {
      return interaction.reply({ content: "❌ Non hai i permessi per licenziare dipendenti.", ephemeral: true });
    }

    const employees = db.prepare(`
      SELECT e.userId, j.name as jobName, j.id as jobId
      FROM employees e
      JOIN jobs j ON j.id = e.jobId
      ORDER BY j.name
    `).all() as { userId: string; jobName: string; jobId: number }[];

    if (employees.length === 0) {
      return interaction.reply({ content: "❌ Non ci sono dipendenti al momento.", ephemeral: true });
    }

    const options = employees.slice(0, 25).map((e) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`${e.userId}`)
        .setValue(`${e.userId}:${e.jobId}`)
        .setDescription(`Lavoro: ${e.jobName}`)
    );

    for (const e of employees.slice(0, 25)) {
      try {
        const member = await guild.members.fetch(e.userId).catch(() => null);
        const opt = options.find((o) => o.data.value === `${e.userId}:${e.jobId}`);
        if (member && opt) {
          opt.setLabel(`${member.user.username} — ${e.jobName}`);
        }
      } catch { /* ignore */ }
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId("licenziamento_select")
      .setPlaceholder("Seleziona il dipendente da licenziare...")
      .addOptions(options);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

    return interaction.reply({
      content: "👥 Seleziona il dipendente da licenziare:",
      components: [row],
      ephemeral: true,
    });
  }

  if (action === "auto_buy") {
    const carId = parseInt(args[0]);
    const account = db.prepare("SELECT * FROM accounts WHERE userId = ?").get(interaction.user.id) as Account | undefined;
    if (!account) {
      return interaction.reply({ content: "❌ Non hai un conto bancario. Usa `/apriconto`.", ephemeral: true });
    }
    const car = db.prepare("SELECT * FROM cars WHERE id = ?").get(carId) as { id: number; name: string; price: number } | undefined;
    if (!car) {
      return interaction.reply({ content: "❌ Auto non trovata.", ephemeral: true });
    }
    if (account.balance < car.price) {
      return interaction.reply({ content: `❌ Saldo insufficiente. Ti servono **€${car.price}**, hai **€${account.balance}**.`, ephemeral: true });
    }
    db.prepare("UPDATE accounts SET balance = balance - ? WHERE userId = ?").run(car.price, interaction.user.id);

    const embed = new EmbedBuilder()
      .setTitle("🚗 Acquisto Completato!")
      .setColor(0x57F287)
      .addFields(
        { name: "Auto", value: car.name, inline: true },
        { name: "Pagato", value: `€${car.price}`, inline: true },
        { name: "Nuovo Saldo", value: `€${account.balance - car.price}`, inline: true },
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (action === "house_buy") {
    const houseId = parseInt(args[0]);
    const account = db.prepare("SELECT * FROM accounts WHERE userId = ?").get(interaction.user.id) as Account | undefined;
    if (!account) {
      return interaction.reply({ content: "❌ Non hai un conto bancario. Usa `/apriconto`.", ephemeral: true });
    }
    const house = db.prepare("SELECT * FROM houses WHERE id = ?").get(houseId) as { id: number; name: string; price: number } | undefined;
    if (!house) {
      return interaction.reply({ content: "❌ Casa non trovata.", ephemeral: true });
    }
    if (account.balance < house.price) {
      return interaction.reply({ content: `❌ Saldo insufficiente. Ti servono **€${house.price}**, hai **€${account.balance}**.`, ephemeral: true });
    }
    db.prepare("UPDATE accounts SET balance = balance - ? WHERE userId = ?").run(house.price, interaction.user.id);

    const embed = new EmbedBuilder()
      .setTitle("🏠 Acquisto Completato!")
      .setColor(0x57F287)
      .addFields(
        { name: "Casa", value: house.name, inline: true },
        { name: "Pagato", value: `€${house.price}`, inline: true },
        { name: "Nuovo Saldo", value: `€${account.balance - house.price}`, inline: true },
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (action === "product_buy") {
    const productId = args[0];
    const product = db.prepare("SELECT * FROM products WHERE id = ?").get(parseInt(productId)) as Product | undefined;
    if (!product) {
      return interaction.reply({ content: "❌ Prodotto non trovato.", ephemeral: true });
    }
    const modal = new ModalBuilder()
      .setCustomId(`product_buy_modal:${productId}`)
      .setTitle(`🛒 Acquisto: ${product.name}`);
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("pin")
          .setLabel("PIN del tuo conto (4 cifre)")
          .setStyle(TextInputStyle.Short)
          .setMinLength(4)
          .setMaxLength(4)
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("roblox_username")
          .setLabel("Il tuo username Roblox")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Es: RobloxUser123")
          .setRequired(true)
      ),
    );
    return interaction.showModal(modal);
  }

  if (action === "pagamento_open") {
    const modal = new ModalBuilder()
      .setCustomId("pagamento_modal")
      .setTitle("Invia Pagamento");

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("recipient_id")
          .setLabel("ID Discord del destinatario")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Es: 123456789012345678")
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("amount")
          .setLabel("Importo (€)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Es: 500")
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("causale")
          .setLabel("Causale")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Es: Affitto")
          .setRequired(false)
      ),
    );

    return interaction.showModal(modal);
  }
}

export async function handleSelectMenu(interaction: StringSelectMenuInteraction) {
  const [action] = interaction.customId.split(":");
  const values = interaction.values;

  if (action === "candidatura_select") {
    const jobId = parseInt(values[0]);
    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as Job | undefined;
    if (!job) {
      return interaction.reply({ content: "❌ Lavoro non trovato.", ephemeral: true });
    }

    const guild = interaction.guild!;
    const userId = interaction.user.id;

    const alreadyEmp = db.prepare("SELECT userId FROM employees WHERE userId = ? AND jobId = ?").get(userId, jobId);
    if (alreadyEmp) {
      return interaction.reply({ content: `❌ Sei già assunto come **${job.name}**.`, ephemeral: true });
    }

    const pendingApp = db.prepare(
      "SELECT id FROM applications WHERE userId = ? AND jobId = ? AND status IN ('pending', 'bando')"
    ).get(userId, jobId);
    if (pendingApp) {
      return interaction.reply({ content: "❌ Hai già una candidatura in attesa per questo lavoro.", ephemeral: true });
    }

    const jobKey = job.name.toLowerCase().trim();
    const bandoChannelId = BANDO_CHANNELS[jobKey];

    if (bandoChannelId) {
      const channel = guild.channels.cache.get(bandoChannelId)
        ?? await guild.channels.fetch(bandoChannelId).catch(() => null);

      if (!channel || !channel.isTextBased()) {
        return interaction.reply({ content: "❌ Canale bando non trovato. Contatta un amministratore.", ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle(`📋 Nuova Candidatura — ${job.name}`)
        .setColor(0x5865F2)
        .setThumbnail(interaction.user.displayAvatarURL())
        .addFields(
          { name: "Candidato", value: `<@${userId}>`, inline: true },
          { name: "Username", value: interaction.user.username, inline: true },
          { name: "Lavoro", value: job.name, inline: true },
          { name: "Data", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
        )
        .setTimestamp();

      await channel.send({ embeds: [embed] });

      db.prepare("INSERT INTO applications (userId, jobId, guildId, status) VALUES (?, ?, ?, 'bando')").run(userId, jobId, guild.id);

      return interaction.reply({
        content: `✅ La tua candidatura per **${job.name}** è stata inviata nel canale bando!`,
        ephemeral: true,
      });
    } else {
      if (job.maxSlots !== null && job.currentSlots >= job.maxSlots) {
        return interaction.reply({ content: `❌ Non ci sono posti disponibili per **${job.name}**.`, ephemeral: true });
      }

      const appResult = db.prepare(
        "INSERT INTO applications (userId, jobId, guildId) VALUES (?, ?, ?)"
      ).run(userId, jobId, guild.id);

      const appId = appResult.lastInsertRowid;

      const embed = new EmbedBuilder()
        .setTitle(`📬 Nuova Candidatura — ${job.name}`)
        .setColor(0x5865F2)
        .setThumbnail(interaction.user.displayAvatarURL())
        .addFields(
          { name: "Candidato", value: `<@${userId}> (${interaction.user.username})`, inline: false },
          { name: "Lavoro", value: job.name, inline: true },
          { name: "Stipendio", value: `€${job.salary}`, inline: true },
          { name: "Posti rimanenti", value: job.maxSlots ? `${job.maxSlots - job.currentSlots}` : "Illimitati", inline: true },
          { name: "Server", value: guild.name, inline: true },
          { name: "Data", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
        )
        .setTimestamp();

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`job_accept:${appId}`)
          .setLabel("✅ Accetta")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`job_reject:${appId}`)
          .setLabel("❌ Rifiuta")
          .setStyle(ButtonStyle.Danger),
      );

      // Manda la candidatura in DM sia al proprietario reale sia a tutti i membri con ruolo Staff,
      // così chiunque abbia i permessi può accettarla, non solo il vero owner del server Discord.
      let reached = 0;
      try {
        const owner = await guild.fetchOwner();
        await owner.send({ embeds: [embed], components: [row] });
        reached++;
      } catch { /* il proprietario ha i DM chiusi */ }

      try {
        await guild.members.fetch();
        const staffMembers = guild.members.cache.filter((m) => m.roles.cache.has(STAFF_ROLE_ID) && m.id !== guild.ownerId);
        for (const [, member] of staffMembers) {
          const sent = await member.send({ embeds: [embed], components: [row] }).then(() => true).catch(() => false);
          if (sent) reached++;
        }
      } catch { /* ignore */ }

      if (reached === 0) {
        db.prepare("DELETE FROM applications WHERE id = ?").run(appId);
        return interaction.reply({ content: "❌ Impossibile contattare il proprietario o lo staff (DM chiusi). Contattali direttamente.", ephemeral: true });
      }

      return interaction.reply({
        content: `✅ La tua candidatura per **${job.name}** è stata inviata! Attendi la risposta del proprietario o dello staff.`,
        ephemeral: true,
      });
    }
  }

  // ── Crea prodotto: negozio scelto, apri modal ───────────────────────────────
  if (action === "creaprodotto_select_shop") {
    const shopId = parseInt(values[0]!);
    const shop = db.prepare("SELECT * FROM shops WHERE id = ?").get(shopId) as Shop | undefined;
    if (!shop) {
      return interaction.reply({ content: "❌ Negozio non trovato.", ephemeral: true });
    }

    const modal = new ModalBuilder()
      .setCustomId(`creaprodotto_modal:${shopId}`)
      .setTitle(`Nuovo Prodotto — ${shop.name}`);
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("nome")
          .setLabel("Nome del prodotto")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("prezzo")
          .setLabel("Prezzo (€)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("descrizione")
          .setLabel("Descrizione")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
      ),
    );
    return interaction.showModal(modal);
  }

  // ── Elimina prodotto: negozio scelto, mostra i prodotti creati dall'utente ─
  if (action === "eliminaprodotto_select_shop") {
    const shopId = parseInt(values[0]!);
    const shop = db.prepare("SELECT * FROM shops WHERE id = ?").get(shopId) as Shop | undefined;
    if (!shop) {
      return interaction.reply({ content: "❌ Negozio non trovato.", ephemeral: true });
    }

    // Mostra solo i prodotti che l'utente ha creato in questo negozio
    const products = db.prepare("SELECT * FROM products WHERE shopId = ? AND createdBy = ? ORDER BY name ASC").all(shopId, interaction.user.id) as Product[];
    if (products.length === 0) {
      return interaction.reply({ content: `❌ Il negozio **${shop.name}** non ha prodotti da eliminare.`, ephemeral: true });
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId("eliminaprodotto_select_product")
      .setPlaceholder("Scegli il prodotto da eliminare...")
      .addOptions(
        products.slice(0, 25).map((p) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${p.name} — €${p.price}`)
            .setValue(String(p.id))
            .setEmoji("🗑️")
        )
      );
    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    return interaction.reply({ content: `Seleziona il prodotto da eliminare da **${shop.name}**:`, components: [row], ephemeral: true });
  }

  // ── Elimina prodotto: prodotto scelto, elimina dal DB ──────────────────────
  if (action === "eliminaprodotto_select_product") {
    const productId = parseInt(values[0]!);
    const product = db.prepare(`
      SELECT p.*, s.name as shopName FROM products p
      JOIN shops s ON s.id = p.shopId
      WHERE p.id = ?
    `).get(productId) as (Product & { shopName: string }) | undefined;

    if (!product) {
      return interaction.reply({ content: "❌ Prodotto non trovato (forse già eliminato).", ephemeral: true });
    }
    if (product.createdBy !== interaction.user.id) {
      return interaction.reply({ content: "❌ Non puoi eliminare un prodotto che non hai creato tu.", ephemeral: true });
    }

    db.prepare("DELETE FROM products WHERE id = ?").run(productId);

    return interaction.reply({
      content: `✅ Prodotto **${product.name}** eliminato da **${product.shopName}**.`,
      ephemeral: true,
    });
  }

  if (action === "negozio_select") {
    const shopId = parseInt(values[0]);
    const shop = db.prepare("SELECT * FROM shops WHERE id = ?").get(shopId) as Shop | undefined;
    if (!shop) {
      return interaction.reply({ content: "❌ Negozio non trovato.", ephemeral: true });
    }

    const products = db.prepare("SELECT * FROM products WHERE shopId = ? ORDER BY price ASC").all(shopId) as Product[];
    if (products.length === 0) {
      return interaction.reply({ content: `❌ Il negozio **${shop.name}** non ha prodotti al momento.`, ephemeral: true });
    }

    const shown = products.slice(0, 10);
    const embeds = shown.map((p) => {
      const embed = new EmbedBuilder()
        .setTitle(`🏷️ ${p.name}`)
        .setColor(0xFEE75C)
        .addFields(
          { name: "Prezzo", value: `€${p.price}`, inline: true },
          { name: "Negozio", value: shop.name, inline: true },
        );
      if (p.description) embed.setDescription(p.description);
      if (p.imageUrl) embed.setImage(p.imageUrl);
      return embed;
    });

    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    for (let i = 0; i < shown.length; i += 5) {
      const chunk = shown.slice(i, i + 5);
      rows.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          chunk.map((p) =>
            new ButtonBuilder()
              .setCustomId(`product_buy:${p.id}`)
              .setLabel(`🛒 ${p.name} — €${p.price}`)
              .setStyle(ButtonStyle.Success)
          )
        )
      );
    }

    return interaction.reply({ embeds, components: rows.slice(0, 5), ephemeral: true });
  }

  if (action === "licenziamento_select") {
    const guild = interaction.guild ?? await interaction.client.guilds.fetch(interaction.guildId!).catch(() => null);
    if (!guild || !memberIsStaff(interaction.member, interaction.user.id, guild.ownerId)) {
      return interaction.reply({ content: "❌ Non hai i permessi per licenziare dipendenti.", ephemeral: true });
    }
    const [userId, jobIdStr] = values[0].split(":");
    const jobId = parseInt(jobIdStr);

    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as Job | undefined;

    db.prepare("DELETE FROM employees WHERE userId = ? AND jobId = ?").run(userId, jobId);
    db.prepare("UPDATE jobs SET currentSlots = MAX(0, currentSlots - 1) WHERE id = ?").run(jobId);

    try {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member && job) {
        await member.roles.remove(job.roleId).catch(() => null);
        await member.user.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("📋 Licenziamento")
              .setDescription(`Sei stato licenziato da **${job.name}**.`)
              .setColor(0xED4245)
              .setTimestamp(),
          ],
        }).catch(() => null);
      }
    } catch { /* ignore */ }

    return interaction.reply({
      content: `✅ <@${userId}> è stato licenziato da **${job?.name ?? "il lavoro"}**.`,
      ephemeral: true,
    });
  }
}

export async function handleModal(interaction: ModalSubmitInteraction) {
  const [action, ...args] = interaction.customId.split(":");

  if (action === "negozio_richiedi_modal") {
    const shopName = interaction.fields.getTextInputValue("shop_name").trim();
    const shopDesc = interaction.fields.getTextInputValue("shop_desc")?.trim() || "Nessuna descrizione fornita";

    const existing = db.prepare("SELECT id FROM shops WHERE name = ? COLLATE NOCASE").get(shopName);
    if (existing) {
      return interaction.reply({ content: `❌ Esiste già un negozio chiamato "${shopName}".`, ephemeral: true });
    }

    const guild = interaction.guild!;
    await interaction.deferReply({ ephemeral: true });

    const parentId = interaction.channel && "parentId" in interaction.channel ? interaction.channel.parentId : null;

    const channel = await guild.channels.create({
      name: `richiesta-negozio-${interaction.user.username}`.toLowerCase().slice(0, 90),
      type: ChannelType.GuildText,
      parent: parentId ?? undefined,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: STAFF_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      ],
    }).catch(() => null);

    if (!channel) {
      return interaction.editReply({ content: "❌ Impossibile creare il canale della richiesta. Contatta lo staff." });
    }

    const result = db.prepare(
      "INSERT INTO shop_requests (userId, shopName, guildId, channelId) VALUES (?, ?, ?, ?)"
    ).run(interaction.user.id, shopName, guild.id, channel.id);
    const requestId = result.lastInsertRowid;

    const embed = new EmbedBuilder()
      .setTitle("📝 Nuova Richiesta di Apertura Negozio")
      .setColor(0x5865F2)
      .setThumbnail(interaction.user.displayAvatarURL())
      .addFields(
        { name: "Richiedente", value: `<@${interaction.user.id}>`, inline: true },
        { name: "Nome Negozio", value: shopName, inline: true },
        { name: "Descrizione", value: shopDesc, inline: false },
      )
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`negozio_richiesta_approva:${requestId}`).setLabel("✅ Approva").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`negozio_richiesta_rifiuta:${requestId}`).setLabel("❌ Rifiuta").setStyle(ButtonStyle.Danger),
    );

    await channel.send({
      content: `<@${interaction.user.id}> <@&${STAFF_ROLE_ID}>`,
      embeds: [embed],
      components: [row],
    });

    return interaction.editReply({ content: `✅ Richiesta inviata! Discutine con lo staff nel canale ${channel}.` });
  }

  // ── Crea prodotto: salva nel DB ─────────────────────────────────────────────
  if (action === "creaprodotto_modal") {
    const shopId = parseInt(args[0]!);
    const nome = interaction.fields.getTextInputValue("nome").trim();
    const prezzoStr = interaction.fields.getTextInputValue("prezzo").trim();
    const descrizione = interaction.fields.getTextInputValue("descrizione")?.trim() || "";

    const prezzo = parseInt(prezzoStr);
    if (isNaN(prezzo) || prezzo < 0) {
      return interaction.reply({ content: "❌ Prezzo non valido. Inserisci solo numeri.", ephemeral: true });
    }

    const shop = db.prepare("SELECT * FROM shops WHERE id = ?").get(shopId) as Shop | undefined;
    if (!shop) {
      return interaction.reply({ content: "❌ Negozio non trovato.", ephemeral: true });
    }

    const result = db.prepare(
      "INSERT INTO products (shopId, name, price, description, createdBy) VALUES (?, ?, ?, ?, ?)"
    ).run(shopId, nome, prezzo, descrizione, interaction.user.id);

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

    return interaction.reply({ content: "✅ Prodotto aggiunto!", embeds: [embed], ephemeral: true });
  }

  if (action === "product_buy_modal") {
    const productId = parseInt(args[0]!);
    const pin = interaction.fields.getTextInputValue("pin").trim();
    const robloxUsername = interaction.fields.getTextInputValue("roblox_username").trim();

    const account = db.prepare("SELECT * FROM accounts WHERE userId = ?").get(interaction.user.id) as Account | undefined;
    if (!account) {
      return interaction.reply({ content: "❌ Non hai un conto bancario. Usa `/apriconto`.", ephemeral: true });
    }
    if (!account.pin || account.pin !== pin) {
      return interaction.reply({ content: "❌ PIN errato.", ephemeral: true });
    }

    const product = db.prepare(`
      SELECT p.*, s.name as shopName, s.ownerId as shopOwnerId FROM products p
      JOIN shops s ON s.id = p.shopId
      WHERE p.id = ?
    `).get(productId) as (Product & { shopName: string; shopOwnerId: string | null }) | undefined;
    if (!product) {
      return interaction.reply({ content: "❌ Prodotto non trovato.", ephemeral: true });
    }
    const debit = db.prepare(
      "UPDATE accounts SET balance = balance - ? WHERE userId = ? AND balance >= ?"
    ).run(product.price, interaction.user.id, product.price);

    if (debit.changes === 0) {
      const fresh = db.prepare("SELECT * FROM accounts WHERE userId = ?").get(interaction.user.id) as Account;
      return interaction.reply({ content: `❌ Saldo insufficiente. Ti servono **€${product.price}**, hai **€${fresh.balance}**.`, ephemeral: true });
    }

    const newBalance = (db.prepare("SELECT balance FROM accounts WHERE userId = ?").get(interaction.user.id) as { balance: number }).balance;

    const buyerEmbed = new EmbedBuilder()
      .setTitle("✅ Acquisto Completato!")
      .setColor(0x57F287)
      .addFields(
        { name: "Prodotto", value: product.name, inline: true },
        { name: "Negozio", value: product.shopName, inline: true },
        { name: "Pagato", value: `€${product.price}`, inline: true },
        { name: "Nuovo Saldo", value: `€${newBalance}`, inline: true },
        { name: "Username Roblox", value: robloxUsername, inline: true },
      )
      .setDescription("📦 Presentati al prossimo RP per ritirare il tuo pacco!")
      .setTimestamp();
    if (product.imageUrl) buyerEmbed.setThumbnail(product.imageUrl);

    await interaction.reply({ embeds: [buyerEmbed], ephemeral: true });

    const guild = interaction.guild!;

    try {
      const ownerId = product.shopOwnerId ?? guild.ownerId;
      const ownerUser = await interaction.client.users.fetch(ownerId).catch(() => null);
      if (ownerUser) {
        await ownerUser.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("💰 Nuovo Acquisto nel Tuo Negozio!")
              .setColor(0x57F287)
              .addFields(
                { name: "Prodotto", value: product.name, inline: true },
                { name: "Negozio", value: product.shopName, inline: true },
                { name: "Importo ricevuto", value: `€${product.price}`, inline: true },
                { name: "Acquirente", value: `<@${interaction.user.id}> (${interaction.user.username})`, inline: false },
                { name: "Username Roblox acquirente", value: robloxUsername, inline: true },
              )
              .setTimestamp(),
          ],
        }).catch(() => null);
      }
    } catch { /* ignore */ }

    try {
      await interaction.user.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("📦 Il tuo ordine è in arrivo!")
            .setDescription(`Hai acquistato **${product.name}** dal negozio **${product.shopName}**.\n\n📅 Presentati al prossimo RP per ritirare il pacco!`)
            .setColor(0x5865F2)
            .addFields(
              { name: "Prodotto", value: product.name, inline: true },
              { name: "Username Roblox", value: robloxUsername, inline: true },
            )
            .setTimestamp(),
        ],
      }).catch(() => null);
    } catch { /* ignore */ }

    try {
      const postinoRole = await guild.roles.fetch(POSTINO_ROLE_ID).catch(() => null);
      if (postinoRole) {
        await guild.members.fetch();
        const postinoEmbed = new EmbedBuilder()
          .setTitle("📫 Nuova Consegna!")
          .setDescription("Consegna al prossimo RP!")
          .setColor(0xFEE75C)
          .addFields(
            { name: "Prodotto da consegnare", value: product.name, inline: true },
            { name: "Negozio", value: product.shopName, inline: true },
            { name: "Consegna a (Roblox)", value: robloxUsername, inline: true },
            { name: "Acquirente Discord", value: `<@${interaction.user.id}>`, inline: true },
          )
          .setTimestamp();
        for (const [, member] of postinoRole.members) {
          await member.send({ embeds: [postinoEmbed] }).catch(() => null);
        }
      }
    } catch { /* ignore */ }

    return;
  }

  if (action === "banca_pin_modal") {
    const pin = interaction.fields.getTextInputValue("pin").trim();
    if (!/^\d{4}$/.test(pin)) {
      return interaction.reply({ content: "❌ Il PIN deve essere composto da 4 cifre numeriche.", ephemeral: true });
    }
    const account = db.prepare("SELECT * FROM accounts WHERE userId = ?").get(interaction.user.id);
    if (!account) {
      return interaction.reply({ content: "❌ Non hai un conto bancario.", ephemeral: true });
    }
    db.prepare("UPDATE accounts SET pin = ? WHERE userId = ?").run(pin, interaction.user.id);
    return interaction.reply({ content: "✅ PIN impostato con successo!", ephemeral: true });
  }

  if (action === "pagamento_modal") {
    const recipientId = interaction.fields.getTextInputValue("recipient_id").trim();
    const amountStr = interaction.fields.getTextInputValue("amount").trim();
    const causale = interaction.fields.getTextInputValue("causale").trim() || "Nessuna causale";

    const amount = parseInt(amountStr);
    if (isNaN(amount) || amount <= 0) {
      return interaction.reply({ content: "❌ Importo non valido.", ephemeral: true });
    }

    const senderAccount = db.prepare("SELECT * FROM accounts WHERE userId = ?").get(interaction.user.id) as Account | undefined;
    if (!senderAccount) {
      return interaction.reply({ content: "❌ Non hai un conto bancario. Usa `/apriconto`.", ephemeral: true });
    }
    if (senderAccount.balance < amount) {
      return interaction.reply({ content: `❌ Saldo insufficiente. Hai **€${senderAccount.balance}**.`, ephemeral: true });
    }

    const recipientAccount = db.prepare("SELECT * FROM accounts WHERE userId = ?").get(recipientId) as Account | undefined;
    if (!recipientAccount) {
      return interaction.reply({ content: "❌ Il destinatario non ha un conto bancario.", ephemeral: true });
    }
    if (recipientId === interaction.user.id) {
      return interaction.reply({ content: "❌ Non puoi inviare denaro a te stesso.", ephemeral: true });
    }

    db.prepare("UPDATE accounts SET balance = balance - ? WHERE userId = ?").run(amount, interaction.user.id);
    db.prepare("UPDATE accounts SET balance = balance + ? WHERE userId = ?").run(amount, recipientId);

    const embed = new EmbedBuilder()
      .setTitle("💸 Pagamento Inviato")
      .setColor(0x57F287)
      .addFields(
        { name: "Mittente", value: `<@${interaction.user.id}>`, inline: true },
        { name: "Destinatario", value: `<@${recipientId}>`, inline: true },
        { name: "Importo", value: `€${amount}`, inline: true },
        { name: "Causale", value: causale, inline: false },
        { name: "Nuovo Saldo", value: `€${senderAccount.balance - amount}`, inline: true },
      )
      .setTimestamp();

    try {
      const recipient = await interaction.client.users.fetch(recipientId);
      await recipient.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("💰 Pagamento Ricevuto!")
            .setColor(0x57F287)
            .addFields(
              { name: "Da", value: `<@${interaction.user.id}> (${interaction.user.username})`, inline: false },
              { name: "Importo", value: `€${amount}`, inline: true },
              { name: "Causale", value: causale, inline: true },
            )
            .setTimestamp(),
        ],
      }).catch(() => null);
    } catch { /* ignore */ }

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
}
