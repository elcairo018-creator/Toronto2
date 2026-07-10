import { GuildMember, type ChatInputCommandInteraction, type BaseMessageOptions } from "discord.js";

export const STAFF_ROLE_ID          = "1521493339562704898";
export const CONCESSIONARIO_ROLE_ID = "1524387712512299150";
export const LAVORI_CHANNEL_ID      = "1521494153127788576";
export const POSTINO_ROLE_ID        = "1523060050451632309";

/**
 * Pubblica un pannello nel canale come messaggio "normale" del bot, invece di
 * rispondere direttamente all'interazione. Questo evita che Discord mostri
 * l'etichetta "Username ha usato /comando" sopra il pannello.
 */
export async function sendPanel(interaction: ChatInputCommandInteraction, payload: BaseMessageOptions) {
  await interaction.deferReply({ ephemeral: true });
  const channel = interaction.channel;
  if (channel && "send" in channel && typeof (channel as any).send === "function") {
    await (channel as any).send(payload);
  }
  await interaction.deleteReply().catch(() => null);
}

/** Verifica se un membro (da qualsiasi tipo di interazione) è proprietario o staff. */
export function memberIsStaff(member: unknown, userId: string, guildOwnerId?: string | null): boolean {
  if (guildOwnerId && userId === guildOwnerId) return true;
  if (member instanceof GuildMember) return member.roles.cache.has(STAFF_ROLE_ID);
  const m = member as { roles?: string[] } | null;
  return Array.isArray(m?.roles) && m.roles.includes(STAFF_ROLE_ID);
}

/** Proprietario del server OPPURE membro con ruolo Staff. */
export function isAdmin(interaction: ChatInputCommandInteraction): boolean {
  if (interaction.user.id === interaction.guild?.ownerId) return true;
  const m = interaction.member;
  if (m instanceof GuildMember) return m.roles.cache.has(STAFF_ROLE_ID);
  // APIInteractionGuildMember (roles è string[])
  return Array.isArray(m?.roles) && (m.roles as string[]).includes(STAFF_ROLE_ID);
}

/** isAdmin + ruolo Concessionario (per gestione auto). */
export function canManageCars(interaction: ChatInputCommandInteraction): boolean {
  if (isAdmin(interaction)) return true;
  const m = interaction.member;
  if (m instanceof GuildMember) return m.roles.cache.has(CONCESSIONARIO_ROLE_ID);
  return Array.isArray(m?.roles) && (m.roles as string[]).includes(CONCESSIONARIO_ROLE_ID);
}
