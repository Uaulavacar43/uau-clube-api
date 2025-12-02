# README Técnico – Módulo de Automação Lavacar

Self-Service Assistido com Lavador, App e Totem

---

## 1. Introdução

Este documento define as regras de negócio e a modelagem técnica do **Módulo de Automação Lavacar** para unidades que operam no modelo:

* **Self-Service Assistido**, com:

    * Autorização digital obrigatória (App ou Totem).
    * Lavador humano executando a lavagem (mangueira, espuma, secagem, etc.).
    * Câmera OCR (LPR) monitorando a entrada no setor de lavagem.
* Sem travas físicas obrigatórias nas máquinas:

    * O controle é feito por **processo** (regras, sistema, auditoria), não por bloqueio físico.

Unidades **manuais** (modelo atual) continuam funcionando exatamente como hoje.
Este módulo se aplica a unidades marcadas como **automatizadas**, que passam a usar:

* Sessão de lavagem (`WashSession`) como “ficha digital”.
* Câmera OCR (`LprEvent`) para verificar se quem entrou tem autorização.
* App e **Totem físico** como canais de entrada:

    * Escolher serviço.
    * Pagar.
    * Usar plano.
* Lavador como ponto de controle humano final.

---

## 2. Tipos de Unidade e Papéis

### 2.1 Tipos de unidade (campo técnico)

```prisma
enum AutomationMode {
  MANUAL
  AUTOMATED

  @@schema("public")
}
```

* `MANUAL`
  Modelo atual. Não usa Sessão de Lavagem, nem LPR, nem Totem obrigatório.

* `AUTOMATED`
  Usa Sessão de Lavagem, LPR e suporte a Totem/App como entrada obrigatória.

```prisma
model WashLocation {
  // campos existentes...
  automationMode AutomationMode @default(MANUAL)

  washMachines   WashMachine[]
  washSessions   WashSession[]

  @@schema("public")
}
```

### 2.2 Papéis

1. Cliente

    * Pode usar **App** ou **Totem**:

        * Seleciona unidade.
        * Seleciona placa.
        * Escolhe serviço.
        * Usa plano ou paga avulso.

2. Totem

    * Terminal físico na unidade automatizada.
    * Atende:

        * Quem não tem plano (pagamento avulso).
        * Quem tem plano (selecionar qual serviço consumir com o plano ou pagar upgrade).
    * Sempre cria/aciona Sessão de Lavagem no backend.

3. App Lavacar (cliente)

    * Mesma lógica do Totem em termos de negócio.
    * Diferencial: pode usar cashback, carteiras, etc. conforme evoluções.

4. Sistema Lavacar (API)

    * Valida plano, pagamentos e elegibilidade.
    * Cria e gerencia `WashSession`.
    * Recebe eventos de LPR.
    * Opcionalmente registra eventos de equipamento.
    * Gera alertas e relatórios.

5. Lavador (operador)

    * Consulta lista de lavagens liberadas (Sessões).
    * Confere placa e serviço.
    * Inicia e conclui a lavagem fisicamente.
    * Confirma no sistema o fim da lavagem.

6. Câmera OCR (LPR)

    * Lê placa quando o carro entra na área/baia de lavagem.
    * Gera `LprEvent`.

7. Equipamentos de lavagem

    * Mangueiras, bombas, lavadora de alta pressão, aspirador etc.
    * Podem ser monitorados por sensores, mas não são obrigatoriamente travados.

---

## 3. Modelagem de Dados

### 3.1 Entidades já existentes (reaproveitadas)

* `User`, `Car`, `Plan`, `Subscription`, `Payment`, `IndividualServicePurchase`, `WashLocation`, `WashService`, `LocationService`, `DailyWash`
* Todos continuam válidos e são apenas enriquecidos com a automação.

### 3.2 Novos enums

```prisma
enum WashSessionOrigin {
  SUBSCRIPTION        // uso coberto por plano
  INDIVIDUAL_PURCHASE // pagamento avulso
  FREE                // cortesia
  ADJUSTMENT          // acerto manual
  OTHER

  @@schema("public")
}

enum WashSessionSource {
  AUTOMATED  // unidades com automação

  @@schema("public")
}

enum WashSessionStatus {
  PENDING      // criada, aguardando confirmação de pagamento/uso de plano
  AUTHORIZED   // liberada para lavar (aguardando entrada no setor)
  IN_PROGRESS  // lavador executando
  COMPLETED    // lavagem concluída
  CANCELED     // não usada dentro da janela ou cancelada manualmente
  ERROR        // problemas ou fraudes detectadas

  @@schema("public")
}

enum MachineType {
  TUNNEL
  BOX
  JET_WASH
  ROBOT
  OTHER

  @@schema("public")
}

enum WashSessionChannel {
  APP
  TOTEM
  BACKOFFICE

  @@schema("public")
}
```

### 3.3 Alterações em modelos existentes

#### 3.3.1 WashLocation

```prisma
model WashLocation {
  id             Int                    @id @default(autoincrement())
  name           String
  createdAt      DateTime               @default(now())
  updatedAt      DateTime               @updatedAt
  city           String
  managerId      Int
  neighborhood   String
  number         String
  street         String
  flow           Flow                   @default(LOW)
  phoneNumber    String?
  rateQtd        Int                    @default(0)
  rateValue      Float                  @default(0.0)
  images         String[]
  isActive       Boolean                @default(true)
  deletedAt      DateTime?

  automationMode AutomationMode         @default(MANUAL)

  dailyWashes    DailyWash[]
  services       LocationService[]
  openingHours   OpeningHour[]
  manager        User                   @relation("ManagerToWashLocations", fields: [managerId], references: [id])
  usersFavorited WashLocationFavorite[]

  washMachines   WashMachine[]
  washSessions   WashSession[]

  @@schema("public")
}
```

#### 3.3.2 DailyWash

```prisma
model DailyWash {
  id             Int           @id @default(autoincrement())
  carId          Int
  washDate       DateTime
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @default(now())
  washLocationId Int?
  washSessionId  Int?

  car            Car           @relation(fields: [carId], references: [id])
  washLocation   WashLocation? @relation(fields: [washLocationId], references: [id])
  washSession    WashSession?  @relation(fields: [washSessionId], references: [id])

  @@schema("public")
}
```

### 3.4 Novas entidades

#### 3.4.1 WashSession

```prisma
model WashSession {
  id             Int                @id @default(autoincrement())
  userId         Int?
  carId          Int?
  washLocationId Int
  washServiceId  Int?
  paymentId      Int?
  subscriptionId Int?

  origin         WashSessionOrigin
  source         WashSessionSource @default(AUTOMATED)
  channel        WashSessionChannel @default(APP)
  status         WashSessionStatus @default(PENDING)

  startedAt      DateTime?
  finishedAt     DateTime?
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt

  user           User?            @relation(fields: [userId], references: [id])
  car            Car?             @relation(fields: [carId], references: [id])
  washLocation   WashLocation     @relation(fields: [washLocationId], references: [id])
  washService    WashService?     @relation(fields: [washServiceId], references: [id])
  payment        Payment?         @relation(fields: [paymentId], references: [id])
  subscription   Subscription?    @relation(fields: [subscriptionId], references: [id])

  machineEvents  MachineCounterEvent[]
  lprEvents      LprEvent[]
  dailyWashes    DailyWash[]

  @@schema("public")
}
```

#### 3.4.2 WashMachine e MachineCounterEvent (monitoramento opcional)

```prisma
model WashMachine {
  id             Int               @id @default(autoincrement())
  washLocationId Int
  name           String
  type           MachineType
  controllerId   String            @unique
  isActive       Boolean           @default(true)
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt

  washLocation   WashLocation      @relation(fields: [washLocationId], references: [id])
  counterEvents  MachineCounterEvent[]

  @@schema("public")
}

model MachineCounterEvent {
  id            Int          @id @default(autoincrement())
  washMachineId Int
  washSessionId Int?
  counterValue  Int
  eventAt       DateTime     @default(now())

  washMachine   WashMachine  @relation(fields: [washMachineId], references: [id])
  washSession   WashSession? @relation(fields: [washSessionId], references: [id])

  @@schema("public")
}
```

#### 3.4.3 LprEvent

```prisma
model LprEvent {
  id             Int          @id @default(autoincrement())
  washLocationId Int
  washSessionId  Int?
  cameraId       String?
  plate          String
  confidence     Float
  imageUrl       String?
  capturedAt     DateTime     @default(now())

  washLocation   WashLocation @relation(fields: [washLocationId], references: [id])
  washSession    WashSession? @relation(fields: [washSessionId], references: [id])

  @@schema("public")
}
```

---

## 4. Totem: Regras de Negócio

### 4.1 Papel do Totem

O Totem é um frontend físico instalado na unidade automatizada.
Regras:

1. Pode ser usado por qualquer cliente:

    * Com plano.
    * Sem plano.
    * Com ou sem app instalado.
2. Sempre se comunica com a API, que:

    * Consulta plano ativo.
    * Calcula elegibilidade.
    * Exige pagamento quando necessário.
    * Cria `WashSession`.

### 4.2 Identificação no Totem

Modos possíveis (decisão operacional):

1. Entrada manual da placa.
2. Busca por CPF/telefone, associando a carros daquele usuário.
3. Leitura de QR do app (identificação rápida).
4. Leitura da placa pelo LPR do acesso e pré-preenchimento no Totem.

Do ponto de vista de backend, o totem envia:

* `washLocationId`.
* Placa do carro.
* Identificação opcional de `userId` (se login ou QR for utilizado).

### 4.3 Totem com cliente que TEM plano

Fluxo:

1. Cliente se dirige ao Totem.

2. Totem pergunta placa ou identidade.

3. API busca:

    1. `Car` pela placa.
    2. Planos ativos (`Subscription`) usando view:

   ```sql
   SELECT *
   FROM public.v_active_autowash_subscriptions
   WHERE "carId" = $carId;
   ```

4. Se houver planos ativos:

    1. API monta lista de serviços elegíveis pelo plano (Join `Plan` x `WashService` na relação `PlansToWashServices`).
    2. Totem exibe:

        * Serviços cobertos pelo plano (sem custo adicional).
        * Serviços adicionais/upgrade (requerem pagamento avulso).

5. Cliente escolhe:

    * Serviço coberto pelo plano:

        * API cria `WashSession`:

            * `origin = SUBSCRIPTION`
            * `channel = TOTEM`
            * `status = AUTHORIZED`
    * Serviço de upgrade/extra:

        * Totem manda para fluxo de pagamento.
        * Após pagamento aprovado:

            * `Payment.status = PAID`
            * `IndividualServicePurchase.status = COMPLETED`
            * API cria `WashSession`:

                * `origin = INDIVIDUAL_PURCHASE`
                * `channel = TOTEM`
                * `status = AUTHORIZED`

### 4.4 Totem com cliente que NÃO tem plano

Fluxo:

1. Cliente informa placa.
2. API verifica se há plano ativo. Não havendo:

    * Totem exibe menu de serviços avulsos disponíveis na unidade (`LocationService` + `WashService`).
3. Cliente escolhe serviço.
4. Totem conduz pagamento:

    * Cartão, PIX, etc.
5. Após confirmação:

    * API atualiza `Payment` e `IndividualServicePurchase`.
    * Cria `WashSession`:

        * `origin = INDIVIDUAL_PURCHASE`
        * `channel = TOTEM`
        * `status = AUTHORIZED`.

### 4.5 Totem: comportamento padrão

1. O Totem nunca libera “lavagem” sem que a API retorne sucesso e crie `WashSession` em status AUTHORIZED.
2. O Totem mostra para o cliente uma tela de confirmação com:

    * Placa.
    * Serviço.
    * Unidade.
    * Número da “Senha/Ordem” (ID da Sessão).

---

## 5. Fluxos de Autorização (App + Totem)

### 5.1 Fluxo comum de criação da Sessão

Independente do canal (APP/TOTEM), o backend aplica:

1. Resolver `Car` e opcionalmente `User`.
2. Verificar se há assinatura ativa (regras de data/status).
3. Verificar limite de uso do plano, se aplicável.
4. Verificar se o serviço desejado é coberto pelo plano:

    * Se sim → `origin = SUBSCRIPTION`.
    * Se não → cobrança avulsa → `origin = INDIVIDUAL_PURCHASE`.
5. Em caso de cobrança avulsa:

    * Espera `Payment.status = PAID` e `IndividualServicePurchase.status = COMPLETED`.
6. Cria `WashSession` com:

    * `origin = SUBSCRIPTION` ou `INDIVIDUAL_PURCHASE`.
    * `source = AUTOMATED`.
    * `channel = APP` ou `TOTEM`.
    * `status = AUTHORIZED`.

---

## 6. Câmera OCR e Entrada no Setor

### 6.1 Regra de entrada

Sempre que um carro entra na área de lavagem em unidade automatizada:

1. Câmera OCR captura:

    * Placa.
    * Foto.
    * Confiança.
    * Unidade.

2. API grava `LprEvent`.

3. API procura Sessão autorizada:

```sql
SELECT ws.*
FROM "WashSession" ws
JOIN "Car" c ON c.id = ws."carId"
WHERE c.plate = $plate
  AND ws."washLocationId" = $washLocationId
  AND ws.status = 'AUTHORIZED'
  AND ws."createdAt" >= now() - interval '10 minutes';
```

4. Se encontrar:

    * `LprEvent.washSessionId = ws.id`.
    * `WashSession.status = IN_PROGRESS` (se ainda estava AUTHORIZED).
    * A sessão representa: “carro autorizado entrou no setor”.

5. Se não encontrar:

    * `LprEvent` mantém `washSessionId = NULL`.
    * Evento é considerado **Entrada Não Autorizada**.

View para auditoria:

```sql
CREATE OR REPLACE VIEW public.v_lpr_unauthorized_entries AS
SELECT
  le.*,
  wl.name AS wash_location_name
FROM "LprEvent" le
JOIN "WashLocation" wl ON wl.id = le."washLocationId"
LEFT JOIN "WashSession" ws ON ws.id = le."washSessionId"
WHERE wl."automationMode" = 'AUTOMATED'
  AND ws.id IS NULL;
```

---

## 7. Papel do Lavador (Operador Humano)

### 7.1 Informações que o lavador recebe

Em um app interno ou painel local, o lavador vê:

1. Lista de Sessões com:

    * Status AUTHORIZED ou IN_PROGRESS.
    * Placa.
    * Unidade (fixa).
    * Serviço.
    * Origem (plano ou avulso).
    * Canal (APP/TOTEM).
    * Horário de criação.

2. Destaque visual para:

    * Sessões que já tiveram LprEvent vinculado (carro dentro do setor).
    * Sessões próximas do timeout de cancelamento.

### 7.2 Procedimento operacional correto

1. Ver um carro entrando na área de lavagem.
2. Conferir placa no carro.
3. Conferir Sessão correspondente no sistema:

    * Se existir Sessão em AUTHORIZED/IN_PROGRESS para aquela placa:

        * Lavador pode iniciar a lavagem.
    * Se não existir:

        * Orientar o cliente a passar no Totem ou usar o app para liberar o serviço.
4. Ao terminar a lavagem:

    * Lavador marca como concluída no sistema (botão “Concluir lavagem”).
    * API muda `WashSession.status = COMPLETED` e cria `DailyWash`.

### 7.3 Sessões autorizadas que não viram lavagem

Sessões com status AUTHORIZED que:

1. Não recebem LprEvent vinculado.
2. Não são marcadas como concluídas pelo lavador.
3. Não recebem eventos de equipamento (caso use MachineCounterEvent).

Dentro de uma janela configurada (por exemplo 10–15 minutos):

* Devem ser marcadas como `CANCELED`.
* Ficam registradas para fins de auditoria, mas não contam como lavagem realizada.

---

## 8. Anti-Fraude e Monitoramento

### 8.1 Tipos de desvio monitorados

1. Entrada não autorizada (LPR sem Sessão).
2. Sessão concluída sem LPR (lavagem fora da área monitorada ou câmera inoperante).
3. Sessões autorizadas que nunca viram entrada no setor (cliente desistiu).
4. Eventos de máquina sem Sessão (se monitoramento de máquina estiver ativo).

### 8.2 Views sugeridas

Entrada não autorizada (já vista):

```sql
CREATE OR REPLACE VIEW public.v_lpr_unauthorized_entries AS
SELECT
  le.*,
  wl.name AS wash_location_name
FROM "LprEvent" le
JOIN "WashLocation" wl ON wl.id = le."washLocationId"
LEFT JOIN "WashSession" ws ON ws.id = le."washSessionId"
WHERE wl."automationMode" = 'AUTOMATED'
  AND ws.id IS NULL;
```

Eventos de máquina sem sessão:

```sql
CREATE OR REPLACE VIEW public.v_machine_events_without_session AS
SELECT
  mce.*,
  wm.name AS machine_name,
  wl.name AS wash_location_name
FROM "MachineCounterEvent" mce
JOIN "WashMachine" wm ON wm.id = mce."washMachineId"
JOIN "WashLocation" wl ON wl.id = wm."washLocationId"
WHERE wl."automationMode" = 'AUTOMATED'
  AND mce."washSessionId" IS NULL;
```

---

## 9. Relatórios e Caixa

### 9.1 Resumo diário por unidade automatizada

```sql
CREATE OR REPLACE VIEW public.v_wash_sessions_daily_summary AS
SELECT
  ws."washLocationId",
  wl.name AS wash_location_name,
  date_trunc('day', ws."createdAt") AS ref_date,
  COUNT(*) AS total_sessions,
  COUNT(*) FILTER (WHERE ws.origin = 'SUBSCRIPTION')        AS total_subscriptions,
  COUNT(*) FILTER (WHERE ws.origin = 'INDIVIDUAL_PURCHASE') AS total_individual,
  COUNT(*) FILTER (WHERE ws.status = 'COMPLETED')           AS total_completed
FROM "WashSession" ws
JOIN "WashLocation" wl ON wl.id = ws."washLocationId"
WHERE wl."automationMode" = 'AUTOMATED'
GROUP BY ws."washLocationId", wl.name, date_trunc('day', ws."createdAt");
```

### 9.2 Caixa avulso diário

```sql
CREATE OR REPLACE VIEW public.v_daily_cashbox_automated AS
SELECT
  ws."washLocationId",
  wl.name AS wash_location_name,
  date_trunc('day', ws."createdAt") AS ref_date,
  SUM(
    CASE
      WHEN ws.origin = 'INDIVIDUAL_PURCHASE'
           AND p."status" = 'PAID'
      THEN p.amount
      ELSE 0
    END
  ) AS total_avulso
FROM "WashSession" ws
JOIN "WashLocation" wl ON wl.id = ws."washLocationId"
LEFT JOIN "Payment" p ON p.id = ws."paymentId"
WHERE wl."automationMode" = 'AUTOMATED'
GROUP BY ws."washLocationId", wl.name, date_trunc('day', ws."createdAt");
```

### 9.3 Segmentação por canal (APP x TOTEM)

Basta filtrar `WashSession.channel`:

* `channel = APP` → conversões via app.
* `channel = TOTEM` → uso do totem (importante para ver unidades com muito fluxo espontâneo sem app).

---

## 10. Compatibilidade com o Modelo Manual Atual

1. Unidades **manuais** permanecem usando:

    * `DailyWash` direto.
    * Regras já implementadas de plano/pagamento.
    * Sem Sessão de Lavagem, sem LPR obrigatório, sem Totem.

2. Unidades **automatizadas**:

    * `automationMode = AUTOMATED`.
    * Totem e App passam a ser as únicas formas válidas de liberar lavagens.
    * LPR monitora entrada na área.
    * Lavador atua guiado pela Sessão e pelos alertas.

---

## 11. Checklist de Implementação

1. Banco

    * Criar enums: `AutomationMode`, `WashSessionOrigin`, `WashSessionSource`, `WashSessionStatus`, `MachineType`, `WashSessionChannel`.
    * Alterar `WashLocation` (campo `automationMode` + relações).
    * Alterar `DailyWash` (`washSessionId`).
    * Criar tabelas: `WashSession`, `WashMachine`, `MachineCounterEvent`, `LprEvent`.
    * Criar views:

        * `v_active_autowash_subscriptions`
        * `v_wash_sessions_daily_summary`
        * `v_daily_cashbox_automated`
        * `v_lpr_unauthorized_entries`
        * `v_machine_events_without_session`.

2. API

    * Endpoints de criação de Sessão (APP/TOTEM).
    * Endpoints do Totem:

        * Identificar placa/usuário.
        * Listar serviços elegíveis por plano.
        * Listar serviços avulsos.
        * Confirmar pagamento e criar Sessão.
    * Endpoints de LPR: receber e vincular `LprEvent`.
    * Endpoints lavador: iniciar/concluir lavagem.
    * Jobs de timeout de Sessões.

3. App cliente

    * Fluxo de solicitação de lavagem equivalentes ao Totem.

4. Totem

    * UI para entrada de placa/CPF/QR.
    * Tela de escolha de serviço (coberto pelo plano ou avulso).
    * Integração com meios de pagamento.
    * Consumo dos endpoints de Sessão.

5. Painéis

    * Operacional (Sessões do dia, status, canal).
    * Anti-fraude (entradas não autorizadas, máquina sem sessão).
    * Caixa diário.

Com isso, o sistema passa a suportar um modelo de **Self-Service Assistido**, onde:

* App e Totem são os únicos pontos de liberação;
* Lavador é o executor físico da lavagem;
* Câmera OCR e Sessão de Lavagem amarram tudo em um fluxo rastreável e auditável.
