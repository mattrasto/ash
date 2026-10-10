import { PrismaClient } from '@prisma/client';
export function connectProduct(databaseUrl: string) {
  const url = new URL(databaseUrl);
  url.searchParams.set('connection_limit', '6');
  return new PrismaClient({datasources:{db:{url:url.toString()}}});
}
