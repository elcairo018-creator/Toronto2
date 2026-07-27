import {
  GuildMember,
  EmbedBuilder,
  type Client,
  type ChatInputCommandInteraction,
  type BaseMessageOptions,
  type Message,
} from "discord.js";
import db, { type Job } from "./db.js";

export const STAFF_ROLE_ID          = "1521493339562704898";
export const OWNER_ROLE_ID          = "1141049314433573044";
export const CONCESSIONARIO_ROLE_ID = "1524387712512299150";
export const LAVORI_CHANNEL_ID      = "1521494153127788576";
export const POSTINO_ROLE_ID        = "1523060050451632309";

// ── Palette & stile globale Toronto RP ───────────────────────────────────────
export const COLORS = {
  banca:   0xB5D8F7,
  lavori:  0xF5D6E7,
  success: 0x57F287,
  danger:  0xED4245,
  warning: 0xFEE75C,
  neutral: 0x9B8FA6,
} as const;

export const FOOTER = { text: "🪐 ˚ʚ♡ɞ˚ 🪐 • Toronto RP" };

// ── Pubblica un pannello nel canale (restituisce il messaggio inviato) ────────
export async function sendPanel(
  interaction: ChatInputCommandInteraction,
  payload: BaseMessageOptions,
): Promise<Message | null> {
  await interaction.deferReply({ ephemeral: true });
  const channel = interaction.channel;
  let msg: Message | null = null;
  if (channel && "send" in channel && typeof (channel as any).send === "function") {
    msg = await (channel as any).send(payload);
  }
  await interaction.deleteReply().catch(() => null);
  return msg;
}

// ── Costruisce l'embed della lista lavori (usato anche per aggiornarlo) ───────
export function buildListalavoriEmbed(): EmbedBuilder {
  const jobs = db.prepare("SELECT * FROM jobs ORDER BY name ASC").all() as Job[];
  const disponibileCount = jobs.filter(
    (j) => j.maxSlots === null || j.currentSlots < j.maxSlots,
  ).length;

  const lines =
    jobs.length > 0
      ? jobs.map((j) => {
          const disp = j.maxSlots === null || j.currentSlots < j.maxSlots;
          const dot  = disp ? "🟢" : "🔴";
          const slot = j.maxSlots !== null
            ? ` ﹒ **${j.maxSlots - j.currentSlots}** posto/i libero/i`
            : "";
          return `: ̗̀➛ ${j.name} — 💰 €${j.salary}/gg ${dot}${slot}`;
        })
      : ["*Nessun lavoro disponibile al momento.*"];

  const description = [
    `⏔⏔⏔ ꒰ 💼 ꒱ ⏔⏔⏔`,
    ``,
    `ʟᴀᴠᴏʀɪ ᴅɪsᴘᴏɴɪʙɪʟɪ ﹕ **${disponibileCount}**`,
    `ℬᴇɴᴠᴇɴᴜᴛᴏ/ᴀ﹗ 𝒬ᴜɪ ᴛʀᴏᴠᴇʀᴀɪ ᴛᴜᴛᴛɪ ɪ ʟᴀᴠᴏʀɪ ᴅɪsᴘᴏɴɪʙɪʟɪ sᴜʟ sᴇʀᴠᴇʀ.`,
    `𝒫ᴇʀ ᴄᴀɴᴅɪᴅᴀʀᴛɪ ᴀᴘʀɪ ᴜɴ ᴘᴏsᴛ ɴᴇʟ ᴄᴀɴᴀʟᴇ ᴅᴇᴅɪᴄᴀᴛᴏ.`,
    ``,
    `🎧 ु°`,
    `🟢 ﹕ ᴅɪsᴘᴏɴɪʙɪʟᴇ  ﹒  🔴 ﹕ ᴇsᴀᴜʀɪᴛᴏ`,
    `🧸 ु°`,
    ``,
    ...lines,
    ``,
    `🤍 ु°`,
    `📌 𝒫ᴇʀ ᴘᴏʟɪᴢɪᴀ, ᴏsᴘᴇᴅᴀʟᴇ ᴇ ᴠɪɢɪʟɪ ᴅᴇʟ ғᴜᴏᴄᴏ ᴇ ᴏʙʙʟɪɢᴀᴛᴏʀɪᴏ ᴄᴏᴍᴘɪʟᴀʀᴇ ɪʟ ʙᴀɴᴅᴏ.`,
    `𝒫ᴇʀ ɢʟɪ ᴀʟᴛʀɪ ʟᴀᴠᴏʀɪ ᴀᴘʀɪ ᴜɴ ᴘᴏsᴛ ɴᴇʟ ᴄᴀɴᴀʟᴇ <#${LAVORI_CHANNEL_ID}>.`,
    ``,
    `<@&1521493382273437757>`,
    ``,
    `⏔⏔⏔ ꒰ 💼 ꒱ ⏔⏔⏔`,
    ``,
    `🪐 ˚ʚ♡ɞ˚ 🪐`,
  ].join("\n");

  return new EmbedBuilder()
    .setTitle("☕ ₊˚ 𝒯οяοηтο 𝒥ο𝒷ѕ ₊˚ 🦢")
    .setDescription(description)
    .setColor(COLORS.lavori)
    .setFooter(FOOTER)
    .setTimestamp();
}

// ── Aggiorna il pannello listalavori già pubblicato ───────────────────────────
export async function updateListalavoriPanel(client: Client): Promise<void> {
  const panel = db
    .prepare("SELECT * FROM panels WHERE name = 'listalavori'")
    .get() as { channelId: string; messageId: string } | undefined;
  if (!panel) return;
  try {
    const channel = await client.channels.fetch(panel.channelId).catch(() => null);
    if (!channel || !("messages" in channel)) return;
    const msg = await (channel as any).messages.fetch(panel.messageId).catch(() => null);
    if (!msg) return;
    await msg.edit({ embeds: [buildListalavoriEmbed()] });
  } catch { /* canale o messaggio non più accessibile */ }
}

/** Verifica se un membro (da qualsiasi tipo di interazione) è proprietario o staff. */
export function memberIsStaff(
  member: unknown,
  userId: string,
  guildOwnerId?: string | null,
): boolean {
  if (guildOwnerId && userId === guildOwnerId) return true;
  if (member instanceof GuildMember) {
    return member.roles.cache.has(STAFF_ROLE_ID) || member.roles.cache.has(OWNER_ROLE_ID);
  }
  const m = member as { roles?: string[] } | null;
  return (
    Array.isArray(m?.roles) &&
    (m.roles.includes(STAFF_ROLE_ID) || m.roles.includes(OWNER_ROLE_ID))
  );
}

/** Proprietario del server OPPURE membro con ruolo Staff o Proprietario. */
export function isAdmin(interaction: ChatInputCommandInteraction): boolean {
  if (interaction.user.id === interaction.guild?.ownerId) return true;
  const m = interaction.member;
  if (m instanceof GuildMember) {
    return m.roles.cache.has(STAFF_ROLE_ID) || m.roles.cache.has(OWNER_ROLE_ID);
  }
  return (
    Array.isArray(m?.roles) &&
    ((m.roles as string[]).includes(STAFF_ROLE_ID) ||
      (m.roles as string[]).includes(OWNER_ROLE_ID))
  );
}

/** isAdmin + ruolo Concessionario (per gestione auto). */
export function canManageCars(interaction: ChatInputCommandInteraction): boolean {
  if (isAdmin(interaction)) return true;
  const m = interaction.member;
  if (m instanceof GuildMember) return m.roles.cache.has(CONCESSIONARIO_ROLE_ID);
  return (
    Array.isArray(m?.roles) &&
    (m.roles as string[]).includes(CONCESSIONARIO_ROLE_ID)
  );
}
