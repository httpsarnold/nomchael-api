import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') || 'change-me-in-production',
    });
  }

  // Trust signed JWT claims — avoid a DB round-trip on every API request
  async validate(payload: { sub: string; email: string; role: UserRole }) {
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };
  }
}
