
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

---

## 2. Modelos Envolvidos (resumo)

### 2.1. Plan

Campos relevantes:

- `id`
- `name`
- `price`
- `duration` (dias de validade do ciclo)
- `periodicityType` (`WEEK`, `MONTH`, `YEAR`, `SEMIANNUALLY`, `QUARTERLY`)
- `isPackage` (se é plano pacote de serviços)
- `maxInstallments`
- `extraMonths`

O Topzeira Mensal é o `Plan.id = 6`.

### 2.2. Payment

Campos relevantes:

- `id`
- `userId`
- `planId` (pode ter vindo `NULL` na migração, depois preenchido)
- `amount`
- `status` (`PAID`, `PENDING`, `CANCELED`)
- `paymentMethodId`
- `paymentIdAsaas`
- `paymentDate`
- `createdAt`

### 2.3. Subscription

Campos relevantes:

- `id`
- `userId`
- `planId`
- `carId` (pode ser `NULL` em migrados que ainda não tinham carro)
- `planType` (texto interno de periodicidade – ex.: `'MONTH'`)
- `startDate`
- `expiresAt`
- `amount`
- `isActive`
- `subscriptionStatus` (`ACTIVE`, `SUSPENDED`, `CANCELED`)
- `subscriptionIdAsaas`
- `installmentIdAsaas`
- `couponId`
- `createdAt`
- `updatedAt`

### 2.4. Car

Campos relevantes:

- `id`
- `userId`
- `plate`
- `createdAt`
- demais dados do veículo

---

## 3. Invariantes de Negócio (Plano Pacote)

Para qualquer plano do tipo “pacote de serviços” (inclui o Topzeira Mensal):

1. `Plan.isPackage = TRUE`.
2. `Plan.periodicityType` define o tipo de periodicidade da assinatura (ex.: `'MONTH'`).
3. `Plan.duration` define em dias a validade de cada ciclo (ex.: 30 dias).
4. `Subscription.planType` deve sempre refletir `Plan.periodicityType`  
   - Exemplo: Topzeira Mensal → `planType = 'MONTH'`.
   - Strings da ASAAS (`'MONTHLY'`, `'YEARLY'`, etc.) **não** devem ser gravadas em `Subscription.planType`.
5. Assinatura ativa = assinatura com:
   - `isActive = TRUE`
   - `expiresAt >= NOW()`.

Fonte de verdade financeira: último registro de `Payment` com `status = 'PAID'` para `(userId, planId)`.

---

## 4. Problema Original (sintoma comum)

Sintoma visto na tela “Meus Planos”:

- Cliente paga no ASAAS → `Payment.status = PAID`.
- Registro em `Payment` existe e está correto.
- Cliente não vê nenhum plano ativo no app.

Causas combinadas:

1. Em algum momento, `Plan.id = 6` tinha `isPackage = FALSE`.
2. `Subscription` foi gravada com:
   - `planType` misturando `'MONTH'` e `'MONTHLY'`.
   - `isActive` inconsistente com `expiresAt`.
   - `expiresAt` nulo ou incorreto em várias linhas.
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
````

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

Resultado (resumo):

* `userId = 102`
* `planId = 6`
* `amount = 139.9`
* `status = 'PAID'`
* `paymentIdAsaas = 'pay_ek6cbqbantuf7m83'`
* `paymentDate = 2025-11-29 08:27:18.152`

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
     92 | Cesar Lima               | cesar3rachel@gmail.com           | 2025-11-19 00:00:00 | 2025-11-19 00:00:00 |             3
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
WHERE s."id" >= 98 -- por exemplo, IDs criados na leva
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

### 8.3. Serviço de Carros (vínculo automátco na criação de veículo)

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

