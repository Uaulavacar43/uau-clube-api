

# 📘 README Técnico – UAU+ Backend

**Arquitetura • Regras de Negócio • Fluxos • Modelagem • Módulos NestJS • Diagramas ASCII**

---

# 1. Overview Técnico

UAU+ é um ecossistema composto por:

* Assinaturas mensais recorrentes
* Rede de indicação estruturada (3 níveis)
* Cashback interno UAU+
* Cashback AlloyAl (API)
* Cashback em parceiros locais (T/C/A)
* Uso operacional via QR Code
* Consumo de lavagens via QR
* Gestão operacional das unidades (franqueadas)
* Dashboards (usuário, unidade, franqueadora)
* Integração com gateways de pagamento
* Estrutura modular estilo Angular (módulos independentes)
* Backend NestJS + Prisma + PostgreSQL

---

# 2. Arquitetura Geral (Visão Alta)

```txt
+-------------------------------------------------------------+
|                           API UAU+                          |
|                        NestJS (Modular)                     |
+-------------------------------------------------------------+
         |               |                |                |
         v               v                v                v
   Assinaturas    Cashback Interno   Parcerias AlloyAl   QR Redemption
   Billing        Rede 3 Níveis      Parceiros Locais    Lavagens
         \               |                |                /
                  +------v----------------v--------------+
                  |           Prisma ORM                 |
                  +-----------------+---------------------+
                                    |
                           PostgreSQL Database
                                    |
                              Integrations
                                    |
                     +-------------+----------------+
                     |                             |
              Gateways de Pagamento          AlloyAl API
```

---

# 3. Estrutura de Pastas (Modelo Completo)

```txt
src/
  main.ts
  app.module.ts

  infra/
    database/
      prisma.service.ts
      prisma-exception.filter.ts
    payments/
      payment-gateway.service.ts
    cache/
      redis.service.ts
    notifications/
      notifications.service.ts

  common/
    guards/
    interceptors/
    filters/
    decorators/
    pipes/
    utils/

  modules/
    auth/
      auth.module.ts
      auth.controller.ts
      auth.service.ts
      dto/

    users/
      users.module.ts
      users.controller.ts
      users.service.ts
      dto/

    subscriptions/
      subscriptions.module.ts
      subscriptions.controller.ts
      subscriptions.service.ts
      dto/

    billing/
      billing.module.ts
      billing.controller.ts
      billing.service.ts
      dto/

    referrals/
      referrals.module.ts
      referrals.controller.ts
      referrals.service.ts
      dto/

    cashback/
      cashback.module.ts
      cashback.controller.ts
      cashback.service.ts
      dto/

    partners-local/
      partners-local.module.ts
      partners-local.controller.ts
      partners-local.service.ts
      dto/

    partners-alloyal/
      partners-alloyal.module.ts
      partners-alloyal.controller.ts
      partners-alloyal.service.ts
      dto/

    qr-redemption/
      qr-redemption.module.ts
      qr-redemption.controller.ts
      qr-redemption.service.ts
      dto/

    washes/
      washes.module.ts
      washes.controller.ts
      washes.service.ts
      dto/

    dashboards/
      dashboards.module.ts
      dashboards.controller.ts
      dashboards.service.ts

    reports/
      reports.module.ts
      reports.controller.ts
      reports.service.ts

    config-center/
      config-center.module.ts
      config-center.controller.ts
      config-center.service.ts
```

---

# 4. Regras de Negócio – Assinatura

## 4.1 Status da assinatura

* **ATIVA** – pagamentos em dia
* **SUSPENSA** – após tentativas falhas
* **CANCELADA** – cancelamento manual

## 4.2 Tentativas de cobrança

```
D+0
D+1
D+3
D+5
Se falhar → Assinatura SUSPENSA
```

## 4.3 Regras de uso do sistema

* Suspenso NÃO usa lavagens
* Suspenso NÃO recebe bônus recorrente
* Suspenso NÃO indica ganhos retroativos
* Ao voltar a pagar → volta ao fluxo normal

## 4.4 Regras de cashback na assinatura

* Cashback pode abater **máximo 50%** da mensalidade
* Nunca pode zerar a fatura
* Não é sacável
* Pode acumular
* Sem validade (configurável)

---

# 5. Rede de Indicação – 3 Níveis

## 5.1 Estrutura

```
Usuário
  |-- Nível 1 (diretos)
        |-- Nível 2
              |-- Nível 3
```

## 5.2 Bônus Único

Pago na **primeira assinatura paga** do indicado:

```
Nível 1 → R$ 10
Nível 2 → R$ 5
Nível 3 → R$ 5
```

## 5.3 Bônus Mensal Recorrente

Enquanto todos estiverem ativos:

```
Nível 1 → R$ 3
Nível 2 → R$ 2
Nível 3 → R$ 1
```

## 5.4 Regras de inadimplência

```
Se usuário suspenso:
  Não recebe bônus
Rede continua
Bônus do ciclo não é retroativo
```

---

# 6. Cashback Interno UAU+

## 6.1 Fontes

* Indicações (único + recorrente)
* Parceiros locais (T/C/A)
* AlloyAl (repasse interno)

## 6.2 Regras

* Uso máximo 50% da mensalidade
* Não-saque
* Acumulativo
* Sem validade por padrão
* Debitado sempre primeiro (saldo interno)

---

# 7. Cashback AlloyAl

## 7.1 Integração

* Webhooks de retorno
* Créditos entram na carteira do usuário
* Podem ser usados nos mesmos limites (50%)

---

# 8. Cashback em Parceiros Locais – T/C/A (Modelo Financeiro Oficial)

## 8.1 Variáveis

```
T = Taxa que o parceiro paga ao UAU
C = Cashback ao cliente (parte de T)
A = Máximo de cashback aceito na compra
```

## 8.2 Regra de Ouro

```
A ≤ T
```

## 8.3 Exemplo

Compra = R$ 100
T = 10%
C = 5%
UAU% = 5%
A = 10%

---

# 9. Uso de Cashback em Parceiros – QR Code Dinâmico

## 9.1 Estrutura do QR

```
UAU+|USER_ID|TOKEN|TIMESTAMP|HASH
```

Expira em **60 segundos**.

## 9.2 Fluxo

```
Cliente abre app → gerar QR
Parceiro lê QR → chama API validate
UAU responde:
  saldo disponível
  limite A%
Caixa confirma
UAU debita cashback
UAU retorna valor final
Parceiro cobra somente diferença
```

## 9.3 Endpoints

```
POST /partners/{id}/redeem/validate
POST /partners/{id}/redeem/apply
```

---

# 10. Lavagens – Uso via QR Code

## 10.1 Regra

* 1 QR por assinatura
* Funcionário lê
* Verifica status e saldo
* Consome lavagem
* Registra unidade, funcionário, horário

---

# 11. Dashboards

## 11.1 Usuário

* lavagens restantes
* fatura
* cashback
* rede
* ganhos
* histórico
* parceiros

## 11.2 Unidade

* lavagens do dia
* ranking
* clientes ativos/suspensos
* indicadores

## 11.3 Franqueadora

* crescimento
* faturamento
* inadimplência
* cashback total
* lavagens por unidade

---

# 12. Modelagem Prisma – Estruturas Principais

```prisma
model User {
  id               String   @id
  name             String
  phone            String
  email            String
  status           String   // ativo, suspenso, cancelado
  role             String   // admin, unidade, cliente
  referrerId       String?
  createdAt        DateTime @default(now())
  wallets          Wallet[]
  referrals        ReferralPosition[]
  subscription     Subscription?
}
```

```prisma
model Subscription {
  id               String   @id
  userId           String   @unique
  status           String
  planId           String
  nextBillingDate  DateTime
  createdAt        DateTime @default(now())
}
```

```prisma
model Wallet {
  id          String   @id
  userId      String
  type        String   // interno, alloyal
  balance     Decimal  @default(0)
}
```

```prisma
model CashbackTransaction {
  id          String   @id
  userId      String
  partnerId   String?
  earned      Decimal
  used        Decimal
  createdAt   DateTime @default(now())
}
```

```prisma
model PartnerLocal {
  id          String   @id
  name        String
  T           Decimal
  C           Decimal
  A           Decimal
}
```

---

# 13. Módulos NestJS – Diagrama ASCII

```txt
modules/
│
├── auth
│
├── users
│
├── subscriptions
│     └── billing (cron tentativas)
│
├── referrals
│     └── bonus-calculator
│
├── cashback
│     ├── internal
│     └── alloyAl
│
├── partners-local
│     └── tcavalidation
│
├── qr-redemption
│     └── tokens (expira 60s)
│
├── washes
│
├── dashboards
│
└── reports
```

---

# 14. Fluxos – Diagramas ASCII

## 14.1 Fluxo da Assinatura

```txt
Cliente → Pagamento → Gateway
  ↓ ok
Ativo → Libera lavagens → Gera QR
  ↓
Se falhar → D+1 → D+3 → D+5 → Suspenso
```

## 14.2 Fluxo de Indicação

```txt
A indica B
B paga → A ganha 10
      → patrocinador de A ganha 5
      → próximo nível ganha 5

Todo mês:
N1 ganha 3
N2 ganha 2
N3 ganha 1
```

## 14.3 Fluxo QR Parceiro

```txt
App → QR
Parceiro → Scan
UAU → Validate
UAU → Limite A%
UAU → Apply
Parceiro cobra
```

---

# 15. Endpoints Essenciais

## 15.1 QR Redeem

```http
POST /partners/{id}/redeem/validate
POST /partners/{id}/redeem/apply
```

## 15.2 Cashback

```http
GET /cashback/balance
GET /cashback/history
```

## 15.3 Assinatura

```http
POST /subscriptions/start
POST /subscriptions/renew
```

## 15.4 Washes

```http
POST /washes/use
```

---

# 16. Checklist Técnico

* [ ] Implementar Prisma completo
* [ ] Implementar billing cron
* [ ] Implementar QR (tokens temporários + hash)
* [ ] Implementar validação T/C/A
* [ ] Implementar cashback interno + AlloyAl
* [ ] Implementar rede 3 níveis
* [ ] Implementar bônus único + recorrente
* [ ] Implementar uso de lavagens
* [ ] Implementar dashboards
* [ ] Implementar relatórios

---

gcloud run deploy uau-clube-api \                                                                                                                                       
--image=us-central1-docker.pkg.dev/metal-music-479113-v9/uau/uau-clube-api:latest \
--region=us-central1 \
--project=metal-music-479113-v9 \
--allow-unauthenticated \
--env-vars-file=cloudrun.env.yaml


✗ gcloud builds submit \                                                                                                                                                  
--tag us-central1-docker.pkg.dev/metal-music-479113-v9/uau/uau-clube-api:latest \  
--gcs-source-staging-dir=gs://uau-clube-build-source/source

