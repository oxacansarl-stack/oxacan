import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Client } from './entities/client.entity';
import { ClientContact } from './entities/client-contact.entity';
import { ClientInteraction } from './entities/client-interaction.entity';
import { CrmService } from './crm.service';
import { CrmController } from './crm.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Client, ClientContact, ClientInteraction])],
  providers: [CrmService],
  controllers: [CrmController],
  exports: [CrmService],
})
export class CrmModule {}
