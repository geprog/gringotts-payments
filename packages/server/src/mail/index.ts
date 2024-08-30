import fs from 'fs';
import nodemailer from 'nodemailer';
import path from 'path';

import { config } from '~/config';
import { Customer, Invoice } from '~/entities';
import { log } from '~/log';

import { getTemplate } from './templates';

let transporter: nodemailer.Transporter;

export function init(): void {
  const mailConfig = config.mail;

  if (!mailConfig.host || !mailConfig.port || !mailConfig.username || !mailConfig.password) {
    log.info('No mail config found, skipping mail initialization');
    return;
  }

  transporter = nodemailer.createTransport({
    host: mailConfig.host,
    port: mailConfig.port,
    secure: mailConfig.secure,
    requireTLS: mailConfig.requireTLS,
    auth: {
      user: mailConfig.username,
      pass: mailConfig.password,
    },
  });
}

export async function sendInvoiceMail(invoice: Invoice, customer: Customer): Promise<void> {
  if (!transporter) {
    return;
  }

  if (invoice.totalAmount === 0) {
    log.debug('Skipping sending mail for 0 amount invoice', { invoiceId: invoice._id });
    return;
  }

  const template = getTemplate(customer, 'newInvoice');

  const subject = template.subject({
    invoice: invoice.toJSON(),
    project: invoice.project,
  });

  const text = template.text({
    invoice: invoice.toJSON(),
    customer: invoice.customer,
  });

  try {
    const invoicePath = path.join(config.dataPath, 'invoices', invoice.getInvoicePath());
    if (!fs.existsSync(invoicePath)) {
      await invoice.generateInvoicePdf();
    }

    await transporter.sendMail({
      from: config.mail.from,
      to: customer.email,
      subject,
      text,
      attachments: [
        {
          filename: 'invoice.pdf',
          contentType: 'application/pdf',
          path: invoicePath,
        },
      ],
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Problem sending invoice mail', error);
  }
}
