import type { NestExpressApplication } from '@nestjs/platform-express';
import request, { type Response } from 'supertest';
import { loginOf, testIp } from './identity';

export interface MobileLoggedIn {
  accessToken: string;
  refreshToken: string;
  ip: string;
  response: Response;
}

/** Signs in through the native-client route (ADR-0061 #4): the refresh token comes in the body. */
export async function mobileLogin(
  app: NestExpressApplication,
  user: { username: string; phone?: string | null; password: string },
  ip = testIp(),
): Promise<MobileLoggedIn> {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/mobile/login')
    .set('X-Forwarded-For', ip)
    .send({ login: loginOf(user), password: user.password })
    .expect(200);
  const body = response.body as { accessToken: string; refreshToken: string };
  return { accessToken: body.accessToken, refreshToken: body.refreshToken, ip, response };
}
