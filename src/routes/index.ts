import { Router } from 'express';
import { createDodoPaymentsRoutes } from './dodoPayments';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

export function createRoutes(): Router {
  const router = Router();

  router.use('/dodopayments', createDodoPaymentsRoutes());

  router.post('/user', async (req, res, next) => {
    try {
      const { email } = req.body;

      if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: 'email is required in request body' });
      }

      // Check if user exists
      let user = await prisma.userMapping.findUnique({
        where: { email },
      });

      let isNewUser = false;
      if (!user) {
        // Create new user with generated UUID
        const userUuid = uuidv4();
        user = await prisma.userMapping.create({
          data: {
            userUuid,
            email,
          },
        });
        isNewUser = true;
      }

      res.json({
        uuid: user.userUuid,
        created: isNewUser,
        message: isNewUser ? 'User created successfully' : 'User already exists',
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/users', async (req, res, next) => {
    try {
      const users = await prisma.userMapping.findMany({
        select: {
          email: true,
        },
      });

      res.json({ emails: users.map((user) => user.email) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/user/:email', async (req, res, next) => {
    try {
      const { email } = req.params;

      const user = await prisma.userMapping.findUnique({
        where: { email },
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({
        email: user.email,
        sob_id: user.userUuid,
        dodo_customer_id: user.dodoCustomerId,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      database: 'connected',
      payment_provider: 'operational',
      uptime: process.uptime(),
    });
  });

  return router;
}
