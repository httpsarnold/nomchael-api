import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(private config: ConfigService) {}

  async sendText(toPhone: string, message: string) {
    const token = this.config.get<string>('WHATSAPP_TOKEN');
    const phoneNumberId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const version = this.config.get<string>('WHATSAPP_API_VERSION') || 'v21.0';
    const cleaned = toPhone.replace(/[^\d+]/g, '');

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
        to: cleaned.replace(/^\+/, ''),
        type: 'text',
        text: { body: message },
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      this.logger.error(`WhatsApp error: ${JSON.stringify(data)}`);
      throw new Error(data?.error?.message || 'WhatsApp send failed');
    }
    return { stub: false, id: data.messages?.[0]?.id, raw: data };
  }

  async sendDocument(toPhone: string, caption: string, documentUrl: string, filename: string) {
    const token = this.config.get<string>('WHATSAPP_TOKEN');
    const phoneNumberId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const version = this.config.get<string>('WHATSAPP_API_VERSION') || 'v21.0';
    const cleaned = toPhone.replace(/[^\d+]/g, '');

    if (!token || !phoneNumberId) {
      this.logger.warn(`WhatsApp document stub: to=${cleaned} file=${filename}`);
      return { stub: true, id: `stub-doc-${Date.now()}` };
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
        to: cleaned.replace(/^\+/, ''),
        type: 'document',
        document: { link: documentUrl, caption, filename },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'WhatsApp document send failed');
    return { stub: false, id: data.messages?.[0]?.id, raw: data };
  }
}
