import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizePhoneDigits } from '../common/phone';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(private config: ConfigService) {}

  private toWhatsAppRecipient(toPhone: string) {
    const cleaned = normalizePhoneDigits(toPhone);
    if (!cleaned || cleaned.length < 10) {
      throw new BadRequestException(
        `Phone number is not valid for WhatsApp: "${toPhone}". Use international form, e.g. UK 447588830800 or +44 7588 830800.`,
      );
    }
    return cleaned;
  }

  async sendText(toPhone: string, message: string) {
    const token = this.config.get<string>('WHATSAPP_TOKEN');
    const phoneNumberId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const version = this.config.get<string>('WHATSAPP_API_VERSION') || 'v21.0';
    const cleaned = this.toWhatsAppRecipient(toPhone);

    if (!token || !phoneNumberId) {
      this.logger.warn(`WhatsApp stub: to=${cleaned} msg=${message.slice(0, 80)}...`);
      return { stub: true, id: `stub-${Date.now()}`, to: cleaned, message };
    }

    const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleaned,
        type: 'text',
        text: { body: message },
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      this.logger.error(`WhatsApp error: ${JSON.stringify(data)}`);
      const metaMsg = data?.error?.message || 'WhatsApp send failed';
      throw new BadRequestException(
        `${metaMsg} (sent to ${cleaned}). For UK use 447… or +44…, not a local 07… without country code.`,
      );
    }
    return { stub: false, id: data.messages?.[0]?.id, raw: data, to: cleaned };
  }

  async sendDocument(toPhone: string, caption: string, documentUrl: string, filename: string) {
    const token = this.config.get<string>('WHATSAPP_TOKEN');
    const phoneNumberId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const version = this.config.get<string>('WHATSAPP_API_VERSION') || 'v21.0';
    const cleaned = this.toWhatsAppRecipient(toPhone);

    if (!token || !phoneNumberId) {
      this.logger.warn(`WhatsApp document stub: to=${cleaned} file=${filename}`);
      return { stub: true, id: `stub-doc-${Date.now()}`, to: cleaned };
    }

    const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleaned,
        type: 'document',
        document: { link: documentUrl, caption, filename },
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new BadRequestException(data?.error?.message || 'WhatsApp document send failed');
    }
    return { stub: false, id: data.messages?.[0]?.id, raw: data, to: cleaned };
  }
}
