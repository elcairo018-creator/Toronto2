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

// ─── Canali bando per lavori speciali ─────────────────────────────────────────
const BANDO_CHANNELS: Record<string, string> = {
  polizia:  "1521494201513283744",
  medici:   "1521494211231482037",
  pompieri: "1521494206332272660",
};

// ─── handleButton ─────────────────────────────────────────────────────────────
export async function handleButton(interaction: ButtonInteraction) {
  const [action, ...args] = interaction.customId.split(":");

  // ── Apri conto ────────────────────────────────────────────────────────────
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

  // ── Crea PIN (modal) ───────────────────────────────────────────────────────
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

  // ── Crea Carta (diretta) ───────────────────────────────────────────────────
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

  // ── Apri tendina candidatura lavori ────────────────────────────────────────
  if (action === "candidatura_open") {
    const jobs = db.prepare("SELECT * FROM jobs ORDER BY name ASC").all() as Job[];

    if (jobs.length === 0) {
      return interaction.reply({ content: "❌ Non ci sono lavori disponibili al momento.", ephemeral: true });
    }

    // Mostra SOLO i nomi dei lavori nella tendina, nient'altro
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

  // ── Accetta candidatura (DM al proprietario) ───────────────────────────────
  if (action === "job_accept") {
    // Solo il proprietario del server può accettare
    const guild = interaction.guild ?? await interaction.client.guilds.fetch(interaction.guildId!).catch(() => null);
    if (!guild || interaction.user.id !== guild.ownerId) {
      return interaction.reply({ content: "❌ Solo il proprietario può accettare candidature.", ephemeral: true });
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

    // Accettazione atomica — incrementa slot solo se l'insert ha successo
    const accepted = db.transaction(() => {
      // Controlla posti disponibili dentro la transazione
      const freshJob = db.prepare("SELECT * FROM jobs WHERE id = ?").get(app.jobId) as Job;
      if (freshJob.maxSlots !== null && freshJob.currentSlots >= freshJob.maxSlots) {
        return false;
      }
      const ins = db.prepare("INSERT OR IGNORE INTO employees (userId, jobId) VALUES (?, ?)").run(app.userId, app.jobId);
      if (ins.changes === 0) return false; // già dipendente
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

    // Assegna ruolo nel server
    try {
      const guild = await interaction.client.guilds.fetch(app.guildId);
      const member = await guild.members.fetch(app.userId).catch(() => null);
      if (member) {
        await member.roles.add(job.roleId).catch(() => null);
        // DM all'utente
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

    // Aggiorna il messaggio nel DM del proprietario
    await interaction.update({
      content: `✅ Candidatura di <@${app.userId}> per **${job.name}** **accettata**.`,
      components: [],
      embeds: [],
    });
    return;
  }

  // ── Rifiuta candidatura ────────────────────────────────────────────────────
  if (action === "job_reject") {
    // Solo il proprietario del server può rifiutare
    const guild = interaction.guild ?? await interaction.client.guilds.fetch(interaction.guildId!).catch(() => null);
    if (!guild || interaction.user.id !== guild.ownerId) {
      return interaction.reply({ content: "❌ Solo il proprietario può rifiutare candidature.", ephemeral: true });
    }

    const appId = args[0];
    const app = db.prepare("SELECT * FROM applications WHERE id = ?").get(appId) as Application | undefined;
    if (!app || app.status !== "pending") {
      return interaction.reply({ content: "❌ Candidatura non trovata o già gestita.", ephemeral: true });
    }

    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(app.jobId) as Job | undefined;
    db.prepare("UPDATE applications SET status = 'rejected' WHERE id = ?").run(appId);

    // DM all'utente
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

  // ── Crea prodotto (solo dipendenti/proprietari di un negozio) ──────────────
  if (action === "creaprodotto_open") {
    const ownedShop = db.prepare("SELECT id FROM shops WHERE ownerId = ?").get(interaction.user.id);
    if (!ownedShop) {
      return interaction.reply({ content: "❌ Solo i dipendenti (proprietari di un negozio) possono creare prodotti.", ephemeral: true });
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

  // ── Apri tendina negozi ────────────────────────────────────────────────────
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

  // ── Richiedi apertura negozio (apre modal) ─────────────────────────────────
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

  // ── Approva / Rifiuta richiesta apertura negozio (solo staff) ──────────────
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
      // Transazione atomica: ri-verifica lo stato "pending" e l'unicità del nome,
      // poi crea il negozio e chiude la richiesta in un unico blocco.
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

  // ── Pannello licenziamento: apre tendina dipendenti (solo staff) ───────────
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

  // ── Acquista auto ──────────────────────────────────────────────────────────
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

  // ── Acquista casa ──────────────────────────────────────────────────────────
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

  // ── Crea prodotto: negozio scelto, apri modal (gestito in handleSelectMenu) ─
  // ── Acquista prodotto → apre modal PIN + username Roblox ──────────────────
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

  // ── Apri modal pagamento ───────────────────────────────────────────────────
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

// ─── handleSelectMenu ─────────────────────────────────────────────────────────
export async function handleSelectMenu(interaction: StringSelectMenuInteraction) {
  const [action] = interaction.customId.split(":");
  const values = interaction.values;

  // ── Candidatura lavoro ─────────────────────────────────────────────────────
  if (action === "candidatura_select") {
    const jobId = parseInt(values[0]);
    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as Job | undefined;
    if (!job) {
      return interaction.reply({ content: "❌ Lavoro non trovato.", ephemeral: true });
    }

    const guild = interaction.guild!;
    const userId = interaction.user.id;

    // Controlla se l'utente ha già questo lavoro
    const alreadyEmp = db.prepare("SELECT userId FROM employees WHERE userId = ? AND jobId = ?").get(userId, jobId);
    if (alreadyEmp) {
      return interaction.reply({ content: `❌ Sei già assunto come **${job.name}**.`, ephemeral: true });
    }

    // Controlla candidatura attiva (pending o bando già inviato)
    const pendingApp = db.prepare(
      "SELECT id FROM applications WHERE userId = ? AND jobId = ? AND status IN ('pending', 'bando')"
    ).get(userId, jobId);
    if (pendingApp) {
      return interaction.reply({ content: "❌ Hai già una candidatura in attesa per questo lavoro.", ephemeral: true });
    }

    const jobKey = job.name.toLowerCase().trim();
    const bandoChannelId = BANDO_CHANNELS[jobKey];

    if (bandoChannelId) {
      // ── Lavori speciali: manda nel canale bando ─────────────────────────────
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

      // Salva candidatura nel DB come "bando" (gestita esternamente)
      db.prepare("INSERT INTO applications (userId, jobId, guildId, status) VALUES (?, ?, ?, 'bando')").run(userId, jobId, guild.id);

      return interaction.reply({
        content: `✅ La tua candidatura per **${job.name}** è stata inviata nel canale bando!`,
        ephemeral: true,
      });
    } else {
      // ── Lavori normali: DM al proprietario ────────────────────────────────
      if (job.maxSlots !== null && job.currentSlots >= job.maxSlots) {
        return interaction.reply({ content: `❌ Non ci sono posti disponibili per **${job.name}**.`, ephemeral: true });
      }

      const appResult = db.prepare(
        "INSERT INTO applications (userId, jobId, guildId) VALUES (?, ?, ?)"
      ).run(userId, jobId, guild.id);

      const appId = appResult.lastInsertRowid;

      try {
        const owner = await guild.fetchOwner();

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

        await owner.send({ embeds: [embed], components: [row] });
      } catch {
        // Il proprietario ha i DM chiusi
        db.prepare("DELETE FROM applications WHERE id = ?").run(appId);
        return interaction.reply({ content: "❌ Impossibile contattare il proprietario. Contattalo direttamente.", ephemeral: true });
      }

      return interaction.reply({
        content: `✅ La tua candidatura per **${job.name}** è stata inviata! Attendi la risposta del proprietario.`,
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
      .setTitle(`Nuovo Prodotto — $ **…**

_This response is too long to display in full._
