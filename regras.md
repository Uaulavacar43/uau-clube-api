# Regras de Negócio – Planos, Assinaturas e Migração ASAAS

Topzeira Mensal (Plano 6) – UAU Lava Car

Autor: Rafael Dias

---

## 1. Objetivo

Documentar, de forma operacional e rastreável, as regras de negócio e os passos de correção relativos a:

1. Plano pacote Topzeira Mensal (`Plan.id = 6`).
2. Assinaturas criadas pelo app atual (caso Eduardo).
3. Assinaturas reconstruídas a partir da base legada ASAAS (caso Léo “unitário”).
4. Correções em lote para outros clientes em situação idêntica ao Léo (caso Léo “em lote”).
5. Regras que devem ser implementadas nos serviços (Pagamentos / Migração / Carros) para que essa situação não volte a acontecer.
6. Regras de negócio para Cancelamento de plano x Remoção de cliente (limpeza de histórico).
7. Nova problemática: pagamento confirmado no ASAAS, `Payment.status = PAID`, Subscription existente, mas `isActive = FALSE` por falta de propagação de status quando o webhook não chega (novo caso Eduardo).

---

## 2. Modelos Envolvidos (resumo)

### 2.1. Plan

Campos relevantes:

* `id`
* `name`
* `price`
* `duration` (dias de validade do ciclo)
* `periodicityType` (`WEEK`, `MONTH`, `YEAR`, `SEMIANNUALLY`, `QUARTERLY`)
* `isPackage` (se é plano pacote de serviços)
* `maxInstallments`
* `extraMonths`

O Topzeira Mensal é o `Plan.id = 6`.

### 2.2. Payment

Campos relevantes:

* `id`
* `userId`
* `planId` (pode ter vindo `NULL` na migração, depois preenchido)
* `amount`
* `status` (`PAID`, `PENDING`, `CANCELED`)
* `paymentMethodId`
* `paymentIdAsaas`
* `paymentDate`
* `createdAt`

### 2.3. Subscription

Campos relevantes:

* `id`
* `userId`
* `planId`
* `carId` (pode ser `NULL` em migrados que ainda não tinham carro)
* `planType` (texto interno de periodicidade – ex.: `'MONTH'`)
* `startDate`
* `expiresAt`
* `amount`
* `isActive`
* `subscriptionStatus` (`ACTIVE`, `SUSPENDED`, `CANCELED`)
* `subscriptionIdAsaas`
* `installmentIdAsaas`
* `couponId`
* `createdAt`
* `updatedAt`

### 2.4. Car

Campos relevantes:

* `id`
* `userId`
* `plate`
* `createdAt`
* demais dados do veículo

---

## 3. Invariantes de Negócio (Plano Pacote)

Para qualquer plano do tipo “pacote de serviços” (inclui o Topzeira Mensal):

1. `Plan.isPackage = TRUE`.
2. `Plan.periodicityType` define o tipo de periodicidade da assinatura (ex.: `'MONTH'`).
3. `Plan.duration` define em dias a validade de cada ciclo (ex.: 30 dias).
4. `Subscription.planType` deve sempre refletir `Plan.periodicityType`

    * Exemplo: Topzeira Mensal → `planType = 'MONTH'`.
    * Strings da ASAAS (`'MONTHLY'`, `'YEARLY'`, etc.) **não** devem ser gravadas em `Subscription.planType`.
5. Assinatura ativa = assinatura com:

    * `isActive = TRUE`
    * `expiresAt >= NOW()`.

Fonte de verdade financeira: último registro de `Payment` com `status = 'PAID'` para `(userId, planId)`.

---

## 4. Problema Original (sintoma comum)

Sintoma visto na tela “Meus Planos”:

* Cliente paga no ASAAS → `Payment.status = PAID`.
* Registro em `Payment` existe e está correto.
* Cliente não vê nenhum plano ativo no app.

Causas combinadas:

1. Em algum momento, `Plan.id = 6` tinha `isPackage = FALSE`.
2. `Subscription` foi gravada com:

    * `planType` misturando `'MONTH'` e `'MONTHLY'`.
    * `isActive` inconsistente com `expiresAt`.
    * `expiresAt` nulo ou incorreto em várias linhas.
3. Em fluxos legados, `Subscription.carId` estava `NULL` mesmo quando o usuário já tinha carro; a tela de planos filtrava por assinatura atrelada a carro.

Resultado: financeiramente em dia, mas a camada de domínio não batia com as regras de exibição.

---

## 5. Caso Eduardo – Fluxo Novo (app atual)

### 5.1. Estado do Plano 6 antes e depois

Consulta do plano:

```sql
SELECT
  "id",
  "name",
  "price",
  "periodicityType",
  "isPackage",
  "duration",
  "maxInstallments",
  "extraMonths"
FROM "Plan"
WHERE "id" = 6;
```

Situação corrigida (estado desejado):

* `id = 6`
* `name = 'Topzeira Mensal'`
* `periodicityType = 'MONTH'`
* `isPackage = TRUE`
* `duration = 30`

Ajuste aplicado:

```sql
UPDATE "Plan"
SET "isPackage" = TRUE
WHERE "id" = 6;
```

### 5.2. Payment do Eduardo (fonte de verdade)

Exemplo de pagamento usado como referência no fluxo novo:

```sql
SELECT
  "id",
  "userId",
  "planId",
  "amount",
  "status",
  "paymentIdAsaas",
  "paymentDate",
  "createdAt"
FROM "Payment"
WHERE "id" = 2670;
```

Resultado (resumo típico):

* `userId = 102`
* `planId = 6`
* `amount = 139.9`
* `status = 'PAID'`
* `paymentIdAsaas = 'pay_ek6cbqbantuf7m83'` (exemplo)
* `paymentDate` coerente com a data da cobrança ASAAS

### 5.3. Subscription do Eduardo – Antes da correção

Consulta:

```sql
SELECT
  "id",
  "userId",
  "planId",
  "carId",
  "planType",
  "isActive",
  "startDate",
  "expiresAt",
  "subscriptionIdAsaas"
FROM "Subscription"
WHERE "userId" = 102
ORDER BY "createdAt" DESC;
```

Antes da normalização (visão conceitual):

* Várias linhas com:

    * `planId = 6`
    * `planType` misturando `'MONTHLY'` e `'MONTH'`.
    * `isActive = FALSE` em assinaturas que deveriam estar ativas.
    * `expiresAt` vazio ou incoerente.

### 5.4. Subscription do Eduardo – Correção manual da linha “boa”

Com base no `Payment` pago, a assinatura “correta” do Eduardo (ex.: `id = 45`) foi atualizada:

```sql
UPDATE "Subscription"
SET
  "planType" = 'MONTH',
  "startDate" = '2025-11-29 08:27:18.152',
  "expiresAt" = '2025-12-29 08:27:18.152',
  "isActive" = TRUE,
  "updatedAt" = NOW()
WHERE "id" = 45;
```

Após isso, a mesma consulta passou a mostrar algo neste formato:

```sql
SELECT
  "id",
  "userId",
  "planId",
  "carId",
  "planType",
  "isActive",
  "startDate",
  "expiresAt",
  "subscriptionIdAsaas"
FROM "Subscription"
WHERE "userId" = 102
ORDER BY "createdAt" DESC;
```

Resultado relevante:

* `id = 45`
* `userId = 102`
* `planId = 6`
* `carId = 10` (exemplo)
* `planType = 'MONTH'`
* `isActive = TRUE`
* `startDate = 2025-11-29 08:27:18.152`
* `expiresAt = 2025-12-29 08:27:18.152`
* `subscriptionIdAsaas = 'sub_eiheydywf9qujma0'`

A partir daí, o plano do Eduardo passou a aparecer corretamente na tela.

### 5.5. Normalização em massa do Plano 6

Para alinhar todos os clientes do plano 6:

```sql
UPDATE "Subscription" s
SET
  "planType" = 'MONTH',
  "isActive" = (
    s."expiresAt" IS NOT NULL
    AND s."expiresAt" >= NOW()
  ),
  "updatedAt" = NOW()
FROM "Plan" p
WHERE
  s."planId" = p."id"
  AND p."id" = 6
  AND p."isPackage" = TRUE;
```

Efeito:

* Todo mundo no plano 6 passa a ter `planType = 'MONTH'`.
* `isActive` passa a refletir diretamente se a assinatura está dentro do prazo.

---

## 6. Caso Léo – Migrado ASAAS, com carro, sem Subscription

### 6.1. Identificação do usuário

```sql
SELECT
  u."id",
  u."name",
  u."email"
FROM "User" u
WHERE
  u."name" ILIKE '%leo felipe%'
  OR u."name" ILIKE '%léo felipe%'
  OR u."name" ILIKE '%barreto%';
```

Resultado:

* `id = 42`
* `name = 'Léo Felipe Barreto'`

### 6.2. Pagamentos do Léo – Antes do ajuste de planId

Consulta:

```sql
SELECT
  "id",
  "userId",
  "planId",
  "amount",
  "status",
  "paymentMethodId",
  "paymentIdAsaas",
  "paymentDate",
  "createdAt"
FROM "Payment"
WHERE
  "userId" = 42
ORDER BY
  "paymentDate" DESC;
```

Estado original típico (conceitual):

* 3 linhas, por exemplo:

    * `planId = NULL` em todas.
    * Uma com `status = 'PAID'`, as demais `PENDING`.
    * `paymentDate` 2025-10-31 para a linha paga.

Ajuste necessário: atribuir `planId = 6` nos pagamentos do plano pacote:

```sql
UPDATE "Payment"
SET "planId" = 6
WHERE "userId" = 42
  AND "planId" IS NULL;
```

Após o ajuste:

```sql
SELECT
  "id",
  "userId",
  "planId",
  "amount",
  "status",
  "paymentMethodId",
  "paymentIdAsaas",
  "paymentDate",
  "createdAt"
FROM "Payment"
WHERE
  "userId" = 42
ORDER BY
  "paymentDate" DESC;
```

Resultado (resumido):

```text
 id  | userId | planId | amount | status  | paymentMethodId |    paymentIdAsaas    |     paymentDate     |        createdAt        
-----+--------+--------+--------+---------+-----------------+----------------------+---------------------+-------------------------
 484 |     42 |      6 |  119.9 | PENDING | CREDIT_CARD     | pay_zdkhllli00ijlzsb | 2025-11-22 00:00:00 | 2025-11-23 22:08:29.466
 947 |     42 |      6 |  119.9 | PENDING | CREDIT_CARD     | pay_tnx9mheyi7bmcguv | 2025-10-31 00:00:00 | 2025-11-23 22:10:06.983
 951 |     42 |      6 |  119.9 | PAID    | CREDIT_CARD     | pay_hewwalzbptrdyy0j | 2025-10-31 00:00:00 | 2025-11-23 22:10:07.617
```

### 6.3. Estado da Subscription do Léo – Antes da criação

```sql
SELECT
  s."id",
  s."userId",
  u."name" AS "userName",
  s."planId",
  p."name" AS "planName",
  p."periodicityType",
  s."planType",
  s."carId",
  s."isActive",
  s."subscriptionStatus",
  s."startDate",
  s."expiresAt"
FROM "Subscription" s
JOIN "User" u ON u."id" = s."userId"
JOIN "Plan" p ON p."id" = s."planId"
WHERE s."userId" = 42;
```

Resultado antes:

```text
 subscriptionId | userId | userName | planId | planName | periodicityType | planType | carId | isActive | subscriptionStatus | startDate | expiresAt 
----------------+--------+----------+--------+----------+-----------------+----------+-------+----------+--------------------+-----------+-----------
(0 rows)
```

Ou seja, Léo tinha pagamento ASAAS, mas **nenhuma Subscription**.

### 6.4. Carro do Léo

```sql
SELECT
  c."id"       AS "carId",
  c."userId",
  u."name"     AS "userName",
  c."plate",
  c."createdAt"
FROM "Car" c
JOIN "User" u
  ON u."id" = c."userId"
WHERE
  c."userId" = 42
ORDER BY
  c."createdAt" DESC;
```

Resultado:

```text
 carId | userId |      userName      |  plate  |       createdAt       
-------+--------+--------------------+---------+-----------------------
    57 |     42 | Léo Felipe Barreto | NQT5828 | 2025-11-29 13:02:28.4
```

### 6.5. Criação da Subscription do Léo (reconstrução manual)

Regras aplicadas:

* Pegou-se o `Payment` mais recente com `status = 'PAID'` e `planId = 6`.
* `startDate = paymentDate`.
* `expiresAt = paymentDate + 30 dias`.
* `planType = 'MONTH'`.
* `isActive = TRUE` (dentro da janela de 30 dias).
* `carId = 57` (carro cadastrado).

Exemplo de `INSERT`:

```sql
INSERT INTO "Subscription" (
  "userId",
  "createdAt",
  "updatedAt",
  "expiresAt",
  "isActive",
  "subscriptionStatus",
  "endDate",
  "startDate",
  "amount",
  "planType",
  "paymentMethod",
  "planId",
  "subscriptionIdAsaas",
  "installmentIdAsaas",
  "couponId",
  "carId"
)
VALUES (
  42,
  NOW(),
  NOW(),
  '2025-11-30 00:00:00',
  TRUE,
  'ACTIVE',
  NULL,
  '2025-10-31 00:00:00',
  119.9,
  'MONTH',
  'CREDIT_CARD',
  6,
  'pay_hewwalzbptrdyy0j',
  NULL,
  NULL,
  57
);
```

### 6.6. Subscription do Léo – Depois da criação

Consulta:

```sql
SELECT
  s."id"          AS "subscriptionId",
  s."userId",
  u."name"        AS "userName",
  s."planId",
  p."name"        AS "planName",
  p."periodicityType",
  s."planType",
  s."carId",
  s."isActive",
  s."subscriptionStatus",
  s."startDate",
  s."expiresAt"
FROM "Subscription" s
JOIN "User" u ON u."id" = s."userId"
JOIN "Plan" p ON p."id" = s."planId"
WHERE s."userId" = 42;
```

Resultado:

```text
 subscriptionId | userId |      userName      | planId |    planName     | periodicityType | planType | carId | isActive | subscriptionStatus |      startDate      |      expiresAt      
----------------+--------+--------------------+--------+-----------------+-----------------+----------+-------+----------+--------------------+---------------------+---------------------
             94 |     42 | Léo Felipe Barreto |      6 | Topzeira Mensal | MONTH           | MONTH    |    57 | t        | ACTIVE             | 2025-10-31 00:00:00 | 2025-11-30 00:00:00
```

A partir deste momento, o plano do Léo passou a aparecer corretamente na tela, pois:

* Agora existe Subscription para ele.
* A Subscription está amarrada a um `carId` válido.

---

## 7. Caso Léo em Lote – Migrados em Situação Idêntica

Existiam outros clientes em situação equivalente ao Léo, divididos em dois grupos:

1. Pagaram, têm `Subscription`, têm carro, mas `Subscription.carId` estava `NULL`.
2. Pagaram, têm carro, mas **não possuem** `Subscription`.

Os dois grupos foram tratados em lote.

### 7.1. Grupo 1 – Já tinham Subscription, mas sem `carId`

#### 7.1.1. Localizando Subscriptions ativas sem carro

Consulta (com sugestão de carro principal por usuário):

```sql
SELECT
  s."id"          AS "subscriptionId",
  s."userId",
  u."name"        AS "userName",
  s."planId",
  p."name"        AS "planName",
  s."planType",
  s."isActive",
  s."startDate",
  s."expiresAt",
  (
    SELECT c."id"
    FROM "Car" c
    WHERE c."userId" = s."userId"
    ORDER BY c."createdAt" DESC
    LIMIT 1
  ) AS "suggestedCarId",
  (
    SELECT c."plate"
    FROM "Car" c
    WHERE c."userId" = s."userId"
    ORDER BY c."createdAt" DESC
    LIMIT 1
  ) AS "suggestedCarPlate"
FROM "Subscription" s
JOIN "User" u ON u."id" = s."userId"
JOIN "Plan" p ON p."id" = s."planId"
WHERE
  p."id" = 6
  AND p."isPackage" = TRUE
  AND s."isActive" = TRUE
  AND s."carId" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "Car" c
    WHERE c."userId" = s."userId"
  )
ORDER BY
  s."userId";
```

Exemplo de retorno antes do UPDATE:

```text
 subscriptionId | userId |            userName            | planId | planType | isActive |      startDate      |      expiresAt      | suggestedCarId | suggestedCarPlate 
----------------+--------+--------------------------------+--------+----------+----------+---------------------+---------------------+----------------+-------------------
             58 |     10 | Valdemar Alves                 |      6 | MONTH    | t        | 2025-11-14 00:00:00 | 2025-12-14 00:00:00 |             34 | RIJ9G87
             49 |     30 | Moacir Barros dos Santos Filho |      6 | MONTH    | t        | 2025-11-05 00:00:00 | 2025-12-05 00:00:00 |             49 | TIL0G17
             90 |    166 | Andre Albuquerque Soares moura |      6 | MONTH    | t        | 2025-11-09 00:00:00 | 2025-12-09 00:00:00 |             15 | QLEOI75
             65 |    168 | Édipo Abreu                    |      6 | MONTH    | t        | 2025-11-05 00:00:00 | 2025-12-05 00:00:00 |             14 | PMC7095
```

Note que:

* `isActive = t`.
* `expiresAt` dentro do prazo.
* `carId` ainda `NULL` (só aparece `suggestedCarId` no SELECT).

#### 7.1.2. UPDATE em lote amarrando `carId`

```sql
WITH candidates AS (
  SELECT
    s."id" AS "subscriptionId",
    (
      SELECT c."id"
      FROM "Car" c
      WHERE c."userId" = s."userId"
      ORDER BY c."createdAt" DESC
      LIMIT 1
    ) AS "carId"
  FROM "Subscription" s
  JOIN "Plan" p ON p."id" = s."planId"
  WHERE
    p."id" = 6
    AND p."isPackage" = TRUE
    AND s."isActive" = TRUE
    AND s."carId" IS NULL
)
UPDATE "Subscription" s
SET
  "carId" = c."carId",
  "updatedAt" = NOW()
FROM candidates c
WHERE
  s."id" = c."subscriptionId"
  AND c."carId" IS NOT NULL;
```

Após isso, uma consulta semelhante passa a mostrar:

```text
 subscriptionId | userId |            userName            | planId | planType | isActive |      startDate      |      expiresAt      | carId 
----------------+--------+--------------------------------+--------+----------+----------+---------------------+---------------------+-------
             58 |     10 | Valdemar Alves                 |      6 | MONTH    | t        | 2025-11-14 00:00:00 | 2025-12-14 00:00:00 |    34
             49 |     30 | Moacir Barros dos Santos Filho |      6 | MONTH    | t        | 2025-11-05 00:00:00 | 2025-12-05 00:00:00 |    49
             90 |    166 | Andre Albuquerque Soares moura |      6 | MONTH    | t        | 2025-11-09 00:00:00 | 2025-12-09 00:00:00 |    15
             65 |    168 | Édipo Abreu                    |      6 | MONTH    | t        | 2025-11-05 00:00:00 | 2025-12-05 00:00:00 |    14
```

Agora as Subscriptions estão efetivamente vinculadas aos carros.

### 7.2. Grupo 2 – Têm carro, têm Payment pago, mas não têm Subscription

#### 7.2.1. Identificando usuários ASAAS com pagamentos recorrentes

Exemplo de diagnóstico inicial:

```sql
SELECT
  p."userId",
  u."name" AS "userName",
  u."email",
  MAX(p."paymentDate")           AS "lastPaymentDate",
  MAX(p."paymentDate") FILTER (WHERE p."status" = 'PAID')
                                  AS "lastPaidDate",
  COUNT(*)                        AS "paymentsCount"
FROM "Payment" p
JOIN "User" u ON u."id" = p."userId"
WHERE
  p."planId" = 6
GROUP BY
  p."userId",
  u."name",
  u."email"
HAVING
  COUNT(*) >= 3;
```

Exemplo de retorno:

```text
 userId |         userName         |              email               |   lastPaymentDate   |    lastPaidDate     | paymentsCount 
--------+--------------------------+----------------------------------+---------------------+---------------------+---------------
     53 | Pierre Neto              | pierre20neto@icloud.com          | 2025-11-20 00:00:00 | 2025-10-29 00:00:00 |             3
     63 | Fred Alencar             | fredalencar@nortecar.com.br      | 2025-11-18 00:00:00 | 2025-10-27 00:00:00 |             3
     84 | Cicero                   | mauriti2014@gmail.com            | 2025-11-13 00:00:00 | 2025-10-22 00:00:00 |             3
     85 | Felipe Correia           | felipebroinha@gmail.com          | 2025-11-12 00:00:00 | 2025-10-21 00:00:00 |             3
     90 | Matheus Costa            | scosta.m@outlook.com             | 2025-11-19 00:00:00 | 2025-11-19 00:00:00 |             3
     92 | Cesar Lima               | mauriti2014@gmail.com            | 2025-11-19 00:00:00 | 2025-11-19 00:00:00 |             3
    118 | Isabel Dias Almeida      | isabeldias6422@gmail.com         | 2025-11-11 00:00:00 | 2025-11-11 00:00:00 |             3
    134 | Raphael de Miranda Rocha | rapha.miranda.7@gmail.com        | 2025-11-24 00:00:00 | 2025-11-03 00:00:00 |             4
    144 | Cleudivan                | cleucorgon@gmail.com             | 2025-11-23 00:00:00 | 2025-11-03 00:00:00 |             4
    193 | ANDRÉ                    | andre-caminha@hotmail.com        | 2025-11-20 00:00:00 | 2025-11-20 00:00:00 |             3
...
```

Depois filtramos para:

* Usuário com carro.
* Usuário ASAAS.
* Usuário sem **nenhuma** Subscription.

#### 7.2.2. Seleção de candidatos com carro, ASAAS, sem Subscription

Consulta consolidada (versão final que usamos):

```sql
WITH last_paid AS (
  SELECT DISTINCT ON (p."userId")
    p."userId",
    p."planId",
    p."paymentDate"          AS "lastPaidDate",
    p."amount",
    p."paymentMethodId",
    p."paymentIdAsaas"
  FROM "Payment" p
  WHERE
    p."planId" = 6
    AND p."status" = 'PAID'
  ORDER BY
    p."userId",
    p."paymentDate" DESC
),
main_car AS (
  SELECT DISTINCT ON (c."userId")
    c."userId",
    c."id" AS "carId"
  FROM "Car" c
  ORDER BY
    c."userId",
    c."createdAt" DESC
),
candidates AS (
  SELECT
    lp."userId",
    lp."planId",
    lp."lastPaidDate",
    lp."lastPaidDate" + INTERVAL '30 days' AS "expiresAt",
    lp."amount",
    lp."paymentMethodId",
    lp."paymentIdAsaas",
    mc."carId"
  FROM last_paid lp
  JOIN main_car mc
    ON mc."userId" = lp."userId"
  JOIN "Plan" pl
    ON pl."id" = lp."planId"
  LEFT JOIN "Subscription" s
    ON s."userId" = lp."userId"
   AND s."planId" = lp."planId"
  WHERE
    pl."isPackage" = TRUE
    AND lp."lastPaidDate" >= NOW() - INTERVAL '30 days'
    AND s."id" IS NULL   -- sem subscription
)
SELECT *
FROM candidates;
```

Antes do `INSERT`, a consulta retornava algo como:

```text
 userId | planId |  lastPaidDate   |     expiresAt      | amount | paymentMethodId |  paymentIdAsaas   | carId 
--------+--------+-----------------+--------------------+--------+-----------------+-------------------+-------
     90 |      6 | 2025-11-19 ...  | 2025-12-19 ...     | 119.9  | CREDIT_CARD     | pay_jhxzthf...    |   60
     92 |      6 | 2025-11-19 ...  | 2025-12-19 ...     | 119.9  | CREDIT_CARD     | pay_xedv9x1...    |   36
    118 |      6 | 2025-11-11 ...  | 2025-12-11 ...     | 119.9  | CREDIT_CARD     | pay_whqj8fe...    |    8
    134 |      6 | 2025-11-03 ...  | 2025-12-03 ...     | 119.9  | CREDIT_CARD     | pay_wxkyfz3...    |   39
    144 |      6 | 2025-11-03 ...  | 2025-12-03 ...     | 119.9  | CREDIT_CARD     | pay_x0bd9y4...    |   40
    193 |      6 | 2025-11-20 ...  | 2025-12-20 ...     | 119.9  | CREDIT_CARD     | pay_.....         |   31
...
```

#### 7.2.3. Criação das Subscriptions em lote (caso Léo “em lote”)

```sql
INSERT INTO "Subscription" (
  "userId",
  "createdAt",
  "updatedAt",
  "expiresAt",
  "isActive",
  "subscriptionStatus",
  "endDate",
  "startDate",
  "amount",
  "planType",
  "paymentMethod",
  "planId",
  "subscriptionIdAsaas",
  "installmentIdAsaas",
  "couponId",
  "carId"
)
SELECT
  c."userId",
  NOW(),
  NOW(),
  c."expiresAt",
  TRUE,
  'ACTIVE',
  NULL,
  c."lastPaidDate",
  c."amount",
  'MONTH',
  c."paymentMethodId",
  c."planId",
  c."paymentIdAsaas",
  NULL,
  NULL,
  c."carId"
FROM candidates c;
```

Exemplo de retorno posterior (checando Subscriptions criadas):

```sql
SELECT
  s."id"          AS "subscriptionId",
  s."userId",
  u."name"        AS "userName",
  s."planId",
  p."name"        AS "planName",
  s."carId",
  s."planType",
  s."isActive",
  s."subscriptionStatus",
  s."startDate",
  s."expiresAt",
  s."subscriptionIdAsaas",
  s."createdAt"
FROM "Subscription" s
JOIN "User" u ON u."id" = s."userId"
JOIN "Plan" p ON p."id" = s."planId"
WHERE s."id" >= 98
ORDER BY s."id";
```

Resultado ilustrativo:

```text
 subscriptionId | userId |        userName         | planId |    planName     | carId | planType | isActive | subscriptionStatus |      startDate      |      expiresAt      | subscriptionIdAsaas |        createdAt        
----------------+--------+-------------------------+--------+-----------------+-------+----------+----------+--------------------+---------------------+---------------------+----------------------+-------------------------
             98 |     90 | Matheus Costa           |      6 | Topzeira Mensal |    60 | MONTH    | t        | ACTIVE             | 2025-11-19 00:00:00 | 2025-12-19 00:00:00 | pay_jhxzthfnnd929ea1 | 2025-11-29 14:22:26.387
             99 |     92 | Cesar Lima              |      6 | Topzeira Mensal |    36 | MONTH    | t        | ACTIVE             | 2025-11-19 00:00:00 | 2025-12-19 00:00:00 | pay_xedv9x19jja0qntd | 2025-11-29 14:22:26.387
            100 |    118 | Isabel Dias Almeida     |      6 | Topzeira Mensal |     8 | MONTH    | t        | ACTIVE             | 2025-11-11 00:00:00 | 2025-12-11 00:00:00 | pay_whqj8fevsskhx5ml | 2025-11-29 14:22:26.387
            101 |    134 | Raphael de Miranda Rocha|      6 | Topzeira Mensal |    39 | MONTH    | t        | ACTIVE             | 2025-11-03 00:00:00 | 2025-12-03 00:00:00 | pay_wxkyfz3ef7ytfv4m | 2025-11-29 14:22:26.387
            102 |    144 | Cleudivan               |      6 | Topzeira Mensal |    40 | MONTH    | t        | ACTIVE             | 2025-11-03 00:00:00 | 2025-12-03 00:00:00 | pay_x0bd9y4ijvfbn718 | 2025-11-29 14:22:26.387
            103 |    193 | ANDRÉ                   |      6 | Topzeira Mensal |    31 | MONTH    | t        | ACTIVE             | 2025-11-20 00:00:00 | 2025-12-20 00:00:00 | pay_...............  | 2025-11-29 14:22:26.387
```

Depois disso, a mesma consulta `candidates` (CTE) passou a retornar `0 rows`, confirmando que todos os clientes elegíveis já possuíam Subscription.

---

## 8. Regras para os Serviços (Evitar novos casos Eduardo/Léo)

### 8.1. Serviço de Pagamentos / Assinaturas (fluxo novo, tipo Eduardo)

Responsabilidades:

1. Ao receber confirmação ASAAS (`status = PAID`) de um plano pacote (`Plan.isPackage = TRUE`):

    * Buscar `Plan` por `planId`.
    * Garantir:

        * `planType` = `Plan.periodicityType` (ex.: `'MONTH'`).
        * `duration` em dias para cálculo da validade.

2. Para `(userId, planId, carId)`:

    * Localizar Subscription existente **ou** criar uma nova.

    * Calcular:

        * `startDate`:

            * Se assinatura nova ou expirada → `startDate = paymentDate`.
            * Se assinatura ainda ativa → manter `startDate` e usar `expiresAt` como base de renovação.
        * `expiresAt`:

            * `expiresAt = referencia + duration`.

    * Atualizar:

        * `planType = Plan.periodicityType`.
        * `amount = Payment.amount`.
        * `isActive = (expiresAt >= NOW())`.
        * `subscriptionStatus = 'ACTIVE'` quando `isActive = TRUE`.

3. Nunca gravar em `Subscription.planType` strings externas da ASAAS (`'MONTHLY'`, `'YEARLY'`, etc.).

4. Sempre considerar o `Payment` mais recente com `status = 'PAID'` como fonte de verdade para o ciclo atual.

### 8.2. Serviço de Migração / Sincronização ASAAS (caso Léo e caso Léo em lote)

Responsabilidades:

1. Garantir que todos os `Payment` legados tenham `planId` correto (ex.: `6` para Topzeira Mensal).

2. Para cada usuário com `Payment.PAID` de plano pacote:

    * Se **não existe** `Subscription` para `(userId, planId)`:

        * Criar nova `Subscription`:

            * `startDate = lastPaidDate`.
            * `expiresAt = lastPaidDate + duration`.
            * `planType = Plan.periodicityType`.
            * `amount = Payment.amount`.
            * `isActive` e `subscriptionStatus` coerentes.
            * Se usuário tiver carro, amarrar `carId` ao carro principal.
            * Caso contrário, `carId = NULL`.

    * Se **existe** `Subscription`, mas:

        * `planType` incorreto (`MONTHLY`, `NULL`, etc.), ou
        * `expiresAt` inconsistente, ou
        * `isActive` não bate com `expiresAt`, ou
        * `carId IS NULL` mesmo com carro cadastrado,

      então:

        * Normalizar `planType`, `startDate`, `expiresAt`, `isActive`.
        * No caso de haver carro, amarrar `carId`.

3. Não criar carros “fake” para migrados.

    * Se não há carro na base, `carId` continua `NULL` até o usuário cadastrar um veículo no app.

### 8.3. Serviço de Carros (vínculo automático na criação de veículo)

Responsabilidades:

1. Ao criar um novo `Car` para um usuário migrado (ou mesmo de fluxo novo):

    * Procurar `Subscription` ativa, sem `carId`, para aquele `userId` e plano pacote:

      ```sql
      SELECT s."id"
      FROM "Subscription" s
      JOIN "Plan" p ON p."id" = s."planId"
      WHERE
        s."userId" = :userId
        AND s."isActive" = TRUE
        AND s."carId" IS NULL
        AND p."isPackage" = TRUE
      ORDER BY s."startDate" DESC
      LIMIT 1;
      ```

    * Se encontrar, atualizar:

      ```sql
      UPDATE "Subscription"
      SET
        "carId" = :newCarId,
        "updatedAt" = NOW()
      WHERE "id" = :subscriptionId;
      ```

2. Esse fluxo é a “automação” do que foi feito manualmente no Léo e em lote para outros clientes.

---

## 9. Checklist de Observabilidade / DevOps

Para monitorar se a regra está saudável, é recomendável manter consultas de diagnóstico:

1. **Pagos sem Subscription (possível novo caso Léo):**

   ```sql
   SELECT
     p."userId",
     u."name" AS "userName",
     COUNT(*) AS "paymentsCount"
   FROM "Payment" p
   JOIN "User" u ON u."id" = p."userId"
   LEFT JOIN "Subscription" s
     ON s."userId" = p."userId"
    AND s."planId" = p."planId"
   JOIN "Plan" pl ON pl."id" = p."planId"
   WHERE
     p."status" = 'PAID'
     AND pl."isPackage" = TRUE
     AND s."id" IS NULL
   GROUP BY
     p."userId",
     u."name";
   ```

2. **Subscriptions ativas de plano pacote sem carro para usuários que já têm carro:**

   ```sql
   SELECT
     s."id" AS "subscriptionId",
     s."userId",
     u."name" AS "userName"
   FROM "Subscription" s
   JOIN "User" u ON u."id" = s."userId"
   JOIN "Plan" p ON p."id" = s."planId"
   WHERE
     p."isPackage" = TRUE
     AND s."isActive" = TRUE
     AND s."carId" IS NULL
     AND EXISTS (
       SELECT 1
       FROM "Car" c
       WHERE c."userId" = s."userId"
     );
   ```

3. **Subscriptions com `planType` inválido:**

   ```sql
   SELECT
     s."id",
     s."userId",
     s."planType",
     p."periodicityType"
   FROM "Subscription" s
   JOIN "Plan" p ON p."id" = s."planId"
   WHERE
     p."isPackage" = TRUE
     AND s."planType" <> p."periodicityType";
   ```

---

## 10. Resumo Final

* Caso Eduardo: fluxo novo com Subscription criada, mas com metadados inconsistentes (`planType`, `isActive`, `expiresAt`).

    * Correções: ajuste em `Plan.isPackage`, normalização em massa de `Subscription` e sincronização da Subscription específica com o Payment do Eduardo.

* Caso Léo (unitário): usuário migrado da ASAAS com Payment pago, carro cadastrado, mas **sem** Subscription.

    * Correções: preenchimento de `planId` nos Payments, criação manual da Subscription e já amarração ao `carId`.

* Caso Léo em lote: vários usuários em situações equivalentes ao Léo:

    * Alguns com Subscription ativa mas `carId = NULL` → UPDATE em lote amarrando `carId`.
    * Outros com Payment pago + carro, mas sem Subscription → criação em lote de Subscriptions, já vinculadas ao carro.

Com essas regras internalizadas em código (serviços de Pagamento, Migração ASAAS e Carros), o sistema garante:

* Quem paga, enxerga plano ativo.
* Assinaturas de pacote sempre respeitam o domínio (`planType`, `duration`, `isActive`).
* Migrados da ASAAS são normalizados sem depender de novos scripts manuais.

---

## 11. Cancelar Plano x Remover Cliente (Histórico de Plano)

Esta seção documenta explicitamente a diferença entre:

1. Cancelar o plano (ação de negócio do cliente, mantendo uso até o fim do período pago).
2. Remover o cliente do plano (ação administrativa para limpar histórico – testes, migrações, sujeira).

### 11.1. Conceitos

* Plano pacote: `Plan.isPackage = TRUE` (ex.: Topzeira Mensal, `Plan.id = 6`).
* Assinatura (`Subscription`): controla ciclo de uso (datas, status, vínculo com carro).
* Pagamento (`Payment`): registro financeiro, fonte de verdade do que foi pago.

Dois tipos de ação:

1. **Cancelar plano** (cliente não quer renovar, mas já pagou o ciclo atual).
2. **Remover cliente do plano** (admin limpa tudo para aquele plano, inclusive histórico).

---

### 11.2. Cancelar Plano (ação do cliente)

Objetivo: o cliente não quer ser renovado para próximos ciclos, mas ainda tem direito de uso até o fim do período já pago (exemplo: plano contratado em 20/11, válido por 30 dias; se cancelar em 22/11, continua com acesso até ~20/12).

Regras de negócio:

1. Nenhum histórico é apagado.

    * Linhas de `Payment` permanecem.
    * Linhas de `Subscription` permanecem.

2. A assinatura do ciclo atual é marcada como cancelada, mas continua utilizável até o fim da validade:

    * `subscriptionStatus = 'CANCELED'`
    * `isActive` deve refletir a janela de uso:

        * Enquanto `expiresAt >= NOW()`:

            * `isActive = TRUE`
            * Cliente ainda consegue usar o plano normalmente.
        * Quando `expiresAt < NOW()`:

            * `isActive = FALSE`
            * Plano deixa de ser utilizável.

3. `startDate` e `expiresAt` não mudam no momento do cancelamento; continuam representando exatamente o ciclo pago.

4. Exemplo prático (caso Eduardo, cancelamento):

   Após rodar o `UPDATE` de cancelamento da assinatura “boa”:

   ```sql
   UPDATE "Subscription"
   SET
     "subscriptionStatus" = 'CANCELED',
     "isActive" = TRUE,           -- ainda dentro do prazo
     "updatedAt" = NOW()
   WHERE "id" = 45;
   ```

   A tabela passou a mostrar:

   ```text
    id | userId | planId | subscriptionStatus | isActive |        startDate        |        expiresAt        
   ----+--------+--------+--------------------+----------+-------------------------+-------------------------
    45 |    102 |      6 | CANCELED           | t        | 2025-11-29 08:27:18.152 | 2025-12-29 08:27:18.152
   ```

   Interpretação:

    * O plano está “cancelado” para renovação futura (`subscriptionStatus = 'CANCELED'`).
    * Mas ainda está “ativo” do ponto de vista de uso até `2025-12-29 08:27:18.152` (`isActive = TRUE` enquanto `expiresAt >= NOW()`).
    * Na UI, isso pode ser exibido como:

        * “Plano cancelado – válido até 29/12/2025”.

5. Regra geral para cancelamento (serviço de domínio):

   Ao cancelar:

    * Atualizar a assinatura do ciclo vigente do plano pacote para:

      ```sql
      UPDATE "Subscription"
      SET
        "subscriptionStatus" = 'CANCELED',
        "updatedAt" = NOW(),
        "isActive" = ("expiresAt" IS NOT NULL AND "expiresAt" >= NOW())
      WHERE "id" = :subscriptionId;
      ```

    * Não tocar em `Payment`.

    * Não deletar `Subscription`.

Resumo:

* Cancelar plano:

    * Não remove linhas.
    * Mantém histórico financeiro (Payment) e de uso (Subscription).
    * Garante acesso até `expiresAt`.
    * Após `expiresAt`, `isActive` passa a `FALSE` e a assinatura fica apenas como histórico cancelado.

---

### 11.3. Remover Cliente do Plano (limpar histórico)

Objetivo: “resetar” completamente o cliente para aquele plano, apagando assinaturas e pagamentos relacionados, tipicamente em situações de:

* Testes internos (como ocorreu com o cliente Eduardo, onde foram criadas 11 assinaturas).
* Erros de migração que geraram sujeira.
* Reprocessamento completo do histórico daquele plano.

Regras de negócio:

1. Todos os registros de `Subscription` daquele plano para o cliente devem ser removidos:

   ```sql
   DELETE FROM "Subscription"
   WHERE "userId" = :userId
     AND "planId" = :planId;
   ```

2. Todos os registros de `Payment` daquele plano para o cliente também devem ser removidos:

   ```sql
   DELETE FROM "Payment"
   WHERE "userId" = :userId
     AND "planId" = :planId;
   ```

3. O cliente (`User`) permanece na base.

    * Carros (`Car`) permanecem na base (não são removidos por esta ação).
    * O que some é o vínculo histórico do cliente com aquele plano específico (pagamentos + assinaturas).

4. Exemplo prático (caso Eduardo – limpar histórico de testes):

   Antes da limpeza, o cliente Eduardo (`userId = 102`, `planId = 6`) tinha 11+ assinaturas/linhas, por múltiplos testes.

   A limpeza foi feita com:

   ```sql
   BEGIN;

   DELETE FROM "Subscription"
   WHERE "userId" = 102
     AND "planId" = 6;

   DELETE FROM "Payment"
   WHERE "userId" = 102
     AND "planId" = 6;

   COMMIT;
   ```

   Após isso:

   ```sql
   SELECT
     s."id",
     s."userId",
     s."planId",
     s."subscriptionStatus",
     s."isActive",
     s."startDate",
     s."expiresAt"
   FROM "Subscription" s
   WHERE s."userId" = 102
     AND s."planId" = 6
   ORDER BY s."id";
   ```

   Retorno:

   ```text
    id | userId | planId | subscriptionStatus | isActive | startDate | expiresAt 
   ----+--------+--------+--------------------+----------+-----------+-----------
   (0 rows)
   ```

   E para `Payment`:

   ```sql
   SELECT
     p."id",
     p."userId",
     p."planId",
     p."status",
     p."amount",
     p."paymentDate"
   FROM "Payment" p
   WHERE p."userId" = 102
     AND p."planId" = 6
   ORDER BY p."id";
   ```

   Retorno:

   ```text
    id | userId | planId | status | amount | paymentDate 
   ----+--------+--------+--------+--------+-------------
   (0 rows)
   ```

   Interpretação:

    * O cliente continua existindo, com seu cadastro e carros.
    * Mas, para o `planId = 6`, não há mais nenhum histórico de pagamento ou assinatura.
    * Na UI, “Meus Planos” não exibe nada desse plano para este usuário; é como se ele nunca tivesse aderido ao Topzeira.

Resumo:

* Remover cliente do plano:

    * Apaga histórico completo de `Subscription` e `Payment` para aquele `planId`.
    * Não é uma ação normal de usuário final; é ação de suporte/admin.
    * Uso típico para correção de dados, testes, migração.

---

### 11.4. Comparativo direto: Cancelar x Remover

1. **Cancelar plano (cliente)**

    * Mantém histórico financeiro.
    * Mantém histórico de assinaturas.
    * Marca:

        * `subscriptionStatus = 'CANCELED'`.
        * `isActive`:

            * `TRUE` até `expiresAt`.
            * `FALSE` após `expiresAt`.
    * Cliente ainda pode utilizar o plano até o fim do período já pago.
    * Útil para fluxo padrão de “quero parar de renovar, mas já paguei este mês”.

2. **Remover cliente do plano (admin)**

    * Remove todas as `Subscription` para `(userId, planId)`.
    * Remove todos os `Payment` para `(userId, planId)`.
    * “Zera” o cliente para aquele plano (sem rastro desse plano na base para ele).
    * Útil para:

        * Limpar casos de teste (como o cliente Eduardo, com várias assinaturas criadas e removidas).
        * Corrigir migrações erradas, permitindo reprocessar tudo do zero.

---

### 11.5. Integração com as Regras de Serviço

Para manter esta lógica consistente no código:

1. **Serviço de Pagamentos / Assinaturas**

    * Deve expor uma operação de “cancelar plano” que:

        * Localiza a `Subscription` ativa do ciclo atual para `(userId, planId, carId)`.
        * Atualiza `subscriptionStatus = 'CANCELED'`.
        * Mantém `startDate`, `expiresAt` e `amount`.
        * Recalcula `isActive` com base em `expiresAt`.

2. **Painel Administrativo / Serviço Interno**

    * Deve expor uma operação de “remover cliente do plano” que:

        * Executa as duas deleções em transação:

            * `DELETE FROM "Subscription" ...`
            * `DELETE FROM "Payment" ...`
        * Opcionalmente registra log interno do motivo da remoção (ex.: “limpeza de histórico de teste”, “correção de migração”).

3. **UI – Experiência do Usuário**

    * Para o cliente final:

        * Exibir botão “Cancelar plano”, nunca “Remover”.
        * Ao cancelar, mostrar claramente:

            * “Seu plano foi cancelado, mas permanece válido até DD/MM/AAAA.”
    * Para o admin/suporte:

        * Exibir ação “Remover histórico do plano” apenas em painel restrito.
        * Deixar claro que essa ação apaga todo o histórico de pagamentos e assinaturas daquele plano para o cliente.

Com isso, a base de dados e a interface passam a refletir de forma consistente:

* O direito de uso até o fim do período pago (via cancelamento).
* A necessidade de limpeza completa em cenários de teste/migração (via remoção).

---

## 12. Nova Problemática – Pagamento Confirmado, Subscription Existente, Plano Não Ativo (Webhook Ausente)

### 12.1. Sintoma

Cenário observado em um novo teste com o mesmo cliente (Eduardo):

1. O cliente fez um novo pagamento PIX do plano Topzeira Mensal.
2. O ASAAS confirmou o pagamento (`status = RECEIVED / CONFIRMED`).
3. Na base local:

    * `Payment.status = 'PAID'`.
    * Existe uma `Subscription` para `(userId, planId, carId)`.
    * Porém, a assinatura não foi ativada (`isActive = FALSE`), e o app não exibiu o plano como ativo na tela.

Ou seja: diferente do caso Léo (em que não havia Subscription), aqui já existia uma Subscription, mas o vínculo `Payment -> Subscription` não foi propagado corretamente quando o webhook não chegou.

### 12.2. Diagnóstico via Logs da API

Primeira análise foi feita diretamente nos logs da API:

1. Filtragem por identificador da função:

    * Buscar por `[paymentWebhook]`.
    * Buscar por `[handlePaymentWebhook]`.
    * Buscar por `[updateSubscriptionValidityFromPayment]`.

2. Filtragem pelo `paymentIdAsaas` do pagamento em questão:

    * Exemplo do novo teste:

        * `paymentIdAsaas = 'pay_4i4bc85j391gi0lp'`.

3. Resultado:

    * Não existia nenhum log de `paymentWebhook` nem de `handlePaymentWebhook` para esse pagamento.
    * Ou seja: o webhook do ASAAS não chegou na API (endpoint errado, indisponibilidade momentânea ou problema de configuração de webhook no ASAAS).

Conclusão: o status `PAID` de `Payment` foi atualizado por outro caminho (sincronização ativa), mas sem chamar `updateSubscriptionValidityFromPayment`.

### 12.3. Diagnóstico via Banco – Payment e Subscription do Novo Teste

Consulta em `Payment` para o novo teste do plano 6 para o usuário 102:

```sql
SELECT
  "id",
  "userId",
  "planId",
  "amount",
  "status",
  "paymentMethodId",
  "paymentIdAsaas",
  "paymentDate",
  "createdAt",
  "updatedAt"
FROM "Payment"
WHERE "paymentIdAsaas" = 'pay_4i4bc85j391gi0lp';
```

Resultado:

```text
 id  | userId | planId | amount | status | paymentMethodId |    paymentIdAsaas    |       paymentDate       |       createdAt        |        updatedAt        
-----+--------+--------+--------+--------+-----------------+----------------------+-------------------------+------------------------+-------------------------
 2675|    102 |      6 |  139.9 | PAID   | PIX             | pay_4i4bc85j391gi0lp | 2025-11-29 13:38:25.514 | 2025-11-29 16:38:27.26 | 2025-11-29 16:39:10.101
(1 row)
```

Em seguida, checagem da Subscription criada na mesma janela:

```sql
SELECT
  "id",
  "userId",
  "planId",
  "carId",
  "planType",
  "isActive",
  "subscriptionStatus",
  "startDate",
  "expiresAt",
  "subscriptionIdAsaas",
  "installmentIdAsaas",
  "createdAt",
  "updatedAt"
FROM "Subscription"
WHERE "userId" = 102
  AND "planId" = 6
ORDER BY "createdAt" DESC
LIMIT 1;
```

Resultado:

```text
 id  | userId | planId | carId | planType | isActive | subscriptionStatus |        startDate        |        expiresAt        | endDate | subscriptionIdAsaas | installmentIdAsaas |        createdAt        |        updatedAt        
-----+--------+--------+-------+----------+----------+--------------------+-------------------------+-------------------------+---------+---------------------+--------------------+-------------------------+-------------------------
 108 |    102 |      6 |    10 | MONTH    | f        | ACTIVE             | 2025-11-29 16:38:25.514 | 2025-12-29 13:38:25.514 |         |                     |                    | 2025-11-29 16:38:25.515 | 2025-11-29 16:38:25.515
(1 row)
```

Observações:

* `subscriptionStatus = 'ACTIVE'`, ou seja, do ponto de vista de status lógico, o sistema marcou a assinatura como ativa.
* `isActive = false`, ou seja, do ponto de vista de uso atual, a assinatura foi considerada inativa.
* `startDate` e `expiresAt` estão coerentes com um ciclo de 30 dias, mas a flag `isActive` não foi recalculada após o pagamento ser confirmado.

Sintoma prático:

* O cliente pagou.
* Há Payment `PAID`.
* Há Subscription criada.
* O plano não aparece como ativo no app porque `isActive = false`.

### 12.4. Causa Raiz

A causa raiz envolve a combinação de dois pontos:

1. **Webhook ASAAS não chegou** para o pagamento `pay_4i4bc85j391gi0lp`.

    * Sem webhook, o fluxo normal:

        * `paymentWebhook` → `handlePaymentWebhook` → `updateSubscriptionValidityFromPayment` → revalida `isActive` e `expiresAt`.

      não foi disparado.

2. **A rotina de sincronização ativa (sem webhook) atualiza apenas `Payment`, não `Subscription`.**

   Isto é, o serviço `PaymentService` possui um método de sincronização como:

   ```ts
   private async syncPaymentWithAsaasByLocalId(paymentId: number): Promise<void> {
     const localPayment = await this.paymentRepository.getOneByFilter({ id: paymentId });

     if (!localPayment) { ... }

     if (!localPayment.paymentIdAsaas) { ... }

     if (localPayment.status === "PAID" || localPayment.status === "CANCELED") {
       return;
     }

     const asaasPayment = await asaasGetPayment(localPayment.paymentIdAsaas);

     const internalStatusFromAsaas = this.mapAsaasPaymentStatusToInternal(
       asaasPayment.status as ASAASPaymentStatusEnum,
     );

     if (internalStatusFromAsaas !== localPayment.status) {
       await this.paymentRepository.updatePaymentStatus(
         localPayment.id,
         internalStatusFromAsaas,
       );
       // Faltava: propagar para Subscription
     }
   }
   ```

   Ou seja:

    * O sync corrige o `Payment.status` com base no ASAAS (por exemplo, de `PENDING` para `PAID`).
    * Porém, não chama `updateSubscriptionValidityFromPayment` para recalcular:

        * `expiresAt`.
        * `isActive`.
        * `planType`, se necessário.

Resultado: quando o webhook falha ou está mal configurado, o sistema entra numa “metade de estado”:

* Financeiro (Payment) atualizado.
* Domínio de assinatura (Subscription) congelado.

### 12.5. Correção Emergencial (SQL) – Ativação Manual da Assinatura

Para corrigir imediatamente o cliente (sem alterar código), foi aplicada uma correção manual na Subscription `id = 108`:

```sql
UPDATE "Subscription"
SET
  "isActive" = TRUE,
  "subscriptionStatus" = 'ACTIVE',
  "updatedAt" = NOW()
WHERE
  "id" = 108;
```

Versão mais genérica, baseada em validade, para qualquer assinatura do plano 6 do usuário 102:

```sql
UPDATE "Subscription"
SET
  "isActive" = TRUE,
  "subscriptionStatus" = 'ACTIVE',
  "updatedAt" = NOW()
WHERE
  "userId" = 102
  AND "planId" = 6
  AND "expiresAt" >= NOW();
```

Após este `UPDATE`, o plano do Eduardo passou a ser exibido corretamente na tela, confirmando que o problema estava apenas na flag `isActive`.

### 12.6. Ação Estrutural – Ajuste de Serviço para Resiliência sem Webhook

Para não depender de correções manuais quando o webhook falhar, a regra de negócio do serviço de pagamentos precisa ser atualizada:

1. **Qualquer fluxo que alterar `Payment.status` com base em consulta ao ASAAS deve também atualizar a Subscription.**

   Em termos de serviço de domínio:

    * O método `syncPaymentWithAsaasByLocalId` (e qualquer outro que sincronize status) precisa:

        1. Detectar mudança de status (`PENDING` → `PAID` ou `CANCELED`).
        2. Localizar a Subscription relacionada.
        3. Chamar `updateSubscriptionValidityFromPayment(subscription, paymentDate, newStatus)`.

2. **Localização da Subscription associada ao Payment sem webhook:**

   A associação pode ser feita em três fontes:

    * `asaasPayment.subscription` (assinatura ASAAS).
    * `asaasPayment.installment` (quando houver `installmentIdAsaas`).
    * `asaasPayment.externalReference` contendo `subId` (ID local da Subscription).

   Regra proposta:

   ```ts
   if (internalStatusFromAsaas === "PAID" || internalStatusFromAsaas === "CANCELED") {
     let subscription: Subscription | null = null;

     // 1) Pelo subscriptionIdAsaas
     if (asaasPayment.subscription) {
       subscription = await this.subscriptionRepository.getByAsaasId(
         asaasPayment.subscription,
       );
     }

     // 2) Pelo installmentIdAsaas
     if (!subscription && asaasPayment.installment) {
       subscription =
         await this.subscriptionRepository.getByInstallmentIdAsaas(
           asaasPayment.installment,
         );
     }

     // 3) Pelo subId em externalReference
     if (!subscription && asaasPayment.externalReference) {
       try {
         const externalReference = JSON.parse(
           asaasPayment.externalReference,
         ) as { subId?: number };

         if (externalReference.subId) {
           subscription =
             await this.subscriptionRepository.findById(
               externalReference.subId,
             );
         }
       } catch (parseError) {
         // log de erro de parse
       }
     }

     if (subscription) {
       const paymentDate =
         asaasPayment.paymentDate !== undefined &&
         asaasPayment.paymentDate !== null
           ? new Date(asaasPayment.paymentDate)
           : new Date();

       await this.updateSubscriptionValidityFromPayment(
         subscription,
         paymentDate,
         internalStatusFromAsaas,
       );
     }
   }
   ```

3. **Invariantes mantidas após a alteração:**

    * Com webhook:

        * `paymentWebhook` continua sendo o caminho principal.
        * `handlePaymentWebhook` continua chamando `updateSubscriptionValidityFromPayment`.

    * Sem webhook (fallback):

        * Ao rodar qualquer fluxo de sincronização (por exemplo, ao exibir detalhes de pagamento ou ao rodar uma rotina de “health check” dos pagamentos), o sistema:

            * Atualiza `Payment.status` com base no ASAAS.
            * Atualiza a Subscription correspondente via `updateSubscriptionValidityFromPayment`.

4. **Benefício direto:**

    * Mesmo que o ASAAS não consiga chamar o webhook por algum motivo (endpoint inválido, queda temporária, firewall), a próxima sincronização ativa:

        * Coloca `Payment.status` como `PAID`.
        * Calcula `expiresAt` corretamente.
        * Define `isActive = TRUE` quando dentro da janela.
        * Garante que o cliente verá o plano como ativo.

### 12.7. Checklist Operacional para Novos Casos

Dado um `paymentIdAsaas` qualquer (por exemplo, `pay_4i4bc85j391gi0lp`), o fluxo de diagnóstico operacional fica registrado:

1. **Log da API:**

    * Filtrar por `[paymentWebhook]` e por `pay_XXXXXXXX`.
    * Se não houver log:

        * O webhook não chegou.
        * O problema não está na validação de usuário/plano/cupom.

2. **Banco – Payment:**

   ```sql
   SELECT
     "id",
     "userId",
     "planId",
     "amount",
     "status",
     "paymentMethodId",
     "paymentIdAsaas",
     "paymentDate",
     "createdAt",
     "updatedAt"
   FROM "Payment"
   WHERE "paymentIdAsaas" = 'pay_XXXXXXXX';
   ```

    * Confirmar se `status = 'PAID'`.
    * Confirmar se `planId` está correto.

3. **Banco – Subscription:**

   ```sql
   SELECT
     "id",
     "userId",
     "planId",
     "carId",
     "planType",
     "isActive",
     "subscriptionStatus",
     "startDate",
     "expiresAt",
     "subscriptionIdAsaas",
     "createdAt",
     "updatedAt"
   FROM "Subscription"
   WHERE "userId" = :userId
     AND "planId" = :planId
   ORDER BY "createdAt" DESC;
   ```

    * Se não existir Subscription:

        * É um novo “caso Léo” (precisa criar Subscription baseada no último `Payment.PAID`).
    * Se existir Subscription, mas:

        * `subscriptionStatus = 'ACTIVE'` e `isActive = FALSE`:

            * É o novo “caso Eduardo sem webhook.”

4. **Correção imediata (enquanto o ajuste de código não estiver em produção):**

    * Aplicar `UPDATE` semelhante ao da seção 12.5 para alinhar `isActive` com `expiresAt` quando houver Payment `PAID` válido.

5. **Correção definitiva (código):**

    * Garantir que qualquer mudança de status em `Payment` acionada por sync também aciona `updateSubscriptionValidityFromPayment`, usando as regras da seção 12.6.

Com esta nova problemática documentada, o histórico completo fica registrado:

* Primeiro, a falha de domínio (planType/isActive/expiresAt/carId).
* Depois, a falha de migração (caso Léo unitário e em lote).
* Agora, a falha de propagação de status quando o webhook não chega, corrigida com:

    * Ajuste de SQL emergencial.
    * Definição clara da alteração necessária no `PaymentService` para sincronizar `Payment` e `Subscription` em qualquer cenário.
