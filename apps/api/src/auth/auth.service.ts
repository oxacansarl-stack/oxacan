import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from './auth.types';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService) {}

  /** Création d'une entreprise (tenant) avec son premier utilisateur Dirigeant. */
  async bootstrapTenant(input: { companyName: string; email: string; password: string; fullName: string }) {
    const existing = await this.prisma.user.findFirst({ where: { email: input.email } });
    if (existing) throw new ConflictException('email already registered');
    const passwordHash = await bcrypt.hash(input.password, 10);
    const tenant = await this.prisma.tenant.create({ data: { name: input.companyName, users: { create: { email: input.email, passwordHash, fullName: input.fullName, role: 'DIRIGEANT' } } }, include: { users: true } });
    const user = tenant.users[0]!;
    return { tenantId: tenant.id, userId: user.id, token: await this.sign({ sub: user.id, tenantId: tenant.id, role: user.role, email: user.email }) };
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findFirst({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw new UnauthorizedException('invalid credentials');
    return { token: await this.sign({ sub: user.id, tenantId: user.tenantId, role: user.role, email: user.email }), role: user.role, tenantId: user.tenantId, fullName: user.fullName };
  }

  async inviteUser(tenantId: string, input: { email: string; password: string; fullName: string; role: 'DIRIGEANT' | 'CHEF_PROJET' | 'TECHNICIEN' | 'CLIENT' }) {
    const passwordHash = await bcrypt.hash(input.password, 10);
    const u = await this.prisma.user.create({ data: { tenantId, email: input.email, passwordHash, fullName: input.fullName, role: input.role } });
    return { id: u.id, email: u.email, role: u.role };
  }

  private sign(p: JwtPayload) { return this.jwt.signAsync(p); }
}
