import { RETRY_ATTEMPTS, RETRY_BASE_DELAY } from '../config.js';
import { sleep } from './sleep.js';
import { log } from './logger.js';

export async function retry<T>(
  fn: () => Promise<T>,
  label: string,
  attempts: number = RETRY_ATTEMPTS,
  baseDelay: number = RETRY_BASE_DELAY,
): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === attempts - 1) {
        log.error(`${label} failed after ${attempts} attempts`, err);
        throw err;
      }
      const delay = baseDelay * Math.pow(2, i);
      log.warn(`${label} attempt ${i + 1} failed, retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw new Error('unreachable');
}
