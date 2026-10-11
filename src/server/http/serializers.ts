import type { MessageTemplate, Professional, Service, TimeBlock, WorkingHours } from "@/generated/prisma/client";
import type { ManageState } from "@/server/agenda/public-booking";
import type { ConnectionView } from "@/server/messaging/connection";
import type { OutboundMessageType } from "@/server/outbound/message-types";
import {
  DEFAULT_TEMPLATES,
  MAX_VARIATION_LENGTH,
  MAX_VARIATIONS,
  MIN_VARIATIONS,
  TEMPLATE_VARIABLES,
} from "@/server/outbound/templates";
import type { SendUsage } from "@/server/outbound/usage";
import type { PublicSite } from "@/server/repositories/public-repository";
import type {
  AppointmentDetails,
  BlockedMessage,
  ConversationDetails,
  ConversationSummary,
  MessageView,
  Page,
} from "@/server/repositories/tenant-repository";

// Corpo das respostas da API: sem tenant_id (vem sempre da sessão) e horários no mesmo
// formato "HH:MM" da entrada.

export function professionalDto(professional: Professional) {
  return {
    id: professional.id,
    name: professional.name,
    archivedAt: professional.archivedAt,
    createdAt: professional.createdAt,
    updatedAt: professional.updatedAt,
  };
}

export function serviceDto(service: Service) {
  return {
    id: service.id,
    name: service.name,
    durationMinutes: service.durationMinutes,
    priceCents: service.priceCents,
    archivedAt: service.archivedAt,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
  };
}

export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function workingHoursDto(interval: WorkingHours) {
  return {
    id: interval.id,
    professionalId: interval.professionalId,
    weekday: interval.weekday,
    start: minutesToTime(interval.startMinute),
    end: minutesToTime(interval.endMinute),
  };
}

// Agendamento sem o hash do token de gestão: o painel nunca precisa dele.
export function appointmentDto(appointment: AppointmentDetails) {
  return {
    id: appointment.id,
    status: appointment.status,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    canceledAt: appointment.canceledAt,
    professional: appointment.professional,
    service: appointment.service,
    contact: appointment.contact,
    createdAt: appointment.createdAt,
    updatedAt: appointment.updatedAt,
  };
}

export function timeBlockDto(block: TimeBlock) {
  return {
    id: block.id,
    professionalId: block.professionalId,
    startsAt: block.startsAt,
    endsAt: block.endsAt,
    reason: block.reason,
    createdAt: block.createdAt,
  };
}

// Site público (D1, D2): só campos públicos do negócio, sem tenant_id. Dos parâmetros da agenda,
// só o que a tela de agendar mostra ao cliente.
export function publicSiteDto(site: PublicSite) {
  const { business } = site;
  return {
    business: {
      slug: business.slug,
      name: business.name,
      description: business.description,
      address: business.address,
      phone: business.phone,
      timezone: business.timezone,
      booking: {
        minAdvanceMinutes: business.minAdvanceMinutes,
        maxWindowDays: business.maxWindowDays,
        cancelDeadlineMinutes: business.cancelDeadlineMinutes,
      },
    },
    services: site.services,
    professionals: site.professionals,
  };
}

// Agendamento visto pelo link de gestão (D6): sem id, sem hash e, do contato, só o nome.
export function publicAppointmentDto(appointment: AppointmentDetails, state: ManageState) {
  return {
    status: appointment.status,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    canceledAt: appointment.canceledAt,
    service: appointment.service,
    professional: appointment.professional,
    contact: { name: appointment.contact.name },
    manageableUntil: state.manageableUntil,
    canManage: state.canManage,
  };
}

// Respostas com o QR (e as do painel do WhatsApp em geral) nunca vão para cache.
export const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" } as const;

// Conexão do WhatsApp (guia 3, 7a, 7b): sem o id da sessão no provedor, que é a chave do webhook
// (D8) e nunca vai para o navegador. O QR só aparece enquanto espera a leitura.
export function whatsappConnectionDto(connection: ConnectionView | null) {
  if (!connection) return { status: "not_configured" as const, lastCheckedAt: null, qr: null, live: true };
  return {
    status: connection.status,
    lastCheckedAt: connection.lastCheckedAt,
    qr: connection.qr ? { format: connection.qr.format, value: connection.qr.value, expiresAt: connection.qr.expiresAt } : null,
    live: connection.live,
  };
}

// Conversas e mensagens (D6, D7): somente leitura, mídia só como tipo, sem id externo do provedor.
export function messageDto(message: MessageView) {
  return {
    id: message.id,
    direction: message.direction,
    body: message.body,
    mediaType: message.mediaType,
    status: message.status,
    sentAt: message.sentAt,
  };
}

export function conversationSummaryDto(conversation: ConversationSummary) {
  return {
    id: conversation.id,
    lastMessageAt: conversation.lastMessageAt,
    contact: conversation.contact,
    lastMessage: conversation.lastMessage
      ? {
          direction: conversation.lastMessage.direction,
          body: conversation.lastMessage.body,
          mediaType: conversation.lastMessage.mediaType,
          sentAt: conversation.lastMessage.sentAt,
        }
      : null,
  };
}

export function conversationDto(conversation: ConversationDetails) {
  return {
    id: conversation.id,
    lastMessageAt: conversation.lastMessageAt,
    createdAt: conversation.createdAt,
    contact: conversation.contact,
  };
}

export function pageDto<T, R>(page: Page<T>, map: (item: T) => R) {
  return { items: page.items.map(map), page: page.page, pageSize: page.pageSize, hasMore: page.hasMore };
}

// Uso do dia e aquecimento (D6): só números e datas, sem contador de outro tenant.
export function sendUsageDto(usage: SendUsage) {
  return {
    configured: usage.configured,
    day: usage.day,
    timezone: usage.timezone,
    used: usage.used,
    limit: usage.limit,
    manualLimit: usage.manualLimit,
    warmup: { ...usage.warmup },
  };
}

// Envio bloqueado (D6, D8): motivo em código (a tela traduz), sem chave de idempotência nem id externo.
export function blockedMessageDto(message: BlockedMessage) {
  return {
    id: message.id,
    messageType: message.messageType,
    channel: message.channel,
    reason: message.blockReason,
    scheduledFor: message.scheduledFor,
    createdAt: message.createdAt,
    blockedAt: message.blockedAt,
    contact: message.contact,
  };
}

// Template (D5, D16): o tipo é da lista fechada e não muda; junto vão as variáveis aceitas e os
// limites, para a tela validar antes de enviar, e se ainda é o texto padrão.
export function messageTemplateDto(template: MessageTemplate) {
  const type = template.messageType as OutboundMessageType;
  const defaults = DEFAULT_TEMPLATES[type];
  return {
    id: template.id,
    messageType: type,
    variations: template.variations,
    active: template.active,
    variables: [...TEMPLATE_VARIABLES[type]],
    isDefault:
      template.variations.length === defaults.length && template.variations.every((text, i) => text === defaults[i]),
    limits: { minVariations: MIN_VARIATIONS, maxVariations: MAX_VARIATIONS, maxLength: MAX_VARIATION_LENGTH },
    updatedAt: template.updatedAt,
  };
}
