import { FastifyInstance } from 'fastify';

import { getProjectFromRequest } from '~/api/helpers';
import { database } from '~/database';
import { Subscription } from '~/entities';
import { Invoice } from '~/entities/invoice';
import { getActiveUntilDate, getPeriodFromAnchorDate } from '~/utils';

export function subscriptionEndpoints(server: FastifyInstance): void {
  server.post('/subscription', {
    schema: {
      summary: 'Create a subscription',
      tags: ['subscription'],
      body: {
        type: 'object',
        required: ['pricePerUnit', 'units', 'redirectUrl', 'customerId'],
        additionalProperties: false,
        properties: {
          pricePerUnit: { type: 'number' },
          units: { type: 'number' },
          customerId: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            subscriptionId: { type: 'string' },
          },
        },
        400: {
          $ref: 'ErrorResponse',
        },
        404: {
          $ref: 'ErrorResponse',
        },
        500: {
          $ref: 'ErrorResponse',
        },
      },
    },
    handler: async (request, reply) => {
      const project = await getProjectFromRequest(request);

      const body = request.body as {
        pricePerUnit: number;
        units: number;
        redirectUrl: string;
        customerId: string;
      };

      if (body.units < 1) {
        return reply.code(400).send({
          error: 'Units must be greater than 0',
        });
      }

      if (body.pricePerUnit < 0) {
        return reply.code(400).send({
          error: 'Price per unit must be greater than 0',
        });
      }

      const customer = await database.customers.findOne(
        { _id: body.customerId, project },
        { populate: ['subscriptions', 'activePaymentMethod'] },
      );
      if (!customer) {
        return reply.code(404).send({
          error: 'Customer not found',
        });
      }

      if (!customer.activePaymentMethod) {
        return reply.code(400).send({
          error: 'Customer has no active payment method',
        });
      }

      const now = new Date();

      const subscription = new Subscription({
        anchorDate: now,
        customer,
        project,
      });

      subscription.changePlan({ units: body.units, pricePerUnit: body.pricePerUnit });

      const period = getPeriodFromAnchorDate(now, subscription.anchorDate);
      const newInvoice = new Invoice({
        date: period.end,
        sequentialId: customer.invoiceCounter,
        status: 'draft',
        subscription,
        currency: 'EUR', // TODO: allow to configure currency
        vatRate: 19.0, // TODO: german vat rate => allow to configure
        project,
      });

      await database.em.persistAndFlush([customer, subscription, newInvoice]);

      await reply.send({
        subscriptionId: subscription._id,
      });
    },
  });

  server.patch('/subscription/:subscriptionId', {
    schema: {
      summary: 'Patch a subscription',
      tags: ['subscription'],
      params: {
        type: 'object',
        required: ['subscriptionId'],
        additionalProperties: false,
        properties: {
          subscriptionId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['pricePerUnit', 'units'],
        additionalProperties: false,
        properties: {
          pricePerUnit: { type: 'number' },
          units: { type: 'number' },
        },
      },
      response: {
        200: {
          $ref: 'SuccessResponse',
        },
        400: {
          $ref: 'ErrorResponse',
        },
        404: {
          $ref: 'ErrorResponse',
        },
      },
    },
    handler: async (request, reply) => {
      const project = await getProjectFromRequest(request);

      const body = request.body as { pricePerUnit: number; units: number };

      if (body.units < 1) {
        return reply.code(400).send({
          error: 'Units must be greater than 0',
        });
      }

      if (body.pricePerUnit < 0) {
        return reply.code(400).send({
          error: 'Price per unit must be greater than 0',
        });
      }

      const { subscriptionId } = request.params as { subscriptionId: string };

      const subscription = await database.subscriptions.findOne(
        { _id: subscriptionId, project },
        { populate: ['customer', 'changes'] },
      );
      if (!subscription) {
        return reply.code(404).send({ error: 'Subscription not found' });
      }

      subscription.changePlan({ pricePerUnit: body.pricePerUnit, units: body.units, changeDate: new Date() });
      await database.em.persistAndFlush(subscription);

      await reply.send({ ok: true });
    },
  });

  server.get('/subscription/:subscriptionId', {
    schema: {
      summary: 'Get a subscription',
      tags: ['subscription'],
      params: {
        type: 'object',
        required: ['subscriptionId'],
        additionalProperties: false,
        properties: {
          subscriptionId: { type: 'string' },
        },
      },
      response: {
        200: {
          $ref: 'Subscription',
        },
        404: {
          $ref: 'ErrorResponse',
        },
      },
    },
    handler: async (request, reply) => {
      const project = await getProjectFromRequest(request);

      const { subscriptionId } = request.params as { subscriptionId: string };

      const subscription = await database.subscriptions.findOne(
        { _id: subscriptionId, project },
        { populate: ['customer', 'changes'] },
      );
      if (!subscription) {
        return reply.code(404).send({ error: 'Subscription not found' });
      }

      const activeUntil = subscription.lastPayment
        ? getActiveUntilDate(subscription.lastPayment, subscription.anchorDate)
        : undefined;

      const _subscription = {
        ...subscription.toJSON(),
        activeUntil,
      };

      await reply.send(_subscription);
    },
  });

  server.get('/subscription/:subscriptionId/invoice', {
    schema: {
      summary: 'List all invoices of a subscription',
      tags: ['subscription', 'invoice'],
      params: {
        type: 'object',
        required: ['subscriptionId'],
        additionalProperties: false,
        properties: {
          subscriptionId: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'array',
          items: {
            $ref: 'Invoice',
          },
        },
        404: {
          $ref: 'ErrorResponse',
        },
      },
    },
    handler: async (request, reply) => {
      const project = await getProjectFromRequest(request);

      const { subscriptionId } = request.params as { subscriptionId: string };

      const subscription = await database.subscriptions.findOne({ _id: subscriptionId, project });
      if (!subscription) {
        return reply.code(404).send({ error: 'Subscription not found' });
      }

      const invoices = await database.invoices.find({ subscription, project }, { populate: ['items'] });

      await reply.send(invoices.map((invoice) => invoice.toJSON()));
    },
  });
}
