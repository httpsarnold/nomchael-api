import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ClientsModule } from './clients/clients.module';
import { StageTemplatesModule } from './stage-templates/stage-templates.module';
import { ProjectsModule } from './projects/projects.module';
import { QuotationsModule } from './quotations/quotations.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { ExpensesModule } from './expenses/expenses.module';
import { PaymentsModule } from './payments/payments.module';
import { ShortfallsModule } from './shortfalls/shortfalls.module';
import { StockModule } from './stock/stock.module';
import { EmployeesModule } from './employees/employees.module';
import { ReportsModule } from './reports/reports.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { PrintingModule } from './printing/printing.module';
import { InvoicesModule } from './invoices/invoices.module';
import { StandPackagesModule } from './stand-packages/stand-packages.module';
import { CatalogModule } from './catalog/catalog.module';
import { SiteVisitsModule } from './site-visits/site-visits.module';
import { RolesGuard } from './common/roles.decorator';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'] }),
    PrismaModule,
    AuthModule,
    UsersModule,
    ClientsModule,
    StageTemplatesModule,
    ProjectsModule,
    StandPackagesModule,
    SiteVisitsModule,
    QuotationsModule,
    CatalogModule,
    SuppliersModule,
    ExpensesModule,
    PaymentsModule,
    ShortfallsModule,
    StockModule,
    EmployeesModule,
    ReportsModule,
    DashboardModule,
    WhatsappModule,
    PrintingModule,
    InvoicesModule,
  ],
  providers: [RolesGuard],
})
export class AppModule {}
