import type { RabbitMQClient } from '@linagora/rabbitmq-client';
import pino from 'pino';

export const silentLogger = pino({ level: 'silent' });

export const broker = (
  publish: (...args: Parameters<RabbitMQClient['publish']>) => Promise<void>,
): Pick<RabbitMQClient, 'publish' | 'isConnected'> => ({ publish, isConnected: () => true });
