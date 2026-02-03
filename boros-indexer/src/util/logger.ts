function timestamp(): string {
  return new Date().toISOString();
}

export const log = {
  info(msg: string): void {
    console.log(`[${timestamp()}] INFO  ${msg}`);
  },
  warn(msg: string): void {
    console.warn(`[${timestamp()}] WARN  ${msg}`);
  },
  error(msg: string, err?: unknown): void {
    console.error(`[${timestamp()}] ERROR ${msg}`, err ?? '');
  },
};
